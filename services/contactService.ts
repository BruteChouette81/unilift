/**
 * Ride-time contact details.
 *
 * The one thing worth knowing about this file: a passenger's phone number is
 * NOT a field anyone can read. `users/{uid}` is owner-only in firestore.rules
 * and the public-profile projection deliberately omits `phone`, so this goes
 * through a Cloud Function that re-checks, on every call, that the caller is
 * this ride's driver and that the passenger has not been dropped off yet.
 *
 * That is why there is no cache here. Caching the number would outlive the
 * permission that produced it, which is the whole point of the server check —
 * the driver's screen re-asks and drops the value when the answer changes.
 */
import { apiBaseUrl, apiFetch } from "@/constants/runtime-config";
import { getAuth } from "firebase/auth";

export type PassengerContact = {
  /** E.164, or null when the passenger has not shared a number. */
  phone: string | null;
  /** "not_shared" when the passenger simply has no number on file. */
  reason?: string;
};

/** Attach the server's machine-readable `error` as `code`, the way
 *  driverSessionService does, so rideErrorMessage can act on it. */
async function throwContactError(res: Response): Promise<never> {
  const details = await res.text().catch(() => "");
  let code: string | undefined;
  try {
    const parsed = JSON.parse(details) as { error?: string };
    if (typeof parsed?.error === "string") code = parsed.error;
  } catch { /* not JSON — fall back to the text below */ }
  const err = new Error(
    `Failed to load passenger contact (status ${res.status})${details ? `: ${details.slice(0, 200)}` : ""}`,
  ) as Error & { code?: string; status?: number };
  if (code) err.code = code;
  err.status = res.status;
  throw err;
}

/**
 * The driver asks for one passenger's number, for one ride.
 *
 * Resolves with `{ phone: null }` when the passenger never shared one — that is
 * an ordinary outcome, not a failure. Throws (with `.code`) when the server
 * refuses: `already_dropped`, `not_passenger`, `ride_not_active`, or a 403 when
 * the caller is not this ride's driver.
 */
export async function fetchPassengerContact(
  rideId: string,
  passengerId: string,
): Promise<PassengerContact> {
  const user = getAuth().currentUser;
  if (!user) throw new Error("Not authenticated");
  const token = await user.getIdToken();

  const res = await apiFetch(`${apiBaseUrl}/rides/passenger-contact`, {
    method: "POST",
    headers: { "Content-Type": "application/json", Authorization: `Bearer ${token}` },
    body: JSON.stringify({ rideId, passengerId }),
  });
  if (!res.ok) await throwContactError(res);

  const data = (await res.json().catch(() => ({}))) as PassengerContact;
  return {
    phone: typeof data.phone === "string" && data.phone ? data.phone : null,
    reason: data.reason,
  };
}
