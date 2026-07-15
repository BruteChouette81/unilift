import AsyncStorage from "@react-native-async-storage/async-storage";
import { useCallback, useEffect, useRef, useState } from "react";

const STORAGE_PREFIX = "unilift:wizard:";

/**
 * Tracks whether a given first-run wizard/coach flow has already been seen.
 *
 * - `ready` flips to true once the persisted flag has been read (avoids a flash
 *   where the wizard briefly shows before we know it was already dismissed).
 * - `shouldShow` is true only when the flow has never been completed/skipped.
 * - `markSeen()` persists the "seen" flag so it never auto-shows again.
 * - `replay()` re-opens the flow on demand (for "Show me again" affordances)
 *   without clearing the persisted flag.
 *
 * Each flow gets a stable `key` (e.g. "signup", "wallet-card", "home-search").
 */
export function useFirstRun(key: string) {
  const storageKey = STORAGE_PREFIX + key;
  const [ready, setReady] = useState(false);
  const [seen, setSeen] = useState(true);
  const [replaying, setReplaying] = useState(false);
  const mounted = useRef(true);

  useEffect(() => {
    mounted.current = true;
    AsyncStorage.getItem(storageKey)
      .then((v) => {
        if (!mounted.current) return;
        setSeen(v === "1");
        setReady(true);
      })
      .catch(() => {
        if (!mounted.current) return;
        setReady(true);
      });
    return () => {
      mounted.current = false;
    };
  }, [storageKey]);

  const markSeen = useCallback(() => {
    setSeen(true);
    setReplaying(false);
    AsyncStorage.setItem(storageKey, "1").catch(() => {});
  }, [storageKey]);

  const replay = useCallback(() => {
    setReplaying(true);
  }, []);

  const shouldShow = ready && (!seen || replaying);

  return { ready, seen, shouldShow, markSeen, replay };
}
