import * as Notifications from "expo-notifications";
import * as Device from "expo-device";
import Constants from "expo-constants";
import { Platform } from "react-native";
import { appEnv, firestoreDocumentUrl, withFirebaseApiKey, devWarn, devError } from "@/constants/runtime-config";

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
 * Persist the Expo push token to the user's Firestore document.
 *
 * An Expo push token identifies a *device installation*, not an environment — one
 * EAS project serves dev and production alike, and both builds share a bundle id —
 * so the servers cannot otherwise tell that sending to a token would ring a phone
 * running the *other* build. Two extra fields make that decidable:
 *
 *   • `expoPushTokenEnv`       — which environment registered it.
 *   • `expoPushTokenUpdatedAt` — when. In dev the servers additionally require
 *     this to be recent, so a device that ran a dev build once and has since gone
 *     back to the store build ages out instead of being paged by a dev test.
 *
 * This runs on every authenticated launch (use-push-notifications), so both
 * fields stay current with no migration and no allowlist to maintain.
 */
export async function savePushTokenToFirestore(
  uid: string,
  token: string,
  idToken: string,
): Promise<void> {
  const url = withFirebaseApiKey(
    `${firestoreDocumentUrl("users", uid)}?updateMask.fieldPaths=expoPushToken` +
      `&updateMask.fieldPaths=expoPushTokenEnv` +
      `&updateMask.fieldPaths=expoPushTokenUpdatedAt`,
  );

  const res = await fetch(url, {
    method: "PATCH",
    headers: {
      Authorization: `Bearer ${idToken}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      fields: {
        expoPushToken: { stringValue: token },
        expoPushTokenEnv: { stringValue: appEnv },
        // Client clock, so it carries whatever skew the device has. Irrelevant
        // against the multi-day freshness window the servers compare it to.
        expoPushTokenUpdatedAt: { timestampValue: new Date().toISOString() },
      },
    }),
  });

  if (!res.ok) {
    devError("Failed to save push token to Firestore:", res.status);
  }
}
