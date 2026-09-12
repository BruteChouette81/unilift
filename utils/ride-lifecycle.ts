import type { Ride } from "@/types/models";

export const RIDE_LIVE_WINDOW_MS = 3 * 60 * 60 * 1000;

function parseMs(iso: string | undefined | null): number | null {
  if (!iso) return null;
  const ms = new Date(iso).getTime();
  return Number.isFinite(ms) ? ms : null;
}

export function isRideExpired(ride: Ride, now: Date = new Date()): boolean {
  const nowMs = now.getTime();
  if (ride.status === "expired" || ride.status === "completed") return true;
  if (ride.status === "planned") {
    const dateMs = parseMs(ride.date);
    if (dateMs == null) return false;
    return nowMs - dateMs >= RIDE_LIVE_WINDOW_MS;
  }
  if (ride.status === "started") {
    const startedMs = parseMs(ride.startedAt);
    if (startedMs == null) return false;
    return nowMs - startedMs >= RIDE_LIVE_WINDOW_MS;
  }
  return false;
}

