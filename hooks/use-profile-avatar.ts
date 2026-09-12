import {
  firebaseStorageBaseUrl,
  firestoreDocumentUrl,
} from "@/constants/runtime-config";
import { useUserProfile } from "@/context/UserProfileContext";
import * as ImageManipulator from "expo-image-manipulator";
import * as ImagePicker from "expo-image-picker";
import type { User } from "firebase/auth";
import { useState } from "react";
import { Alert } from "react-native";

type UseProfileAvatarParams = {
  user: User | null;
  onUploaded: () => Promise<void> | void;
};

// Avatars render at ~96px, so 1024 leaves plenty of headroom and keeps the
// encoded file two orders of magnitude under the 5 MB ceiling in storage.rules.
//
// This used to be `manipulateAsync(uri, [], { compress: 1 })` — an empty action
// list means no resize, and compress: 1 means NO compression. A 12 MP phone
// photo therefore became a 10 MB+ JPEG, and the `.blob()` below pulled all of it
// into JS memory at once. That is what froze the app, and it froze before any
// network call, which is why it looked like the upload itself was hanging.
const AVATAR_MAX_WIDTH = 1024;
const AVATAR_QUALITY = 0.8;

// Storage object path. MUST stay in sync with `match /profiles/{uid}/{fileName}`
// in storage.rules and with the deleteFiles prefix in functions/index.js:2493.
//
// The old flat `profiles/{uid}.jpg` is a two-segment path, which matches the
// LEGACY rule block, not this one. Deploy storage.rules together with this file:
// under the old ruleset a three-segment path falls through to the catch-all deny.
const avatarObjectPath = (uid: string): string => `profiles/${uid}/avatar.jpg`;
const avatarObjectKey = (uid: string): string =>
  encodeURIComponent(avatarObjectPath(uid));

export function useProfileAvatar({ user, onUploaded }: UseProfileAvatarParams) {
  const { updateUserData } = useUserProfile();
  const [uploading, setUploading] = useState(false);

  const uploadImage = async (uri: string) => {
    if (!user) return;

    const token = await user.getIdToken();

    const converted = await ImageManipulator.manipulateAsync(
      uri,
      [{ resize: { width: AVATAR_MAX_WIDTH } }],
      { compress: AVATAR_QUALITY, format: ImageManipulator.SaveFormat.JPEG },
    );

    const blob = await (await fetch(converted.uri)).blob();

    const startRes = await fetch(
      `${firebaseStorageBaseUrl}?uploadType=resumable&name=${avatarObjectPath(user.uid)}`,
      {
        method: "POST",
        headers: {
          "Content-Type": "application/json; charset=UTF-8",
          "X-Goog-Upload-Protocol": "resumable",
          "X-Goog-Upload-Command": "start",
          Authorization: `Bearer ${token}`,
        },
        body: JSON.stringify({ contentType: "image/jpeg" }),
      },
    );
    // Previously unchecked. A 403 from storage.rules simply omits the upload-URL
    // header, so the old code hit `if (!uploadUrl) return` and reported nothing
    // at all — the upload "worked" from the UI's point of view and the picture
    // never changed.
    if (!startRes.ok) {
      throw new Error(`Upload could not start (HTTP ${startRes.status})`);
    }

    const uploadUrl = startRes.headers.get("X-Goog-Upload-URL");
    if (!uploadUrl) throw new Error("Upload could not start (no upload URL)");

    const uploadRes = await fetch(uploadUrl, {
      method: "PUT",
      headers: {
        "Content-Type": "image/jpeg",
        "X-Goog-Upload-Command": "upload, finalize",
        "X-Goog-Upload-Offset": "0",
      },
      body: blob,
    });
    if (!uploadRes.ok) throw new Error(`Upload failed: ${uploadRes.status}`);

    // The resumable upload finalize response uses the GCS format and does not
    // include downloadTokens. Fetch the Firebase Storage object metadata to get it.
    const metaRes = await fetch(
      `${firebaseStorageBaseUrl}/${avatarObjectKey(user.uid)}`,
      { headers: { Authorization: `Bearer ${token}` } },
    );
    if (!metaRes.ok) throw new Error(`Failed to fetch storage metadata: ${metaRes.status}`);
    const meta = await metaRes.json() as { downloadTokens?: string };

    // `v` busts expo-image's URL-keyed cache. Overwriting an object does not
    // always mint a fresh downloadToken, and without this the new picture can
    // upload successfully and still render as the old one.
    const downloadURL =
      `${firebaseStorageBaseUrl}/${avatarObjectKey(user.uid)}` +
      `?alt=media&token=${meta.downloadTokens}&v=${Date.now()}`;

    const updateRes = await fetch(
      firestoreDocumentUrl("users", user.uid) + "?updateMask.fieldPaths=avatar",
      {
        method: "PATCH",
        headers: {
          Authorization: `Bearer ${token}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          fields: {
            avatar: { stringValue: downloadURL },
          },
        }),
      },
    );
    if (!updateRes.ok) {
      throw new Error(`Failed to save avatar to profile: ${updateRes.status}`);
    }

    // Update in-memory cache immediately — no Firestore re-fetch needed.
    updateUserData({ avatar: downloadURL });
    await onUploaded();
  };

  const pickImage = async () => {
    const { status } = await ImagePicker.requestMediaLibraryPermissionsAsync();
    if (status !== "granted") {
      return;
    }

    const result = await ImagePicker.launchImageLibraryAsync({
      // `MediaTypeOptions` is deprecated in expo-image-picker 17; the array form
      // is the supported spelling and silences the console warning.
      mediaTypes: ["images"],
      quality: 1,
    });

    if (!result.canceled) {
      setUploading(true);
      try {
        await uploadImage(result.assets[0].uri);
      } catch (e) {
        // `pickImage` previously had a bare try/finally, so every throw above
        // became an unhandled rejection with no user-facing message.
        Alert.alert(
          "Photo upload failed",
          e instanceof Error ? e.message : "Please try again.",
        );
      } finally {
        setUploading(false);
      }
    }
  };

  return { pickImage, uploading };
}
