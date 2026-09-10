import { apiBaseUrl, apiFetch, devWarn } from "@/constants/runtime-config";
import { getDeviceFingerprint } from "@/services/deviceIdentity";

/**
 * The two halves of the per-device account cap.
 *
 * `checkDevice` is UX: it runs when the signup flow opens so somebody at the
 * limit is told before answering eight questions. `registerDevice` is the
 * enforcement, and it is the one that matters — if the check is skipped,
 * patched out, or simply fails, the register call still refuses and the
 * just-created account is removed server-side.
 */

const REQUEST_TIMEOUT_MS = 12_000;

async function post<T>(
  path: string,
  body: Record<string, unknown>,
  idToken?: string,
): Promise<T> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS);
  try {
    const res = await apiFetch(`${apiBaseUrl}${path}`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        ...(idToken ? { Authorization: `Bearer ${idToken}` } : {}),
      },
      body: JSON.stringify(body),
      signal: controller.signal,
    });
    const text = await res.text().catch(() => "");
    const json = text ? (JSON.parse(text) as T & { error?: string }) : ({} as T);
    if (!res.ok) {
      const err = new Error((json as { error?: string })?.error || `HTTP ${res.status}`);
      (err as Error & { status?: number }).status = res.status;
      throw err;
    }
    return json;
  } finally {
    clearTimeout(timer);
  }
}

export type DeviceCheck = {
  allowed: boolean;
  /** Slots left on this device. Absent when the fingerprint is unavailable. */
  remaining?: number;
};

/**
 * Ask whether this device may create another account.
 *
 * **Fails open**, and only this half does. It is an advisory pre-check whose
 * whole purpose is to save the user wasted effort; a network blip must not
 * present as "you are banned". Refusing here would also be pointless theatre,
 * because `registerDevice` re-decides the same question with authority a moment
 * later.
 */
export async function checkDevice(): Promise<DeviceCheck> {
  try {
    const deviceId = await getDeviceFingerprint();
    if (!deviceId) return { allowed: true };
    return await post<DeviceCheck>("/device/check", { deviceId });
  } catch (err) {
    devWarn("checkDevice failed, allowing signup to proceed", err);
    return { allowed: true };
  }
}

export type DeviceRegistration = { ok: true } | { ok: false; reason: string };

/**
 * Claim a slot for the account that was just created.
 *
 * **Does not swallow failures.** A thrown error here means the account must not
 * be kept — the server has already deleted it when it answers 429, and the
 * caller's job is to surface that rather than let somebody walk into the app
 * with an account the cap says should not exist.
 *
 * A device with no resolvable fingerprint registers nothing and returns ok:
 * there is no identity to count against, and blocking every such user (a locked
 * Keychain, a stripped-down Android build) would cost far more than the abuse
 * it prevents.
 */
export async function registerDevice(idToken: string): Promise<DeviceRegistration> {
  const deviceId = await getDeviceFingerprint();
  if (!deviceId) return { ok: true };

  try {
    await post<{ ok: boolean }>("/device/register", { deviceId }, idToken);
    return { ok: true };
  } catch (err) {
    const status = (err as Error & { status?: number }).status;
    if (status === 429) {
      return { ok: false, reason: (err as Error).message || "device_account_limit" };
    }
    throw err;
  }
}
