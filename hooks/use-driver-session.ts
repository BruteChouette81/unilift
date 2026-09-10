import {
  fetchMyDriverSession,
  goOffline as goOfflineSvc,
  updateDriverSessionLocation,
} from "@/services/driverSessionService";
import { devAwareCurrentPosition } from "@/utils/dev-location";
import type { DriverSession } from "@/types/models";
import type { User } from "firebase/auth";
import * as Location from "expo-location";
import { useCallback, useEffect, useRef, useState } from "react";
import { AppState, type AppStateStatus } from "react-native";

// How often to refresh the session's origin + updatedAt while online.
const HEARTBEAT_MS = 30000;
// Backgrounded longer than this while online ⇒ treat the driver as gone and end
// the session on return. Nothing on the server expires sessions, so without this
// a force-quit leaves `status: "online"` set forever.
const STALE_AFTER_MS = 15 * 60 * 1000;

/** Tracks the current user's driver session (online/offline) and exposes a
 *  refresh + goOffline. Used by the persistent "You're online" banner and the
 *  driver inbox.
 *
 *  Mounted once app-wide (app/_layout.tsx), so the heartbeat below keeps running
 *  no matter which screen the driver is on — it used to live inside
 *  driverRequestsScreen and died the moment that screen unmounted. */
export function useDriverSession(user: User | null) {
  const [session, setSession] = useState<DriverSession | null>(null);
  const [loading, setLoading] = useState(false);

  const reload = useCallback(async () => {
    if (!user) { setSession(null); return; }
    setLoading(true);
    try {
      const s = await fetchMyDriverSession();
      setSession(s && s.status === "online" ? s : null);
    } catch {
      // keep last value
    } finally {
      setLoading(false);
    }
  }, [user]);

  useEffect(() => { void reload(); }, [reload]);

  const goOffline = useCallback(async () => {
    setSession(null);
    try { await goOfflineSvc(); } finally { await reload(); }
  }, [reload]);

  const isOnline = session?.status === "online";

  // ── Session liveness ───────────────────────────────────────────────────────
  // Both effects used to be gated on `isDev`, on the reasoning that broadcast
  // dispatch ignores driverSessions so a stale session was harmless. That was
  // true but fragile: it made the day `USE_LEGACY_MATCHING` flips back to true
  // the day stale "online" sessions silently start corrupting real matching,
  // with nothing to connect the two. Ungated — the cost is one location read per
  // heartbeat for a driver who is deliberately online.

  // Heartbeat: refresh origin + updatedAt so the session reads as alive.
  useEffect(() => {
    if (!isOnline) return;
    const update = async () => {
      try {
        const { status } = await Location.getForegroundPermissionsAsync();
        if (status !== "granted") return;
        const pos = await devAwareCurrentPosition({ accuracy: Location.Accuracy.Balanced });
        await updateDriverSessionLocation({
          latitude: pos.coords.latitude,
          longitude: pos.coords.longitude,
        });
      } catch { /* non-fatal — the next tick retries */ }
    };
    const interval = setInterval(() => void update(), HEARTBEAT_MS);
    return () => clearInterval(interval);
  }, [isOnline]);

  // Auto-offline after a long absence. The heartbeat above stops while
  // backgrounded, so a session that outlived STALE_AFTER_MS is no longer
  // trustworthy — end it rather than keep advertising a driver who has moved on.
  const backgroundedAtRef = useRef<number | null>(null);
  useEffect(() => {
    if (!isOnline) return;
    const onChange = (next: AppStateStatus) => {
      if (next === "active") {
        const since = backgroundedAtRef.current;
        backgroundedAtRef.current = null;
        if (since !== null && Date.now() - since > STALE_AFTER_MS) void goOffline();
      } else if (next === "background" && backgroundedAtRef.current === null) {
        backgroundedAtRef.current = Date.now();
      }
    };
    const sub = AppState.addEventListener("change", onChange);
    return () => sub.remove();
  }, [isOnline, goOffline]);

  return { session, isOnline, loading, reload, goOffline, setSession };
}
