import * as Application from "expo-application";
import * as Crypto from "expo-crypto";
import * as SecureStore from "expo-secure-store";
import { Platform } from "react-native";

import { devWarn } from "@/constants/runtime-config";

/**
 * The install identity behind the per-device account cap.
 *
 * ## What "device" means here, honestly
 *
 * There is no unspoofable device identifier available to an Expo app on either
 * platform, and this module does not pretend otherwise. What it provides is an
 * identifier that survives the thing a normal person does — delete the app,
 * install it again, try to sign up again — which is what the cap is actually
 * for. A modified build can send whatever it likes; closing *that* needs
 * attestation (App Attest / Play Integrity), which is open item #1 in
 * docs/security-audit.md and a separate project.
 *
 * ## Why the two platforms differ
 *
 * - **iOS**: a random UUID minted once and kept in the Keychain via
 *   `expo-secure-store`. Keychain items are not scoped to the app bundle's
 *   container, so they outlive deleting the app. `identifierForVendor` was the
 *   other candidate and is worse: it resets the moment the user deletes every
 *   app from the same vendor, which for a single-app publisher is just "delete
 *   the app".
 * - **Android**: `getAndroidId()` (SSAID), which is stable per device + app
 *   signing key + user and survives reinstall on its own. SecureStore on
 *   Android is backed by SharedPreferences and is wiped by an uninstall, so a
 *   minted UUID there would reset every time — SSAID is the only thing that
 *   persists. It is cached into SecureStore anyway so the value is stable
 *   within an install even if the platform call fails later.
 *
 * ## The raw value never leaves the device
 *
 * Callers get a SHA-256 hash. The server counts hashes; it cannot recover an
 * SSAID or correlate one across apps, and a leaked database of these is not a
 * list of devices. `expo-crypto` is already a dependency (it mints the Apple
 * Sign-In nonce).
 */

/** Keychain / SecureStore key. Versioned so the scheme can be rotated. */
const DEVICE_ID_KEY = "unilift.device.id.v1";

/** In-memory cache: this is read on every signup screen mount. */
let cached: string | null = null;

function randomId(): string {
  // `randomUUID` is available in expo-crypto and backed by the platform CSPRNG.
  return Crypto.randomUUID();
}

async function readStored(): Promise<string | null> {
  try {
    return await SecureStore.getItemAsync(DEVICE_ID_KEY);
  } catch (err) {
    // A locked Keychain (device booting, no passcode yet) throws rather than
    // returning null. Treat it as "unknown", never as "new device".
    devWarn("deviceIdentity: SecureStore read failed", err);
    return null;
  }
}

async function writeStored(value: string): Promise<void> {
  try {
    await SecureStore.setItemAsync(DEVICE_ID_KEY, value, {
      // Survives reboot without requiring an unlock first, so a signup started
      // before the first unlock still resolves an id.
      keychainAccessible: SecureStore.AFTER_FIRST_UNLOCK,
    });
  } catch (err) {
    devWarn("deviceIdentity: SecureStore write failed", err);
  }
}

/**
 * The raw, device-local identifier. Never send this anywhere — use
 * `getDeviceFingerprint()`.
 */
async function resolveRawDeviceId(): Promise<string | null> {
  const stored = await readStored();
  if (stored) return stored;

  let value: string | null = null;

  if (Platform.OS === "android") {
    try {
      // Stable across reinstall; resets on factory reset. Null on some
      // emulators and heavily modified ROMs, which is why there is a fallback.
      value = Application.getAndroidId();
    } catch (err) {
      devWarn("deviceIdentity: getAndroidId failed", err);
    }
  }

  // iOS always, and Android when SSAID is unavailable. On Android this value
  // will not survive an uninstall — accepted, because the alternative is no
  // identifier at all.
  if (!value) value = randomId();

  await writeStored(value);
  return value;
}

/**
 * A stable, non-reversible fingerprint for this install.
 *
 * Returns `null` only when no identifier could be resolved *or* stored, which
 * in practice means SecureStore is unavailable. Callers must decide what that
 * means for them — see the note on `checkDevice` in services/deviceService.ts.
 */
export async function getDeviceFingerprint(): Promise<string | null> {
  if (cached) return cached;

  const raw = await resolveRawDeviceId();
  if (!raw) return null;

  try {
    const digest = await Crypto.digestStringAsync(
      Crypto.CryptoDigestAlgorithm.SHA256,
      // Salted with a constant so the hash is specific to this use. It is not a
      // secret — it ships in the bundle — it just stops the same digest being
      // meaningful to anything else that hashes an SSAID.
      `unilift.device.v1:${raw}`,
    );
    cached = digest;
    return digest;
  } catch (err) {
    devWarn("deviceIdentity: hashing failed", err);
    return null;
  }
}

/**
 * Drop the cached value and the stored identifier.
 *
 * Only for the dev harness — it is what lets one person test the cap without a
 * factory reset. There is deliberately no UI path to this.
 */
export async function resetDeviceIdentityForTesting(): Promise<void> {
  cached = null;
  try {
    await SecureStore.deleteItemAsync(DEVICE_ID_KEY);
  } catch (err) {
    devWarn("deviceIdentity: reset failed", err);
  }
}
