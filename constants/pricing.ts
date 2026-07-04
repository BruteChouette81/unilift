export const RIDE_PRICING = {
  passengerRateCentsPerKm: 25,   // $0.25/km charged to passenger
  driverRateCentsPerKm: 20,      // $0.20/km credited to driver
  minimumChargeCents: 100,       // $1.00 floor
  minimumDistanceKm: 0.5,
} as const;

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
