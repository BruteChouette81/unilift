import { useCallback, useEffect, useRef, useState } from "react";
import * as Notifications from "expo-notifications";
import { Linking, Platform } from "react-native";
import { useAuth } from "@/context/AuthContext";
import {
  registerForPushNotifications,
  savePushTokenToFirestore,
  setupNotificationChannel,
} from "@/services/notificationService";

type NotificationPrompt = {
  visible: boolean;
  enabling: boolean;
  /** True when the OS permission was already denied — primary action opens Settings instead. */
  permissionDenied: boolean;
  enable: () => Promise<void>;
  dismiss: () => void;
};

/**
 * Shows the "turn on notifications" priming modal on every app launch for any
 * authenticated user whose OS permission is not yet granted. Dismissed once per
 * session (via ref), but reappears on the next launch until permission is granted.
 */
export function useNotificationPrompt(): NotificationPrompt {
  const { user, status } = useAuth();
  const [visible, setVisible] = useState(false);
  const [enabling, setEnabling] = useState(false);
  const [permissionDenied, setPermissionDenied] = useState(false);
  // Prevent re-showing within the same app session after the user dismisses.
  const shownThisSession = useRef(false);

  useEffect(() => {
    if (status !== "authenticated" || !user || shownThisSession.current) return;
    let cancelled = false;

    (async () => {
      try {
        const { status: perm } = await Notifications.getPermissionsAsync();
        if (perm === "granted") return;
        if (!cancelled) {
          shownThisSession.current = true;
          setPermissionDenied(perm === "denied");
          setVisible(true);
        }
      } catch {
        // Permission lookup can fail on simulators — stay silent.
      }
    })();

    return () => { cancelled = true; };
  }, [status, user]);

  const dismiss = useCallback(() => {
    setVisible(false);
  }, []);

  const enable = useCallback(async () => {
    if (!user) return;

    // When OS permission is already denied we can only send the user to Settings.
    const { status: current } = await Notifications.getPermissionsAsync();
    if (current === "denied") {
      if (Platform.OS === "ios") {
        await Linking.openURL("app-settings:");
      }
      setVisible(false);
      return;
    }

    setEnabling(true);
    try {
      setupNotificationChannel();
      const token = await registerForPushNotifications();
      if (token) {
        const idToken = await user.getIdToken();
        await savePushTokenToFirestore(user.uid, token, idToken);
      }
    } catch (err) {
      console.warn("Enabling notifications failed:", err);
    } finally {
      setEnabling(false);
      setVisible(false);
    }
  }, [user]);

  return { visible, enabling, permissionDenied, enable, dismiss };
}
