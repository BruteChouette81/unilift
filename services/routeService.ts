import { runtimeConfig } from "@/constants/runtime-config";
import type { LocationPoint } from "@/types/models";

// ─── Types ──────────────────────────────────────────────────────────────────

export type RouteStats = {
  distanceKm: number;
  durationSeconds: number;
};

export type SegmentStats = {
  distanceKm: number;
  durationSeconds: number;
};

export type MultiWaypointResult = {
  total: RouteStats;
  segments: SegmentStats[];
  /** Google-encoded overview polyline for the entire route. */
  overviewPolyline?: string;
};

// ─── Helpers ────────────────────────────────────────────────────────────────

const GOOGLE_DIRECTIONS_URL =
  "https://maps.googleapis.com/maps/api/directions/json";

const toLatLng = (p: LocationPoint): string => `${p.latitude},${p.longitude}`;

const isRecord = (v: unknown): v is Record<string, unknown> =>
  typeof v === "object" && v !== null;

async function fetchGoogleDirections(
  origin: LocationPoint,
  destination: LocationPoint,
  waypoints?: LocationPoint[],
  signal?: AbortSignal,
): Promise<unknown | null> {
  try {
    const params = new URLSearchParams({
      origin: toLatLng(origin),
      destination: toLatLng(destination),
      key: runtimeConfig.googleMapsApiKey,
    });

    if (waypoints && waypoints.length > 0) {
      params.set("waypoints", waypoints.map(toLatLng).join("|"));
    }

    const res = await fetch(`${GOOGLE_DIRECTIONS_URL}?${params.toString()}`, {
      signal,
    });
    if (!res.ok) {
      console.warn(`[routeService] Google Directions HTTP error (${res.status})`);
      return null;
    }
    const data = await res.json();
    if (isRecord(data) && data.status !== "OK") {
      console.warn(`[routeService] Google Directions status: ${data.status}`);
      return null;
    }
    return data;
  } catch (e: unknown) {
    if (e instanceof Error && e.name === "AbortError") return null;
    console.error("[routeService] Directions fetch error:", e);
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
 * Returns the extra road distance (km) a driver adds by detouring to pick up
 * a passenger at `pickup`, compared to going directly to `destination`.
 * Returns null when either Directions API call fails.
 */
export async function getDetourKm(
  driverOrigin: LocationPoint,
  passengerPickup: LocationPoint,
  driverDestination: LocationPoint,
  signal?: AbortSignal,
): Promise<number | null> {
  const [direct, withPickup] = await Promise.all([
    getRouteStats(driverOrigin, driverDestination, signal),
    getMultiWaypointRoute([driverOrigin, passengerPickup, driverDestination], signal),
  ]);
  if (!direct || !withPickup) return null;
  return Math.max(0, withPickup.total.distanceKm - direct.distanceKm);
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
export async function getRouteExtensionKm(
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
    console.warn("[routeService] getRouteExtensionKm: missing direct route stats");
    return null;
  }
  if (!extended) {
    console.warn("[routeService] getRouteExtensionKm: missing extended route stats");
    return null;
  }

  const baseKm = direct.distanceKm;
  const extendedKm = extended.total.distanceKm;
  const diffKm = Math.max(0, extendedKm - baseKm);

  return { baseKm, extendedKm, diffKm };
}
