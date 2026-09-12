import * as Notifications from "expo-notifications";
import * as Device from "expo-device";
import Constants from "expo-constants";
import { Platform } from "react-native";
import { getAuth } from "firebase/auth";
import {
  apiBaseUrl,
  apiFetch,
  appEnv,
  devError,
  devWarn,
  firestoreDocumentUrl,
  withFirebaseApiKey,
} from "@/constants/runtime-config";

/**
 * Set up the default Android notification channel.
 * Must be called before any notification is displayed on Android.
 */
export function setupNotificationChannel(): void {
  if (Platform.OS === "android") {
    Notifications.setNotificationChannelAsync("default", {
      name: "Default",
      importance: Notifications.AndroidImportance.MAX,
      vibrationPattern: [0, 250, 250, 250],
      lightColor: "#7C3AED",
    });
  }
}

/**
 * Request permission and return the Expo push token.
 * Returns `null` if running on a simulator or permission is denied.
 */
export async function registerForPushNotifications(): Promise<string | null> {
  if (!Device.isDevice) {
    devWarn("Push notifications require a physical device.");
    return null;
  }

  const { status: existing } = await Notifications.getPermissionsAsync();
  let finalStatus = existing;

  if (existing !== "granted") {
    const { status } = await Notifications.requestPermissionsAsync();
    finalStatus = status;
  }

  if (finalStatus !== "granted") {
    devWarn("Push notification permission not granted.");
    return null;
  }

  const projectId =
    Constants.expoConfig?.extra?.eas?.projectId ??
    Constants.easConfig?.projectId;

  if (!projectId) {
    devError("Missing EAS projectId — cannot get push token.");
    return null;
  }

  try {
    const { data: token } = await Notifications.getExpoPushTokenAsync({ projectId });
    return token;
  } catch (err) {
    devWarn("Could not fetch Expo push token (non-fatal):", err);
    return null;
  }
}

/**
 * Register the Expo push token for this account, via the backend.
 *
 * A push token identifies one physical *device*, not one account and not one
 * environment, which creates two separate problems the server has to settle:
 *
 *   • Two accounts, one phone. If this device registered the token under a
 *     different account before (signed out, signed in as someone else), that
 *     account must stop being reachable through it. The endpoint atomically
 *     moves the token to the caller and strips it from everyone else.
 *   • Two builds, one EAS project. Dev and production share a project id and a
 *     bundle id, so nothing else tells the servers that sending to a token
 *     would ring a phone running the *other* build. Two fields make it
 *     decidable: `expoPushTokenEnv` (which environment registered it, sent
 *     below) and `expoPushTokenUpdatedAt` (when — stamped server-side). In dev
 *     the servers additionally require the timestamp to be recent, so a device
 *     that ran a dev build once and has since gone back to the store build ages
 *     out instead of being paged by a dev test.
 *
 * This runs on every authenticated launch (use-push-notifications), so both
 * fields stay current with no migration and no allowlist to maintain. `uid` is
 * kept for call-site clarity; the server derives the account from `idToken`.
 */
export async function savePushTokenToFirestore(
  uid: string,
  token: string,
  idToken: string,
): Promise<void> {
  const res = await apiFetch(`${apiBaseUrl}/notifications/register-token`, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${idToken}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({ token, env: appEnv }),
  });

  if (!res.ok) {
    devError("Failed to register push token:", res.status);
  }
}

/**
 * Clear this device's push token from the currently signed-in account.
 * Call on sign-out so a device that logs into a different account (or none)
 * stops receiving pushes for the account it just left. Best-effort — a
 * failure here must never block sign-out.
 *
 * Clears the env/updatedAt tags alongside the token itself: they describe a
 * registration that no longer exists, and leaving them behind would strand a
 * stale "dev" tag on the account.
 */
export async function clearPushToken(): Promise<void> {
  const user = getAuth().currentUser;
  if (!user) return;

  const idToken = await user.getIdToken();
  const url = withFirebaseApiKey(
    `${firestoreDocumentUrl("users", user.uid)}?updateMask.fieldPaths=expoPushToken` +
      `&updateMask.fieldPaths=expoPushTokenEnv` +
      `&updateMask.fieldPaths=expoPushTokenUpdatedAt`,
  );

  // An empty `fields` against that mask deletes exactly those three paths.
  const res = await fetch(url, {
    method: "PATCH",
    headers: {
      Authorization: `Bearer ${idToken}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({ fields: {} }),
  });

  if (!res.ok) {
    devError("Failed to clear push token:", res.status);
  }
}
