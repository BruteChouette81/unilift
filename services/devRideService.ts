/**
 * Client wrappers for the dev-only `/dev/*` ride testing endpoints
 * (see `functions-sandbox/index.js`). These let a single device drive an entire
 * ride end-to-end without a second phone, real GPS, or a physical QR scan.
 *
 * In dev builds `apiFetch`/`apiBaseUrl` automatically target the `apiSandbox`
 * function against the `uniliftdev` database + Stripe test keys. Everything here
 * is only ever called from the `isDev`-gated Dev Ride Panel.
 */
import { apiBaseUrl, apiFetch, isDev } from "@/constants/runtime-config";
import { rideLog } from "@/utils/ride-logger";
import { getAuth } from "firebase/auth";

async function devPost<T = Record<string, unknown>>(
  path: string,
  body: Record<string, unknown> = {},
): Promise<T> {
  if (!isDev) throw new Error("Dev endpoints are only available in dev builds.");
  const user = getAuth().currentUser;
  if (!user) throw new Error("Not authenticated");
  const token = await user.getIdToken();
  rideLog.info("dev", `POST ${path}`, body);
  const res = await apiFetch(`${apiBaseUrl}${path}`, {
    method: "POST",
    headers: { "Content-Type": "application/json", Authorization: `Bearer ${token}` },
    body: JSON.stringify(body),
  });
  if (!res.ok) {
    const text = await res.text().catch(() => "");
    rideLog.error("dev", `POST ${path} failed (${res.status})`, text);
    throw new Error(text || `Dev request failed (${res.status})`);
  }
  const json = (await res.json().catch(() => ({}))) as T;
  rideLog.info("dev", `POST ${path} ok`, json);
  return json;
}

export interface DevSeedRequestParams {
  originLat?: number;
  originLng?: number;
  destinationLat?: number;
  destinationLng?: number;
  destination?: string;
  originLabel?: string;
}

/** Create an OPEN rideRequest for the current user (bypasses GPS + payment gate). */
export function devSeedRequest(params: DevSeedRequestParams = {}): Promise<{ requestId: string }> {
  return devPost<{ requestId: string }>("/dev/seed-request", params as Record<string, unknown>);
}

/** Claim a request with a synthetic bot driver so the passenger flows solo. */
export function devAcceptAsBot(requestId: string): Promise<{ rideId: string }> {
  return devPost<{ rideId: string }>("/dev/accept-as-bot", { requestId });
}

/** Start the ride on the bot driver's behalf. */
export function devStartRide(rideId: string): Promise<{ success: boolean }> {
  return devPost("/dev/start", { rideId });
}

/** Board the current user without a camera scan. */
export function devAutoBoard(rideId: string): Promise<{ success: boolean }> {
  return devPost("/dev/auto-board", { rideId });
}

/** Drop the current user (or a given passenger). `confirmed=false` = out-of-range branch. */
export function devDropoff(
  rideId: string,
  opts: { passengerId?: string; confirmed?: boolean } = {},
): Promise<{ success: boolean; confirmed: boolean }> {
  return devPost("/dev/dropoff", { rideId, ...opts });
}

/** End + charge the ride on the bot's behalf. */
export function devFinishRide(rideId: string): Promise<{ success: boolean; chargedPassengers: number }> {
  return devPost("/dev/finish", { rideId });
}

export interface DevForceStatusParams {
  rideId?: string;
  status?: string;
  paymentStatus?: string;
  boarded?: boolean;
  dropped?: boolean;
  requestId?: string;
  requestStatus?: string;
}

/** Jump a ride and/or its request to any state branch. */
export function devForceStatus(params: DevForceStatusParams): Promise<{ success: boolean }> {
  return devPost("/dev/force-status", params as Record<string, unknown>);
}

/** Expire/clean every dev-seeded request + ride involving the current user. */
export function devReset(): Promise<{ success: boolean; requests: number; rides: number }> {
  return devPost("/dev/reset", {});
}
