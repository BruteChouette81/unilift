import * as Notifications from "expo-notifications";
import * as Device from "expo-device";
import Constants from "expo-constants";
import { Platform } from "react-native";
import { getAuth } from "firebase/auth";
import {
  apiBaseUrl,
  apiFetch,
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
    console.warn("Push notifications require a physical device.");
    return null;
  }

  const { status: existing } = await Notifications.getPermissionsAsync();
  let finalStatus = existing;

  if (existing !== "granted") {
    const { status } = await Notifications.requestPermissionsAsync();
    finalStatus = status;
  }

  if (finalStatus !== "granted") {
    console.warn("Push notification permission not granted.");
    return null;
  }

  const projectId =
    Constants.expoConfig?.extra?.eas?.projectId ??
    Constants.easConfig?.projectId;

  if (!projectId) {
    console.error("Missing EAS projectId — cannot get push token.");
    return null;
  }

  try {
    const { data: token } = await Notifications.getExpoPushTokenAsync({ projectId });
    return token;
  } catch (err) {
    console.warn("Could not fetch Expo push token (non-fatal):", err);
    return null;
  }
}

/**
 * Register the Expo push token for this account, via the backend.
 * A push token identifies one physical device, not one account — the server
 * also strips it from any other account that previously registered it on
 * this device, so only the currently signed-in account is ever reachable
 * through it. `uid` is kept for call-site clarity; the server derives the
 * account from `idToken`.
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
    body: JSON.stringify({ token }),
  });

  if (!res.ok) {
    console.error("Failed to register push token:", res.status);
  }
}

/**
 * Clear this device's push token from the currently signed-in account.
 * Call on sign-out so a device that logs into a different account (or none)
 * stops receiving pushes for the account it just left. Best-effort — a
 * failure here must never block sign-out.
 */
export async function clearPushToken(): Promise<void> {
  const user = getAuth().currentUser;
  if (!user) return;

  const idToken = await user.getIdToken();
  const url = withFirebaseApiKey(
    `${firestoreDocumentUrl("users", user.uid)}?updateMask.fieldPaths=expoPushToken`,
  );

  const res = await fetch(url, {
    method: "PATCH",
    headers: {
      Authorization: `Bearer ${idToken}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({ fields: {} }),
  });

  if (!res.ok) {
    console.error("Failed to clear push token:", res.status);
  }
}
