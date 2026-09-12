export type RidePricing = {
  /** Fare rate. This is BOTH what the passenger is charged and what the driver
   *  is credited — there is deliberately no second "driver rate". */
  passengerRateCentsPerKm: number;
  minimumChargeCents: number;
  minimumDistanceKm: number;
  /** Stripe's percentage fee, in basis points (290 = 2.90%). */
  stripePercentBps: number;
  /** Stripe's fixed fee per successful charge, in cents. */
  stripeFixedCents: number;
  /** LEGACY per-ride reserve, in basis points of the fare, charged to the
   *  passenger on top of the fare to fund Connect payout fees.
   *
   *  Superseded by `payoutFeeFlatCents` + `payoutFeeBps`, which are deducted
   *  from the driver's payout instead. Kept (and still honoured) so the change
   *  is a config rollback rather than a redeploy: set this back above 0 and the
   *  payout fee to 0 to return to the old shape. Ships at 0. */
  payoutReserveBps: number;
  /** Flat fee deducted ONCE from each monthly driver payout, in cents.
   *
   *  Recovers Stripe Connect Express's fixed costs, which are incurred per
   *  DRIVER PER MONTH, not per ride: $2.00 active-account fee for any account
   *  that receives a payout, plus $0.25 per payout. Charging this as a
   *  percentage of every fare (the old `payoutReserveBps`) under-collected on
   *  small earners and over-collected on large ones, because the underlying
   *  cost barely moves with payout size. */
  payoutFeeFlatCents: number;
  /** Variable part of the payout fee, in basis points of the payout. Mirrors
   *  Stripe's 0.25% per-payout charge. */
  payoutFeeBps: number;
  /** Balances below this are rolled into next month instead of being charged. */
  minSettlementCents: number;
  /** The smallest amount that can actually be put through Stripe (CAD minimum is
   *  ~$0.50). Distinct from `minSettlementCents`: that one decides what is worth
   *  charging THIS month, this one decides what is collectable at all. Account
   *  deletion gates on this, so raising the settlement floor can never quietly
   *  turn a real debt into a write-off. */
  minChargeableCents: number;
  /** Unsettled ride debt at which a passenger stops being able to book. A card
   *  is not charged until settlement, so without a ceiling the exposure per
   *  passenger is unbounded for a whole billing cycle. */
  maxOutstandingChargeCents: number;
  /** Driver earnings below this are rolled into next month instead of being paid
   *  out. Stripe Connect Express costs a flat $2/month per account that receives
   *  any payout, so paying a $3 balance costs nearly as much as paying a $300
   *  one; the floor is what keeps that overhead sane. No payout in a month means
   *  no active-account fee for that driver at all. */
  minPayoutCents: number;
};

// Fallback defaults, used until the live values are fetched from the Firestore
// doc `config/pricing` (editable via the founder admin dashboard). Kept in sync
// with DEFAULT_PRICING in functions/index.js AND functions-sandbox/index.js —
// scripts/check-server-drift.sh guards the money fields.
//
// ── No platform cut ─────────────────────────────────────────────────────────
// There is one fare rate. The passenger is charged it and the driver is
// credited it, so a $5.00 fare means the driver earns $5.00. This used to be
// two numbers (25 charged / 20 credited), which was a silent 20% cut; the
// second field was deleted rather than set equal to the first, so that a stray
// edit to `config/pricing` cannot quietly reintroduce a spread.
//
// Stripe's processing fee is NOT taken out of the fare. It is added on top at
// settlement time via grossUpChargeCents() below, so the passenger covers it
// and UniLift nets exactly what it owes drivers.
export const DEFAULT_RIDE_PRICING: RidePricing = {
  passengerRateCentsPerKm: 25,   // $0.25/km — charged AND credited
  minimumChargeCents: 100,       // $1.00 floor
  minimumDistanceKm: 0.5,
  stripePercentBps: 290,         // 2.90% — Stripe CA standard
  stripeFixedCents: 30,          // $0.30 per successful charge
  // RETIRED, kept at 0 as a rollback lever. This charged the passenger 4% of
  // every fare to fund Connect payout fees. The fees it funds are ~$2.00/driver
  // /month fixed plus 0.25% + $0.25 per payout — a cost that barely moves with
  // payout size — so a percentage of fare volume was the wrong shape:
  //
  //     driver earns  $30 → real cost $2.33, 4% collected $1.20  (short $1.13)
  //     driver earns  $50 → real cost $2.38, 4% collected $2.00  (short $0.38)
  //     driver earns $200 → real cost $2.75, 4% collected $8.00  (over $5.25)
  //
  // Replaced by payoutFeeFlatCents + payoutFeeBps below, which are deducted from
  // the payout itself and therefore track the cost exactly at any size. Setting
  // this back above 0 in `config/pricing` (~60s TTL) is a no-redeploy rollback.
  payoutReserveBps: 0,
  // $2.00 Connect Express active-account fee + $0.25 per payout.
  payoutFeeFlatCents: 225,
  // Stripe's 0.25% per-payout charge.
  payoutFeeBps: 25,
  minSettlementCents: 100,       // $1.00 — below this the balance rolls forward
  minChargeableCents: 50,        // $0.50 — Stripe's CAD minimum charge
  minPayoutCents: 2500,          // $25.00 — see RidePricing.minPayoutCents
  maxOutstandingChargeCents: 7500, // $75.00 — roughly 30 typical rides
};

