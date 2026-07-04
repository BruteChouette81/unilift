import type { Ride } from "@/types/models";

export const RIDE_LIVE_WINDOW_MS = 3 * 60 * 60 * 1000;

function parseMs(iso: string | undefined | null): number | null {
  if (!iso) return null;
  const ms = new Date(iso).getTime();
  return Number.isFinite(ms) ? ms : null;
}

export function isRideLive(ride: Ride, now: Date = new Date()): boolean {
  if (ride.status === "started") return true;
  if (ride.status !== "planned") return false;
  const dateMs = parseMs(ride.date);
  if (dateMs == null) return true;
  const nowMs = now.getTime();
  return dateMs <= nowMs && nowMs - dateMs < RIDE_LIVE_WINDOW_MS;
}

export function isRideScheduled(ride: Ride, now: Date = new Date()): boolean {
  if (ride.status !== "planned") return false;
  const dateMs = parseMs(ride.date);
  if (dateMs == null) return false;
  return dateMs > now.getTime();
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

export function isRideJoinable(ride: Ride): boolean {
  return ride.status === "planned";
}
