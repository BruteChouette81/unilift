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

/** Drop the current user (or a given passenger) through the REAL dropoff-radius
 *  gate — the same `evaluateDropoff()` that `/rides/dropoff` uses.
 *
 *  `driverLat`/`driverLng` is where you are pretending the bot driver is; the
 *  server measures it against the passenger's destination and decides. There is
 *  deliberately no `confirmed` flag: the dev route used to accept one (defaulting
 *  to true), which meant the harness never exercised the gate and reported the
 *  driver as paid for a passenger dropped anywhere at all. */
export function devDropoff(
  rideId: string,
  opts: { passengerId?: string; driverLat: number; driverLng: number },
): Promise<{
  success: boolean;
  confirmed: boolean;
  distanceKm: number | null;
  radiusKm: number;
  reason: string | null;
}> {
  return devPost("/dev/dropoff", { rideId, ...opts });
}

/** End + charge the ride on the bot's behalf. Only legs the server measured as
 *  in-range are charged, so `chargedPassengers: 0` is the expected result after
 *  an out-of-range dropoff. */
export function devFinishRide(rideId: string): Promise<{
  success: boolean;
  chargedPassengers: number;
  driverEarningsCents: number;
}> {
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

export interface DevDispatchDriverRow {
  uid: string;
  name: string;
  driverModeEnabled: boolean;
  hasPushToken: boolean;
  wouldNotify: boolean;
  skipReason: string | null;
}

export interface DevDispatchReport {
  matching: "broadcast" | "proximity";
  database: string;
  totalUsers: number;
  wouldNotify: number;
  me: DevDispatchDriverRow | null;
  drivers: DevDispatchDriverRow[];
}

/** Who would `/requests/dispatch` notify right now, and why is everyone else
 *  skipped? Read-only — sends no pushes. The only way to answer "nobody got the
 *  notification" on a TestFlight build, where there is no console. */
export function devDispatchReport(): Promise<DevDispatchReport> {
  return devPost<DevDispatchReport>("/dev/dispatch-report", {});
}
