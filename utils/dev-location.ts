/**
 * Dev-only GPS override.
 *
 * When a fixed coordinate is set (from the Dev Ride Panel), the ride flow uses
 * it instead of the device's real position — so you can post a request, broadcast
 * a driver position, and resolve dropoff-range checks without physically moving.
 *
 * All of this is inert unless `isDev` AND an override is set, so real builds and
 * normal dev use are unaffected. Swap the four `getCurrentPositionAsync` call
 * sites for `devAwareCurrentPosition(...)` to opt a screen in.
 */
import { isDev } from "@/constants/runtime-config";
import { rideLog } from "@/utils/ride-logger";
import * as Location from "expo-location";

export interface DevCoords {
  latitude: number;
  longitude: number;
}

/** Handy presets ~matching the /dev/seed-request defaults (Québec City area). */
export const LOCATION_PRESETS: Record<string, DevCoords> = {
  campus: { latitude: 46.7817, longitude: -71.2747 }, // ~Université Laval (near pickup)
  downtown: { latitude: 46.8139, longitude: -71.208 }, // ~Vieux-Québec (near dropoff)
  faraway: { latitude: 45.5017, longitude: -73.5673 }, // Montréal (out of range)
};

let override: DevCoords | null = null;

export function setDevLocationOverride(coords: DevCoords | null): void {
  override = coords;
  rideLog.info("dev", coords ? "GPS override set" : "GPS override cleared", coords ?? undefined);
}

export function getDevLocationOverride(): DevCoords | null {
  return isDev ? override : null;
}

type PositionLike = { coords: DevCoords };

/**
 * Returns the dev override (shaped like an expo-location result) when set,
 * otherwise the real device position. Drop-in for `Location.getCurrentPositionAsync`.
 */
export async function devAwareCurrentPosition(
  options?: Location.LocationOptions,
): Promise<PositionLike> {
  const dev = getDevLocationOverride();
  if (dev) {
    rideLog.info("dev", "using GPS override for current position", dev);
    return { coords: { latitude: dev.latitude, longitude: dev.longitude } };
  }
  return Location.getCurrentPositionAsync(options);
}
