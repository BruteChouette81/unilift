import { devWarn, devError } from "@/constants/runtime-config";
import { mapsDirections } from "@/services/mapsService";
import type { LocationPoint } from "@/types/models";
import { isRecord } from "@/services/firestore-rest";

// ─── Types ──────────────────────────────────────────────────────────────────

type RouteStats = {
  distanceKm: number;
  durationSeconds: number;
};

type SegmentStats = {
  distanceKm: number;
  durationSeconds: number;
};

type MultiWaypointResult = {
  total: RouteStats;
  segments: SegmentStats[];
  /** Google-encoded overview polyline for the entire route. */
  overviewPolyline?: string;
};

// ─── Helpers ────────────────────────────────────────────────────────────────

const toLatLng = (p: LocationPoint): string => `${p.latitude},${p.longitude}`;

async function fetchGoogleDirections(
  origin: LocationPoint,
  destination: LocationPoint,
  waypoints?: LocationPoint[],
  signal?: AbortSignal,
): Promise<unknown | null> {
  try {
    // Proxied through the server — see services/mapsService.ts.
    const data = await mapsDirections(
      toLatLng(origin),
      toLatLng(destination),
      waypoints && waypoints.length > 0 ? waypoints.map(toLatLng).join("|") : undefined,
      signal,
    );
    if (!data) return null;
    if (isRecord(data) && data.status !== "OK") {
      devWarn(`[routeService] Google Directions status: ${data.status}`);
      return null;
    }
    return data;
  } catch (e: unknown) {
    if (e instanceof Error && e.name === "AbortError") return null;
    devError("[routeService] Directions fetch error:", e);
    return null;
  }
}

function parseLeg(leg: unknown): RouteStats | null {
  if (!isRecord(leg)) return null;
  const distance = isRecord(leg.distance) ? Number(leg.distance.value) : NaN;
  const duration = isRecord(leg.duration) ? Number(leg.duration.value) : NaN;
  if (!Number.isFinite(distance) || !Number.isFinite(duration)) return null;
  return { distanceKm: distance / 1000, durationSeconds: duration };
}

// ─── Public API ─────────────────────────────────────────────────────────────

/** Fetch road-distance stats for a single A→B leg. */
export async function getRouteStats(
  from: LocationPoint,
  to: LocationPoint,
  signal?: AbortSignal,
): Promise<RouteStats | null> {
  const data = await fetchGoogleDirections(from, to, undefined, signal);
  if (!isRecord(data)) return null;

  const routes = data.routes;
  if (!Array.isArray(routes) || routes.length === 0) return null;

  const route = routes[0];
  if (!isRecord(route)) return null;

  const legs = route.legs;
  if (!Array.isArray(legs) || legs.length === 0) return null;

  return parseLeg(legs[0]);
}

/** Fetch a multi-waypoint route and return per-segment stats. */
export async function getMultiWaypointRoute(
  waypoints: LocationPoint[],
  signal?: AbortSignal,
): Promise<MultiWaypointResult | null> {
  if (waypoints.length < 2) return null;

  const origin = waypoints[0];
  const destination = waypoints[waypoints.length - 1];
  const intermediates = waypoints.slice(1, -1);

  const data = await fetchGoogleDirections(origin, destination, intermediates.length > 0 ? intermediates : undefined, signal);
  if (!isRecord(data)) return null;

  const routes = data.routes;
  if (!Array.isArray(routes) || routes.length === 0) return null;

  const route = routes[0];
  if (!isRecord(route)) return null;

  const legs = route.legs;
  if (!Array.isArray(legs) || legs.length === 0) return null;

  let totalDistanceKm = 0;
  let totalDurationSeconds = 0;
  const segments: SegmentStats[] = [];

  for (const leg of legs) {
    const parsed = parseLeg(leg);
    if (!parsed) continue;
    segments.push(parsed);
    totalDistanceKm += parsed.distanceKm;
    totalDurationSeconds += parsed.durationSeconds;
  }

  if (segments.length === 0) return null;

  const overviewPolyline =
    isRecord(route.overview_polyline) && typeof route.overview_polyline.points === "string"
      ? (route.overview_polyline.points as string)
      : undefined;

  return {
    total: { distanceKm: totalDistanceKm, durationSeconds: totalDurationSeconds },
    segments,
    overviewPolyline,
  };
}

/**
 * Computes the route-length difference (km) introduced by inserting a
 * passenger pickup AND dropoff as intermediate waypoints in the driver's
 * route. The "extended" route is:
 *
 *     driverOrigin → passengerPickup → passengerDestination → driverDestination
 *
 * The difference is `extendedRouteKm − baseRouteKm`, where `baseRouteKm` is
 * the direct origin→destination route. If `baseRouteKm` is provided (typically
 * stored on the ride doc at creation time) we save one Directions API call.
 *
 * Returns `{ baseKm, extendedKm, diffKm }` or `null` if any required
 * Directions call fails.
 */
async function getRouteExtensionKm(
  driverOrigin: LocationPoint,
  driverDestination: LocationPoint,
  passengerPickup: LocationPoint,
  passengerDestination: LocationPoint,
  baseRouteKm?: number,
  signal?: AbortSignal,
): Promise<{ baseKm: number; extendedKm: number; diffKm: number } | null> {
  const extendedPromise = getMultiWaypointRoute(
    [driverOrigin, passengerPickup, passengerDestination, driverDestination],
    signal,
  );

  const directPromise: Promise<RouteStats | null> = baseRouteKm !== undefined
    ? Promise.resolve({ distanceKm: baseRouteKm, durationSeconds: 0 })
    : getRouteStats(driverOrigin, driverDestination, signal);

  const [direct, extended] = await Promise.all([directPromise, extendedPromise]);

  if (!direct) {
    devWarn("[routeService] getRouteExtensionKm: missing direct route stats");
    return null;
  }
  if (!extended) {
    devWarn("[routeService] getRouteExtensionKm: missing extended route stats");
    return null;
  }

  const baseKm = direct.distanceKm;
  const extendedKm = extended.total.distanceKm;
  const diffKm = Math.max(0, extendedKm - baseKm);

  return { baseKm, extendedKm, diffKm };
}
