import { useEffect, useRef } from "react";
import * as Notifications from "expo-notifications";
import { router } from "expo-router";
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
    shouldShowBanner: true,
    shouldShowList: true,
  }),
});

/** Route a tapped notification to the right screen based on its `data.type`. */
function handleNotificationTap(data: Record<string, unknown> | undefined) {
  if (!data) return;
  const type = data.type;
  if (type === "passenger_request") {
    // Driver tapped a request notification → open the dedicated accept screen.
    // The payload carries everything needed to resolve + accept on cold start:
    // the request id, the passenger's route, and (for Ride Mode / Flow A) the
    // driver's own destination so the accept works without a live session.
    const d = data as Record<string, string>;
    const qs = new URLSearchParams({
      requestId: d.requestId ?? "",
      riderId: d.riderId ?? "",
      destination: d.destination ?? "",
      fare: d.fare ?? "0",
      origin: d.origin ?? "",
      rideKm: d.rideKm ?? "",
      seats: d.seats ?? "",
      driverDest: d.driverDest ?? "",
      driverDestLat: d.driverDestLat ?? "",
      driverDestLng: d.driverDestLng ?? "",
    }).toString();
    router.push(`/acceptRideScreen?${qs}` as never);
  } else if (type === "driver_accepted" && typeof data.rideId === "string") {
    // Passenger tapped a match notification → open the active ride screen.
    router.push(`/rideScreen?rideId=${data.rideId}&pending=false` as never);
  }
}

/**
 * Registers for push notifications when authenticated, saves the token to
 * Firestore, and routes notification taps. Call once in the root layout.
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
        // Only register a token when permission is already granted. The OS
        // permission *request* is deferred to the in-app priming modal
        // (use-notification-prompt) so users see the value proposition first
        // and we never fire two permission prompts.
        const { status: perm } = await Notifications.getPermissionsAsync();
        if (perm !== "granted") return;
        const token = await registerForPushNotifications();
        if (cancelled || !token) return;
        const idToken = await user.getIdToken();
        await savePushTokenToFirestore(user.uid, token, idToken);
      } catch (err) {
        console.error("Push notification registration failed:", err);
      }
    })();

    // Cold-start: if the app was opened by tapping a notification, route now.
    Notifications.getLastNotificationResponseAsync()
      .then((response) => {
        if (response) handleNotificationTap(response.notification.request.content.data as Record<string, unknown>);
      })
      .catch(() => {});

    notificationListener.current = Notifications.addNotificationReceivedListener(
      () => { /* OS shows the banner; no-op */ },
    );

    responseListener.current = Notifications.addNotificationResponseReceivedListener(
      (response) => handleNotificationTap(response.notification.request.content.data as Record<string, unknown>),
    );

    return () => {
      cancelled = true;
      notificationListener.current?.remove();
      responseListener.current?.remove();
    };
  }, [status, user]);
}
