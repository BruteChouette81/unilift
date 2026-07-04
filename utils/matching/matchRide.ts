// eslint-disable-next-line @typescript-eslint/no-require-imports
const polylineLib = require("@mapbox/polyline") as {
  decode: (str: string, precision?: number) => [number, number][];
};

import { computeDetour, LatLng } from "./geometry";
import type { Ride } from "@/types/models";

export type PassengerRequest = {
  origin: LatLng;
  destination: LatLng;
};

export type MatchResult = {
  ride: Ride;
  score: number;
  detourKm: number;
  pickupProgress: number;
};

function ridePolyline(ride: Ride): LatLng[] {
  if (ride.routePolyline) {
    return polylineLib
      .decode(ride.routePolyline)
      .map(([lat, lng]: [number, number]) => ({ lat, lng }));
  }
  const o = ride.localisation;
  const d = ride.destinationCoords;
  if (!o || !d) return [];
  return [
    { lat: o.latitude, lng: o.longitude },
    {
      lat: (d as { lat?: number; latitude?: number }).lat ??
        (d as { latitude?: number }).latitude ?? 0,
      lng: (d as { lng?: number; longitude?: number }).lng ??
        (d as { longitude?: number }).longitude ?? 0,
    },
  ];
}

export function findMatchesForPassenger(
  passenger: PassengerRequest,
  rides: Ride[],
  maxDetourKmOverride?: number,
): MatchResult[] {
  const results: MatchResult[] = [];

  for (const ride of rides) {
    const rideMaxDetour = maxDetourKmOverride ?? ride.maxDetourKm ?? 5;
    const poly = ridePolyline(ride);
    if (poly.length < 2) continue;

    const driverOrigin: LatLng = {
      lat: ride.localisation.latitude,
      lng: ride.localisation.longitude,
    };

    const detour = computeDetour(passenger.origin, driverOrigin, poly);
    if (!detour) continue;
    if (detour.detourKm > rideMaxDetour) continue;

    // Score = (1 - detourKm/maxDetourKm) * 0.6 + (1 - pickupProgress) * 0.4
    const score =
      (1 - detour.detourKm / rideMaxDetour) * 0.6 +
      (1 - detour.pickupProgress) * 0.4;

    results.push({
      ride,
      score,
      detourKm: detour.detourKm,
      pickupProgress: detour.pickupProgress,
    });
  }

  return results.sort((a, b) => b.score - a.score);
}
