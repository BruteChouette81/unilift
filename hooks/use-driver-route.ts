import { useEffect, useRef, useState } from "react";

import { getMultiWaypointRoute } from "@/services/routeService";
import type { LocationPoint } from "@/types/models";
import { haversineKm } from "@/utils/matching/geometry";
import { devLog } from "@/constants/runtime-config";

/** Per-leg road distance/time, in stop order: legs[0] is origin → stops[0]. */
export type RouteLeg = {
  distanceKm: number;
  durationSeconds: number;
};

export type DriverRoute = {
  /** Google-encoded overview polyline for origin → every stop. */
  polyline?: string;
  legs: RouteLeg[];
  totalKm: number;
  totalMinutes: number;
  loading: boolean;
};

const EMPTY: DriverRoute = { legs: [], totalKm: 0, totalMinutes: 0, loading: false };

/** Don't re-route until the driver has actually gone somewhere. */
const REFETCH_DISTANCE_KM = 0.25;
/** Floor between Directions calls. The GPS watcher fires every 50 m / 8 s and
 *  each call is billed, so movement alone must not drive the request rate. */
const MIN_REFETCH_INTERVAL_MS = 45_000;

const stopsKey = (stops: LocationPoint[]): string =>
  stops.map((s) => `${s.latitude.toFixed(5)},${s.longitude.toFixed(5)}`).join("|");

/**
 * Road route from the driver's live position through their remaining stops.
 *
 * Returns the overview polyline for the map plus per-leg distance/duration, so
 * the screen can show "3.2 km · 8 min" for the next stop without a second call —
 * `getMultiWaypointRoute` already parses both.
 *
 * Refetches only when the stop list changes, or when the driver has moved more
 * than 250 m AND the throttle window has elapsed. A stop-list change always wins
 * (a passenger was accepted or dropped off, so the old route is simply wrong).
 */
export function useDriverRoute(
  origin: LocationPoint | null,
  stops: LocationPoint[],
): DriverRoute {
  const [route, setRoute] = useState<DriverRoute>(EMPTY);

  // What the last successful (or in-flight) request was made from.
  const lastOriginRef = useRef<LocationPoint | null>(null);
  const lastStopsKeyRef = useRef<string>("");
  const lastFetchAtRef = useRef(0);
  // Held in a ref rather than aborted from the effect cleanup: the effect re-runs
  // on every GPS tick, and a cleanup-based abort would cancel an in-flight
  // request each time the driver moved a few metres — leaving no route at all.
  const controllerRef = useRef<AbortController | null>(null);

  useEffect(() => () => controllerRef.current?.abort(), []);

  const key = stopsKey(stops);

  useEffect(() => {
    if (!origin || stops.length === 0) {
      lastStopsKeyRef.current = "";
      lastOriginRef.current = null;
      setRoute((prev) => (prev === EMPTY ? prev : EMPTY));
      return;
    }

    const stopsChanged = key !== lastStopsKeyRef.current;
    const movedKm = lastOriginRef.current
      ? haversineKm(
          { lat: lastOriginRef.current.latitude, lng: lastOriginRef.current.longitude },
          { lat: origin.latitude, lng: origin.longitude },
        )
      : Infinity;
    const throttled = Date.now() - lastFetchAtRef.current < MIN_REFETCH_INTERVAL_MS;

    if (!stopsChanged && (movedKm < REFETCH_DISTANCE_KM || throttled)) return;

    lastStopsKeyRef.current = key;
    lastOriginRef.current = origin;
    lastFetchAtRef.current = Date.now();

    controllerRef.current?.abort();
    const controller = new AbortController();
    controllerRef.current = controller;
    setRoute((prev) => ({ ...prev, loading: true }));

    (async () => {
      const result = await getMultiWaypointRoute([origin, ...stops], controller.signal);
      if (controller.signal.aborted) return;
      if (!result) {
        // Keep whatever we last had on screen — a stale line beats no line.
        setRoute((prev) => ({ ...prev, loading: false }));
        return;
      }
      devLog("[RIDE-DEBUG] driver route", {
        stops: stops.length,
        legs: result.segments.length,
        km: result.total.distanceKm.toFixed(1),
      });
      setRoute({
        polyline: result.overviewPolyline,
        legs: result.segments,
        totalKm: result.total.distanceKm,
        totalMinutes: Math.round(result.total.durationSeconds / 60),
        loading: false,
      });
    })();
  // `stops` is compared by value through `key`; depending on the array itself
  // would refetch on every parent render.
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [origin, key]);

  return route;
}
