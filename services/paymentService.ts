import { apiFetch, apiBaseUrl } from "@/constants/runtime-config";
import { rideLog } from "@/utils/ride-logger";
import { getAuth } from "firebase/auth";

// ─── Auth helpers ─────────────────────────────────────────────────────────────

async function getIdToken(): Promise<string> {
  const user = getAuth().currentUser;
  if (!user) throw new Error("Not authenticated");
  return user.getIdToken();
}

/** Authenticated POST to a ride-lifecycle Cloud Function endpoint. */
async function apiPostRide<T = Record<string, unknown>>(
  path: string,
  body: Record<string, unknown>,
): Promise<T> {
  const token = await getIdToken();
  rideLog.info("payment", `POST ${path}`, body);
  const res = await apiFetch(`${apiBaseUrl}${path}`, {
    method: "POST",
    headers: { "Content-Type": "application/json", Authorization: `Bearer ${token}` },
    body: JSON.stringify(body),
  });
  if (!res.ok) {
    const text = await res.text().catch(() => "");
    rideLog.error("payment", `POST ${path} failed (${res.status})`, text);
    throw new Error(text || `Request failed (${res.status})`);
  }
  const json = (await res.json().catch(() => ({}))) as T;
  rideLog.info("payment", `POST ${path} ok`, json);
  return json;
}

// ─── QR Token ─────────────────────────────────────────────────────────────────

/**
 * Driver mints a fresh boarding nonce server-side (the ride doc is written by the
 * Cloud Function, not the client) and returns the Base64 QR payload to display.
 */
export async function generateQrToken(rideId: string): Promise<string> {
  const { payload } = await apiPostRide<{ payload: string }>("/rides/qr", { rideId });
  if (!payload) throw new Error("Failed to generate QR token");
  return payload;
}

// ─── Validate and Board Passenger ─────────────────────────────────────────────

/**
 * Passenger boards by presenting the driver's QR payload. All validation
 * (nonce match, expiry, membership, no double-board) happens atomically in the
 * /rides/board Cloud Function — nothing is trusted from the client.
 */
export async function validateAndBoardPassenger(
  qrPayload: string,
  _passengerUid: string,
  expectedRideId?: string,
): Promise<void> {
  if (!expectedRideId) throw new Error("Missing ride id for boarding.");
  await apiPostRide("/rides/board", { rideId: expectedRideId, qrPayload });
}

// ─── Finish Ride (server-side payment + completion) ───────────────────────────

/**
 * Driver ends the ride. The /rides/finish Cloud Function charges every
 * boarded∧dropped passenger for their booked leg, credits the driver, and sets
 * status=completed + paymentStatus=completed atomically. Throws on failure so
 * the caller can surface it (no more silent payment loss).
 */
export async function processRidePayments(rideId: string): Promise<void> {
  await apiPostRide("/rides/finish", { rideId });
}
