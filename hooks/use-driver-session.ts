import { fetchMyDriverSession, goOffline as goOfflineSvc } from "@/services/driverSessionService";
import type { DriverSession } from "@/types/models";
import type { User } from "firebase/auth";
import { useCallback, useEffect, useState } from "react";

/** Tracks the current user's driver session (online/offline) and exposes a
 *  refresh + goOffline. Used by the persistent "You're online" banner and the
 *  driver inbox. */
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

  return { session, isOnline, loading, reload, goOffline, setSession };
}