/** Fields where 0 is a legitimate configured value rather than "unset".
 *  Everything else must be > 0 — a zero fare rate or zero minimum would be a
 *  configuration accident, not an intent. */
const ZERO_ALLOWED = new Set<keyof RidePricing>([
  "stripePercentBps",
  "stripeFixedCents",
  "payoutReserveBps",
  "payoutFeeFlatCents",
  "payoutFeeBps",
]);

/** Is `value` an acceptable configured value for `key`? Shared with the server's
 *  getPricing() and with services/pricingService.ts so all three agree. */
export function isValidPricingValue(key: keyof RidePricing, value: unknown): boolean {
  const n = Number(value);
  if (!Number.isFinite(n)) return false;
  return ZERO_ALLOWED.has(key) ? n >= 0 : n > 0;
}

// Live, mutable pricing used by the calculate* helpers below. These power
// in-app fare *estimates* only — the real charge is computed server-side in the
// Cloud Function, which reads the same Firestore doc. Hydrated at app startup
// via setRidePricing(); see services/pricingService.ts.
export const RIDE_PRICING: RidePricing = { ...DEFAULT_RIDE_PRICING };

/** Overwrite the live pricing (partial merge over current values). Invalid
 *  values are ignored so a bad remote value never breaks estimates. */
export function setRidePricing(partial: Partial<RidePricing>): void {
  for (const key of Object.keys(DEFAULT_RIDE_PRICING) as (keyof RidePricing)[]) {
    if (isValidPricingValue(key, partial[key])) {
      RIDE_PRICING[key] = Number(partial[key]);
    }
  }
}

/** The fare for a leg: what the passenger pays AND what the driver earns. */
export function calculateFareCents(distanceKm: number): number {
  const distance = Math.max(distanceKm, RIDE_PRICING.minimumDistanceKm);
  return Math.max(
    Math.round(distance * RIDE_PRICING.passengerRateCentsPerKm),
    RIDE_PRICING.minimumChargeCents
  );
}

/** Legacy per-ride reserve. 0 by default — see RidePricing.payoutReserveBps. */
export function calculatePayoutReserveCents(fareCents: number): number {
  if (!Number.isFinite(fareCents) || fareCents <= 0) return 0;
  return Math.round(fareCents * (RIDE_PRICING.payoutReserveBps / 10000));
}

/**
 * What Stripe Connect costs to move one monthly payout, deducted from that
 * payout. Flat part + a share of the amount, matching Stripe's own shape.
 *
 * Charged ONCE per payout, never per ride — the $2.00 active-account fee is
 * billed per driver per month regardless of how many rides produced the
 * balance, so spreading it over rides is what made the old reserve wrong.
 *
 * Clamped to the payout: a fee can reduce a payout to zero but must never make
 * it negative, which would turn a payout into a debt.
 *
 * MIRRORED SERVER-SIDE in functions/index.js and functions-sandbox/index.js.
 */
export function calculatePayoutFeeCents(
  payoutCents: number,
  pricing: RidePricing = RIDE_PRICING,
): number {
  if (!Number.isFinite(payoutCents) || payoutCents <= 0) return 0;
  const fee = pricing.payoutFeeFlatCents
    + Math.round(payoutCents * (pricing.payoutFeeBps / 10000));
  return Math.min(Math.max(0, fee), payoutCents);
}

/** Total charged to the passenger for a leg: fare + payout reserve. With the
 *  reserve at its default 0 this is exactly `calculateFareCents`, and therefore
 *  exactly what the driver is credited. */
export function calculatePassengerChargeCents(distanceKm: number): number {
  const fare = calculateFareCents(distanceKm);
  return fare + calculatePayoutReserveCents(fare);
}

/** What the driver is credited — the fare itself, no deduction. */
export function calculateDriverEarningCents(distanceKm: number, passengerCount: number): number {
  return calculateFareCents(distanceKm) * passengerCount;
}

/**
 * Gross up a settlement so that, after Stripe's cut, UniLift receives exactly
 * `netCents` — the amount it owes drivers.
 *
 *     gross = ceil( (net + fixed) / (1 - percent) )
 *
 * `ceil`, not `round`: rounding down leaves the platform a cent short on every
 * settlement, which is precisely the debt this is designed to prevent. The
 * resulting sub-cent surplus is the intended direction of error.
 *
 * Applied ONCE per monthly settlement, never per ride — billing is netted, so
 * Stripe's fixed fee is incurred once a month. Charging it per ride would
 * over-collect (ten rides would collect ten fixed fees against Stripe's one),
 * and an over-collection is a platform cut by another name.
 *
 * MIRRORED SERVER-SIDE in functions/index.js and functions-sandbox/index.js.
 */
export function grossUpChargeCents(
  netCents: number,
  pricing: RidePricing = RIDE_PRICING,
): number {
  if (!Number.isFinite(netCents) || netCents <= 0) return 0;
  const pct = pricing.stripePercentBps / 10000;
  // A rate at or above 100% makes the division diverge or flip sign. Fall back
  // to additive recovery rather than returning a nonsensical charge.
  if (!(pct >= 0 && pct < 1)) {
    return Math.ceil(netCents + pricing.stripeFixedCents);
  }
  return Math.ceil((netCents + pricing.stripeFixedCents) / (1 - pct));
}

export function formatCentsAsDollars(cents: number): string {
  return `$${(cents / 100).toFixed(2)}`;
}
