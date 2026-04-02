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
