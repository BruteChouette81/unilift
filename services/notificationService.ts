import * as Notifications from "expo-notifications";
import * as Device from "expo-device";
import Constants from "expo-constants";
import { Platform } from "react-native";
import { firestoreDocumentUrl, withFirebaseApiKey } from "@/constants/runtime-config";

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
 * Persist the Expo push token to the user's Firestore document.
 */
export async function savePushTokenToFirestore(
  uid: string,
  token: string,
  idToken: string,
): Promise<void> {
  const url = withFirebaseApiKey(
    `${firestoreDocumentUrl("users", uid)}?updateMask.fieldPaths=expoPushToken`,
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
      },
    }),
  });

  if (!res.ok) {
    console.error("Failed to save push token to Firestore:", res.status);
  }
}
