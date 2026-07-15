export type RidePricing = {
  passengerRateCentsPerKm: number;
  driverRateCentsPerKm: number;
  minimumChargeCents: number;
  minimumDistanceKm: number;
};

// Fallback defaults, used until the live values are fetched from the Firestore
// doc `config/pricing` (editable via the founder admin dashboard). Kept in sync
// with DEFAULT_PRICING in functions/index.js.
export const DEFAULT_RIDE_PRICING: RidePricing = {
  passengerRateCentsPerKm: 25,   // $0.25/km charged to passenger
  driverRateCentsPerKm: 20,      // $0.20/km credited to driver
  minimumChargeCents: 100,       // $1.00 floor
  minimumDistanceKm: 0.5,
};

// Live, mutable pricing used by the calculate* helpers below. These power
// in-app fare *estimates* only — the real charge is computed server-side in the
// Cloud Function, which reads the same Firestore doc. Hydrated at app startup
// via setRidePricing(); see services/pricingService.ts.
export const RIDE_PRICING: RidePricing = { ...DEFAULT_RIDE_PRICING };

/** Overwrite the live pricing (partial merge over current values). Ignores
 *  invalid/non-positive numbers so a bad remote value never breaks estimates. */
export function setRidePricing(partial: Partial<RidePricing>): void {
  for (const key of Object.keys(DEFAULT_RIDE_PRICING) as (keyof RidePricing)[]) {
    const n = Number(partial[key]);
    if (Number.isFinite(n) && n > 0) RIDE_PRICING[key] = n;
  }
}

/** Snapshot of the current live pricing. */
export function getRidePricing(): RidePricing {
  return { ...RIDE_PRICING };
}

export function calculatePassengerChargeCents(distanceKm: number): number {
  const distance = Math.max(distanceKm, RIDE_PRICING.minimumDistanceKm);
  return Math.max(
    Math.round(distance * RIDE_PRICING.passengerRateCentsPerKm),
    RIDE_PRICING.minimumChargeCents
  );
}

export function calculateDriverEarningCents(distanceKm: number, passengerCount: number): number {
  const distance = Math.max(distanceKm, RIDE_PRICING.minimumDistanceKm);
  return Math.round(distance * RIDE_PRICING.driverRateCentsPerKm) * passengerCount;
}

export function formatCentsAsDollars(cents: number): string {
  return `$${(cents / 100).toFixed(2)}`;
}

/** Compute driver ROI from individual passenger leg distances. */
export function calculateDriverROI(
  passengerLegDistances: number[],
): {
  totalPassengerChargesCents: number;
  totalDriverEarningsCents: number;
  platformFeeCents: number;
} {
  let totalPassengerChargesCents = 0;
  let totalDriverEarningsCents = 0;

  for (const legKm of passengerLegDistances) {
    totalPassengerChargesCents += calculatePassengerChargeCents(legKm);
    const d = Math.max(legKm, RIDE_PRICING.minimumDistanceKm);
    totalDriverEarningsCents += Math.round(d * RIDE_PRICING.driverRateCentsPerKm);
  }

  return {
    totalPassengerChargesCents,
    totalDriverEarningsCents,
    platformFeeCents: totalPassengerChargesCents - totalDriverEarningsCents,
  };
}
