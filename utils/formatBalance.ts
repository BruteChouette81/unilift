/**
 * Wallet balance formatting shared by the wallet screen and the header pill.
 *
 * A balance is a single signed number: earnings minus ride charges. Positive
 * means UniLift owes the user, negative means the user owes UniLift. Both call
 * sites must agree on the sign and the colour, so the rule lives here once.
 */

interface SignedPalette {
  /** Applied when the amount is positive (money in). */
  positive: string;
  /** Applied when the amount is negative (money out). */
  negative: string;
  /** Applied at exactly zero. */
  neutral: string;
}

/** -1800 → "-$18.00" · 4250 → "$42.50" · 0 → "$0.00" */
export function formatSignedCents(cents: number): string {
  const sign = cents < 0 ? "-" : "";
  return `${sign}$${(Math.abs(cents) / 100).toFixed(2)}`;
}

/**
 * Like `formatSignedCents`, but always shows the sign — for breakdown rows
 * where "+$60.50" and "-$18.00" sit next to each other and have to read as a
 * pair. 0 → "$0.00" (an unsigned zero).
 */
export function formatExplicitSignedCents(cents: number): string {
  if (cents === 0) return "$0.00";
  return `${cents > 0 ? "+" : "-"}$${(Math.abs(cents) / 100).toFixed(2)}`;
}

export function signedAmountColor(cents: number, palette: SignedPalette): string {
  if (cents > 0) return palette.positive;
  if (cents < 0) return palette.negative;
  return palette.neutral;
}
