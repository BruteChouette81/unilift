/**
 * Phone-number formatting for the North American Numbering Plan.
 *
 * UniLift stores one canonical form — E.164, `+15145550142` — and shows a
 * friendlier one, `(514) 555-0142`. Three functions keep those two apart, the
 * same split the birth-date helpers in components/userHelper.ts already use:
 *
 *   autoFormatPhoneInput  what the user sees while typing
 *   parsePhoneInput       what gets stored, or "" when the input is not a number
 *   formatPhoneForDisplay what a stored number looks like when read back
 *
 * `parsePhoneInput` returning `""` rather than throwing is the important part:
 * callers use it as both the validity check and the conversion, so a half-typed
 * number is simply "not ready to save" instead of an error state.
 *
 * ## Scope
 *
 * NANP only — Canada and the US, which is where UniLift operates. That buys
 * real validation rather than a length check: an area code and an exchange code
 * both have to start with 2-9, so `(123) 456-7890` and `(514) 155-0142` are
 * rejected as the typos they are. A number outside NANP is rejected too; that is
 * a deliberate limitation, not an oversight, and widening it means adding a
 * country picker rather than loosening these rules.
 *
 * This is a typo guard, not libphonenumber. It cannot know whether a
 * well-formed number is *assigned* — nothing verifies these numbers, so a
 * driver finds out a digit was wrong when the call does not connect.
 */

/** Digits only, capped at the longest thing NANP can be (1 + 10). */
function digitsOf(raw: string): string {
  return raw.replace(/\D/g, "").slice(0, 11);
}

/** Drop the optional leading country code, returning the 10 national digits. */
function nationalDigits(raw: string): string {
  const digits = digitsOf(raw);
  if (digits.length === 11 && digits.startsWith("1")) return digits.slice(1);
  return digits;
}

/**
 * True when `national` is a well-formed NANP number.
 *
 * Both the area code (NPA) and the exchange (NXX) must start with 2-9 — 0 and 1
 * are reserved as the operator and long-distance prefixes and can never begin
 * either one. That single rule catches most fat-fingered numbers, which is the
 * whole job here.
 */
function isValidNational(national: string): boolean {
  return /^[2-9]\d{2}[2-9]\d{6}$/.test(national);
}

/** True when `raw` looks like a number the user could have meant. */
export function isValidPhoneFormat(raw: string): boolean {
  return isValidNational(nationalDigits(raw));
}

/**
 * Canonicalise typed input to E.164 for storage.
 * Returns `""` for anything that is not a valid NANP number — including an
 * empty string, so "left the field blank" and "typed nonsense" are one case for
 * the caller.
 */
export function parsePhoneInput(raw: string): string {
  const national = nationalDigits(raw);
  return isValidNational(national) ? `+1${national}` : "";
}

/**
 * Render a stored number for a human: `+15145550142` → `(514) 555-0142`.
 * Anything unparseable is returned untouched rather than blanked — if a number
 * somehow got stored in a shape this does not recognise, showing it is more
 * useful to whoever has to call it than showing nothing.
 */
export function formatPhoneForDisplay(stored: string): string {
  const national = nationalDigits(stored);
  if (!isValidNational(national)) return stored;
  return `(${national.slice(0, 3)}) ${national.slice(3, 6)}-${national.slice(6)}`;
}

/**
 * Format raw input as the user types, so the field reads as a phone number from
 * the third digit onward. Deliberately formats whatever digits exist without
 * validating them — a half-typed number must not be rearranged or rejected
 * mid-entry, and a leading `1` is absorbed so pasting `1-514-555-0142` works.
 */
export function autoFormatPhoneInput(raw: string): string {
  const national = nationalDigits(raw).slice(0, 10);
  if (national.length === 0) return "";
  if (national.length <= 3) return `(${national}`;
  if (national.length <= 6) return `(${national.slice(0, 3)}) ${national.slice(3)}`;
  return `(${national.slice(0, 3)}) ${national.slice(3, 6)}-${national.slice(6)}`;
}

/** A `tel:` URI for the dialer. Empty when the number is not usable. */
export function telUri(stored: string): string {
  const e164 = parsePhoneInput(stored);
  return e164 ? `tel:${e164}` : "";
}

/** An `sms:` URI for the messaging app. Empty when the number is not usable. */
export function smsUri(stored: string): string {
  const e164 = parsePhoneInput(stored);
  return e164 ? `sms:${e164}` : "";
}
