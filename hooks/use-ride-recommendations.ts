import { RIDE_SEARCH, isWithinDepartureWindow } from "@/constants/ride-search";
import type { Ride, ScoredRide, UserProfile } from "@/types/models";
import { findMatchesForPassenger, MatchResult, PassengerRequest } from "@/utils/matching/matchRide";

// ─── Geometry ────────────────────────────────────────────────────────────────

export function haversineKm(
  lat1: number,
  lon1: number,
  lat2: number,
  lon2: number,
): number {
  if ([lat1, lon1, lat2, lon2].some((v) => v == null || isNaN(v))) return Infinity;
  const R = 6371;
  const dLat = ((lat2 - lat1) * Math.PI) / 180;
  const dLon = ((lon2 - lon1) * Math.PI) / 180;
  const a =
    Math.sin(dLat / 2) ** 2 +
    Math.cos((lat1 * Math.PI) / 180) *
      Math.cos((lat2 * Math.PI) / 180) *
      Math.sin(dLon / 2) ** 2;
  return R * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
}

export function bearingDeg(
  lat1: number,
  lon1: number,
  lat2: number,
  lon2: number,
): number {
  const φ1 = (lat1 * Math.PI) / 180;
  const φ2 = (lat2 * Math.PI) / 180;
  const Δλ = ((lon2 - lon1) * Math.PI) / 180;
  const x = Math.sin(Δλ) * Math.cos(φ2);
  const y = Math.cos(φ1) * Math.sin(φ2) - Math.sin(φ1) * Math.cos(φ2) * Math.cos(Δλ);
  return ((Math.atan2(x, y) * 180) / Math.PI + 360) % 360;
}

// ─── Adaptive Config ─────────────────────────────────────────────────────────

type AdaptiveParams = {
  decayRadius: number;
  peakMinutes: number;
  minScoreCutoff: number;
};

export function getAdaptiveParams(poolSize: number): AdaptiveParams {
  if (poolSize <= 2)  return { decayRadius: 20, peakMinutes: 120, minScoreCutoff: 0.0  };
  if (poolSize <= 5)  return { decayRadius: 15, peakMinutes: 90,  minScoreCutoff: 0.15 };
  if (poolSize <= 10) return { decayRadius: 10, peakMinutes: 60,  minScoreCutoff: 0.25 };
  if (poolSize <= 20) return { decayRadius: 7,  peakMinutes: 45,  minScoreCutoff: 0.30 };
  return               { decayRadius: 5,  peakMinutes: 30,  minScoreCutoff: 0.35 };
}

// ─── Dimension Scorers ───────────────────────────────────────────────────────

export function scoreDistance(pickupKm: number | null, decayRadius: number): number {
  if (pickupKm == null) return 0.5;
  return Math.exp(-((pickupKm / decayRadius) ** 2));
}

export function scoreTime(
  rideDate: string | undefined,
  nowMs: number,
  peakMinutes: number,
): number {
  if (!rideDate) return 0.4;
  const parsed = Date.parse(rideDate);
  if (isNaN(parsed)) return 0.4;
  const deltaMin = (parsed - nowMs) / 60_000;
  if (deltaMin < 0) return Math.exp(-((Math.abs(deltaMin) / 5) ** 2));
  if (deltaMin <= peakMinutes) return 1.0;
  return Math.exp(-(((deltaMin - peakMinutes) / peakMinutes) ** 2));
}

export function scoreDirection(
  userLat: number | null,
  userLon: number | null,
  destLat: number,
  destLon: number,
  refs: Array<{ lat: number; lon: number }>,
): number {
  if (userLat == null || userLon == null) return 0.5;
  const validRefs = refs.filter((r) => !(r.lat === 0 && r.lon === 0));
  if (validRefs.length === 0) return 0.5;
  const rideBearing = bearingDeg(userLat, userLon, destLat, destLon);
  let maxSim = 0;
  for (const ref of validRefs) {
    const refBearing = bearingDeg(userLat, userLon, ref.lat, ref.lon);
    const diff = Math.abs(rideBearing - refBearing);
    const angleDiff = Math.min(diff, 360 - diff);
    const sim = (Math.cos((angleDiff * Math.PI) / 180) + 1) / 2;
    if (sim > maxSim) maxSim = sim;
  }
  return maxSim;
}

