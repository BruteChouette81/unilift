import { type HypeEvent } from "@/constants/events";
import {
  fetchHypeEvents,
  getCachedHypeEventsSync,
  loadCachedHypeEvents,
} from "@/services/eventService";
import { useEffect, useState } from "react";

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
 */
export function useHypeEvents(): HypeEvent[] {
  const [events, setEvents] = useState<HypeEvent[]>(() => getCachedHypeEventsSync() ?? []);

  useEffect(() => {
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
