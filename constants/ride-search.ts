export const RIDE_SEARCH = {
  departureToleranceMinutes: 30,
  legacyLeaveNowToleranceMinutes: 5,
  /** Legacy single-waypoint detour cap (kept for fallback use). */
  maxDetourKm: 10,
  /** Maximum acceptable route-length difference (km) when the passenger
   *  pickup AND dropoff are inserted as waypoints in the driver's route. */
  maxRouteExtensionKm: 10,
  destinationMatchKm: 3,
} as const;

export function isWithinDepartureWindow(
  rideDepartureIso: string | undefined,
  searchDepartureMs: number,
  toleranceMinutes: number = RIDE_SEARCH.departureToleranceMinutes,
): boolean {
  if (!rideDepartureIso) {
    const nowMs = Date.now();
    const legacyTolerance =
      RIDE_SEARCH.legacyLeaveNowToleranceMinutes * 60_000;
    return Math.abs(searchDepartureMs - nowMs) <= legacyTolerance;
  }
  const rideMs = new Date(rideDepartureIso).getTime();
  if (!Number.isFinite(rideMs)) return false;
  const tolerance = toleranceMinutes * 60_000;
  return Math.abs(rideMs - searchDepartureMs) <= tolerance;
}
