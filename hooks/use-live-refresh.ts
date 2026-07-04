import { useFocusEffect } from "expo-router";
import { useCallback, useEffect, useRef } from "react";
import { AppState, type AppStateStatus } from "react-native";

/**
 * Re-runs `refetch` whenever the screen regains focus or the app returns to the
 * foreground, so REST-fetched data re-syncs without the user pulling to refresh.
 * Concurrent invocations are de-duped via an in-flight guard.
 *
 * Relies on `useFocusEffect`, so call this from inside a screen component (it
 * needs a navigation context). For provider-level foreground sync that lives
 * above the navigator, use a plain `AppState` listener instead.
 */
export function useLiveRefresh(refetch: () => void | Promise<void>): void {
  const inFlight = useRef(false);

  const run = useCallback(async () => {
    if (inFlight.current) return;
    inFlight.current = true;
    try {
      await refetch();
    } finally {
      inFlight.current = false;
    }
  }, [refetch]);

  // Re-sync each time the screen regains focus (e.g. switching back to the tab).
  useFocusEffect(
    useCallback(() => {
      void run();
    }, [run]),
  );

  // Re-sync when the app returns to the foreground.
  useEffect(() => {
    const sub = AppState.addEventListener("change", (state: AppStateStatus) => {
      if (state === "active") void run();
    });
    return () => sub.remove();
  }, [run]);
}
