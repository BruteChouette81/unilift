import {
  firebaseStorageBaseUrl,
  firestoreDocumentUrl,
} from "@/constants/runtime-config";
import { useUserProfile } from "@/context/UserProfileContext";
import * as ImageManipulator from "expo-image-manipulator";
import * as ImagePicker from "expo-image-picker";
import type { User } from "firebase/auth";
import { useState } from "react";

type UseProfileAvatarParams = {
  user: User | null;
  onUploaded: () => Promise<void> | void;
};

export function useProfileAvatar({ user, onUploaded }: UseProfileAvatarParams) {
  const { updateUserData } = useUserProfile();
  const [uploading, setUploading] = useState(false);

  const uploadImage = async (uri: string) => {
    if (!user) return;

    const token = await user.getIdToken();

    const converted = await ImageManipulator.manipulateAsync(uri, [], {
      compress: 1,
      format: ImageManipulator.SaveFormat.JPEG,
    });

    const blob = await (await fetch(converted.uri)).blob();

    const startRes = await fetch(
      `${firebaseStorageBaseUrl}?uploadType=resumable&name=profiles/${user.uid}.jpg`,
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

    console.log("Resumable upload start response:", startRes);

    const uploadUrl = await startRes.headers.get("X-Goog-Upload-URL");
    if (!uploadUrl) return;

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
      `${firebaseStorageBaseUrl}/profiles%2F${user.uid}.jpg`,
      { headers: { Authorization: `Bearer ${token}` } },
    );
    if (!metaRes.ok) throw new Error(`Failed to fetch storage metadata: ${metaRes.status}`);
    const meta = await metaRes.json() as { downloadTokens?: string };

    const downloadURL = `${firebaseStorageBaseUrl}/profiles%2F${user.uid}.jpg?alt=media&token=${meta.downloadTokens}`;

    await fetch(firestoreDocumentUrl("users", user.uid) + "?updateMask.fieldPaths=avatar", {
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
    });

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
      mediaTypes: ImagePicker.MediaTypeOptions.Images,
      quality: 1,
    });

    if (!result.canceled) {
      setUploading(true);
      try {
        await uploadImage(result.assets[0].uri);
      } finally {
        setUploading(false);
      }
    }
  };

  return { pickImage, uploading };
}
