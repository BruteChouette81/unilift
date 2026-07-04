import { useCallback, useEffect, useRef, useState } from "react";
import * as Notifications from "expo-notifications";
import { AppState, AppStateStatus, Linking, Platform } from "react-native";
import { useAuth } from "@/context/AuthContext";
import {
  registerForPushNotifications,
  savePushTokenToFirestore,
  setupNotificationChannel,
} from "@/services/notificationService";

export type NotificationGate = {
  loading: boolean;
  permissionGranted: boolean;
  permissionDenied: boolean;
  requesting: boolean;
  requestPermission: () => Promise<void>;
  openSettings: () => Promise<void>;
};

async function checkPermission(): Promise<{ granted: boolean; denied: boolean }> {
  try {
    const { status } = await Notifications.getPermissionsAsync();
    return { granted: status === "granted", denied: status === "denied" };
  } catch {
    return { granted: false, denied: false };
  }
}

/**
 * Hard gate: blocks the app until the OS notification permission is granted.
 * Re-checks on every AppState foreground transition so the gate clears
 * automatically when the user returns from iOS/Android Settings.
 */
export function useNotificationGate(): NotificationGate {
  const { user, status } = useAuth();
  const [loading, setLoading] = useState(true);
  const [permissionGranted, setPermissionGranted] = useState(false);
  const [permissionDenied, setPermissionDenied] = useState(false);
  const [requesting, setRequesting] = useState(false);
  const appState = useRef<AppStateStatus>(AppState.currentState);

  const refresh = useCallback(async () => {
    const { granted, denied } = await checkPermission();
    setPermissionGranted(granted);
    setPermissionDenied(denied);
  }, []);

  // Initial permission check once authenticated.
  useEffect(() => {
    if (status !== "authenticated" || !user) {
      setLoading(false);
      setPermissionGranted(true); // transparent for non-auth flows
      return;
    }
    setLoading(true);
    refresh().finally(() => setLoading(false));
  }, [status, user, refresh]);

  // Re-check when app returns to foreground (covers "go to Settings, grant, come back").
  useEffect(() => {
    const sub = AppState.addEventListener("change", (next: AppStateStatus) => {
      if (appState.current !== "active" && next === "active") {
        void refresh();
      }
      appState.current = next;
    });
    return () => sub.remove();
  }, [refresh]);

  const requestPermission = useCallback(async () => {
    if (!user) return;
    setRequesting(true);
    try {
      setupNotificationChannel();
      const token = await registerForPushNotifications();
      const { granted, denied } = await checkPermission();
      setPermissionGranted(granted);
      setPermissionDenied(denied);
      if (token) {
        const idToken = await user.getIdToken();
        await savePushTokenToFirestore(user.uid, token, idToken);
      }
    } catch (err) {
      console.warn("useNotificationGate: requestPermission failed", err);
    } finally {
      setRequesting(false);
    }
  }, [user]);

  const openSettings = useCallback(async () => {
    if (Platform.OS === "ios") {
      await Linking.openURL("app-settings:");
    } else {
      await Linking.openSettings();
    }
  }, []);

  return { loading, permissionGranted, permissionDenied, requesting, requestPermission, openSettings };
}
