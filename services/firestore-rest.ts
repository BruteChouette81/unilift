/**
 * Shared helpers for the Firestore **REST** access path.
 *
 * Per the hybrid access pattern (see CLAUDE.md): real-time listeners use the
 * Firestore SDK and get plain JS objects, while one-time reads and every write
 * go through the REST API — which wraps every field in a type envelope
 * (`{ stringValue }`, `{ integerValue }`, `{ geoPointValue }`, `{ arrayValue }`…)
 * that has to be unwrapped by hand.
 *
 * Before this module, `isRecord` was defined 8 times, `readString` 6 times and
 * `readNumber` 6 times across the service layer — identical implementations with
 * different parameter names. They live here now so the unwrapping rules have one
 * definition and one place to fix.
 *
 * These are intentionally *lenient*: every reader takes a fallback and never
 * throws. REST responses are external input, and a malformed field should
 * degrade one value rather than blow up a whole screen.
 */
import type { LocationPoint } from "@/types/models";

/** Narrow an unknown to an indexable object. Note: arrays pass too — that is
 *  intentional, since `arrayValue.values` is itself indexed by number. */
export const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === "object" && value !== null;

export const readString = (value: unknown, fallback = ""): string =>
  typeof value === "string" ? value : fallback;

/** Numbers arrive as `integerValue` (a *string*) or `doubleValue` (a number),
 *  so this coerces rather than type-checks. */
export const readNumber = (value: unknown, fallback = 0): number => {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : fallback;
};

export const readBoolean = (value: unknown, fallback = false): boolean =>
  typeof value === "boolean" ? value : fallback;

/** `geoPointValue` → `{ latitude, longitude }`. Returns null when a coordinate
 *  is *missing* or non-numeric — a half-parsed point is worse than none,
 *  because callers plot it.
 *
 *  ⚠️ KNOWN SHARP EDGE (pre-existing, pinned by tests — do not "tidy" without
 *  deciding it deliberately): the guard is `Number.isFinite(Number(v))`, and
 *  `Number(null)`, `Number("")`, `Number(false)` and `Number([])` are all `0`.
 *  So `{ latitude: 46.8, longitude: null }` yields `{ 46.8, 0 }` — a point in
 *  the Gulf of Guinea — rather than null. `undefined` and non-numeric strings
 *  DO produce null, because `Number()` gives NaN for those.
 *
 *  This behaviour is inherited verbatim from the eight per-service copies this
 *  module replaced, so changing it here changes it everywhere at once. In the
 *  billing path it currently fails safe (a 0-longitude dropoff is thousands of
 *  km from any real destination, so `evaluateDropoff` refuses to bill), but it
 *  can still put a wrong marker on a map. See docs/codebase-optimization-plan.md. */
export const readGeoPoint = (value: unknown): LocationPoint | null => {
  if (!isRecord(value)) return null;
  const latitude = readNumber(value.latitude, NaN);
  const longitude = readNumber(value.longitude, NaN);
  if (!Number.isFinite(latitude) || !Number.isFinite(longitude)) return null;
  return { latitude, longitude };
};

/** `arrayValue.values` → a plain array. Missing/!array yields `[]`, so callers
 *  can map without a guard. */
export const readArray = (value: unknown): unknown[] =>
  Array.isArray(value) ? value : [];