export function scorePreference(
  ride: Ride,
  _userPreferences: string[],
  driverLevel: number,
): number {
  const seatScore   = Math.min(ride.seatsAvailable / 4, 1.0);
  const driverScore = driverLevel > 0 ? Math.min(driverLevel / 50, 1.0) : 0.5;
  const tagScore    = 0.5; // placeholder until ride tags exist in Firestore
  return 0.4 * seatScore + 0.4 * driverScore + 0.2 * tagScore;
}

// ─── Pipeline Weights ────────────────────────────────────────────────────────

const DEFAULT_WEIGHTS = {
  distance:   0.35,
  time:       0.30,
  direction:  0.25,
  preference: 0.10,
};

// ─── Options ─────────────────────────────────────────────────────────────────

export type RecommendOptions = {
  nowMs?: number;
  weights?: {
    distance?:   number;
    time?:       number;
    direction?:  number;
    preference?: number;
  };
  driverLevelCache?: Map<string, number>;
  /** When set, only rides whose `departureAt` lies within
   *  `±departureToleranceMinutes` of this timestamp (ms) are kept.
   *  Legacy rides without `departureAt` are kept only if the search
   *  is "leave now" (within legacyLeaveNowToleranceMinutes). */
  searchDepartureMs?: number;
  departureToleranceMinutes?: number;
};

// ─── Detour-Based Matching ───────────────────────────────────────────────────

export type { PassengerRequest, MatchResult };

/**
 * Returns rides sorted by detour score. Rides whose added detour exceeds
 * `ride.maxDetourKm` (default 5 km) are excluded.
 */
export function useDetourRecommendations(
  rides: Ride[],
  passenger: PassengerRequest,
  maxDetourKmOverride?: number,
): MatchResult[] {
  return findMatchesForPassenger(passenger, rides, maxDetourKmOverride);
}

// ─── Main Export ─────────────────────────────────────────────────────────────

/** @deprecated Use useDetourRecommendations for detour-based matching */
export function recommendRides(
  rides: Ride[],
  userProfile: UserProfile,
  options: RecommendOptions = {},
): ScoredRide[] {
  if (rides.length === 0) return [];

  const nowMs = options.nowMs ?? Date.now();
  const w = { ...DEFAULT_WEIGHTS, ...options.weights };
  const driverCache = options.driverLevelCache ?? new Map<string, number>();

  const refs = (userProfile.favorite ?? [])
    .filter((f) => !(f.destinationGeo.lat === 0 && f.destinationGeo.lon === 0))
    .map((f) => ({ lat: f.destinationGeo.lat, lon: f.destinationGeo.lon }));

  const userLat = userProfile.localisation.latitude;
  const userLon = userProfile.localisation.longitude;
  const hasUserLoc = userLat !== null && userLon !== null;

  const params = getAdaptiveParams(rides.length);

  const scored: ScoredRide[] = [];
  const departureFilterMs = options.searchDepartureMs;
  const departureTolerance =
    options.departureToleranceMinutes ?? RIDE_SEARCH.departureToleranceMinutes;

  for (const ride of rides) {
    if (departureFilterMs !== undefined) {
      if (
        !isWithinDepartureWindow(
          ride.departureAt,
          departureFilterMs,
          departureTolerance,
        )
      ) {
        continue;
      }
    }

    const pickupKm = hasUserLoc
      ? haversineKm(userLat!, userLon!, ride.localisation.latitude, ride.localisation.longitude)
      : null;

    const distance   = scoreDistance(pickupKm, params.decayRadius);
    const time       = scoreTime(ride.date, nowMs, params.peakMinutes);
    const direction  = scoreDirection(
      userLat,
      userLon,
      ride.destinationCoords.latitude,
      ride.destinationCoords.longitude,
      refs,
    );
    const driverLevel = driverCache.get(ride.driverId) ?? 0;
    const preference  = scorePreference(ride, userProfile.preferences ?? [], driverLevel);

    const composite =
      w.distance   * distance +
      w.time       * time +
      w.direction  * direction +
      w.preference * preference;

    if (composite < params.minScoreCutoff) continue;

    scored.push({
      ...ride,
      score: composite,
      scoreBreakdown: { distance, time, direction, preference, composite },
    });
  }

  scored.sort((a, b) => b.score - a.score);
  return scored;
}
