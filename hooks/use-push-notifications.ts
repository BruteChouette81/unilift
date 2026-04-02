import { useEffect, useRef } from "react";
import * as Notifications from "expo-notifications";
import { useAuth } from "@/context/AuthContext";
import {
  registerForPushNotifications,
  savePushTokenToFirestore,
  setupNotificationChannel,
} from "@/services/notificationService";

/** Configure how notifications appear when the app is in the foreground. */
Notifications.setNotificationHandler({
  handleNotification: async () => ({
    shouldShowAlert: true,
    shouldPlaySound: true,
    shouldSetBadge: false,
  }),
});

/**
 * Hook that registers for push notifications when the user is authenticated,
 * saves the token to Firestore, and sets up notification listeners.
 *
 * Call this once in the root layout.
 */
export function usePushNotifications(): void {
  const { user, status } = useAuth();
  const notificationListener = useRef<Notifications.EventSubscription | null>(null);
  const responseListener = useRef<Notifications.EventSubscription | null>(null);

  useEffect(() => {
    if (status !== "authenticated" || !user) return;

    let cancelled = false;

    setupNotificationChannel();

    (async () => {
      try {
        const token = await registerForPushNotifications();
        if (cancelled || !token) return;

        const idToken = await user.getIdToken();
        await savePushTokenToFirestore(user.uid, token, idToken);
      } catch (err) {
        console.error("Push notification registration failed:", err);
      }
    })();

    // Listener: notification received while app is foregrounded
    notificationListener.current = Notifications.addNotificationReceivedListener(
      (notification) => {
        console.log("Notification received:", notification);
      },
    );

    // Listener: user tapped on a notification
    responseListener.current = Notifications.addNotificationResponseReceivedListener(
      (response) => {
        console.log("Notification tapped:", response);
      },
    );

    return () => {
      cancelled = true;
      notificationListener.current?.remove();
      responseListener.current?.remove();
    };
  }, [status, user]);
}
