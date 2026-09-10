import { HYPE_MAP_ENABLED, type HypeEvent } from "@/constants/events";
import {
  fetchHypeEvents,
  getCachedHypeEventsSync,
  loadCachedHypeEvents,
} from "@/services/eventService";
import { useEffect, useState } from "react";

/** Stable reference — a fresh `[]` each render would retrigger every consumer's
 *  memos and effects. */
const EMPTY: HypeEvent[] = [];

/**
 * Hype-map events, cache-first so flames render instantly.
 *
 * Paint order:
 *   1. memory cache — synchronous, so a tab switch re-renders flames on frame 1
 *   2. disk cache   — one async hop, covers a cold start
 *   3. network      — revalidates in the background and refreshes both caches
 *
 * A failed fetch (`null`) leaves the cached events on screen rather than
 * blanking the map.
 *
 * Returns an empty list and reads nothing while HYPE_MAP_ENABLED is false. The
 * guard lives here rather than at the call site so the flag governs the DATA as
 * well as the UI — hiding the markers while still doing a disk read and a
 * Firestore fetch on every home-screen mount would be a silent cost for a
 * feature nobody can see.
 */
export function useHypeEvents(): HypeEvent[] {
  const [events, setEvents] = useState<HypeEvent[]>(
    () => (HYPE_MAP_ENABLED ? getCachedHypeEventsSync() ?? [] : EMPTY),
  );

  useEffect(() => {
    if (!HYPE_MAP_ENABLED) return;
    let cancelled = false;
    // Guards the cache→network race: the disk read must never land on top of a
    // fresh result that happened to arrive first.
    let freshArrived = false;

    void loadCachedHypeEvents().then((cached) => {
      if (cancelled || freshArrived || cached.length === 0) return;
      setEvents(cached);
    });

    void fetchHypeEvents().then((fresh) => {
      if (cancelled) return;
      freshArrived = true;
      // null = fetch failed; keep whatever the cache already painted.
      if (fresh !== null) setEvents(fresh);
    });

    return () => { cancelled = true; };
  }, []);

  return events;
}
