/**
 * Regression tests for the fare guardrails added by the pre-launch audit.
 *
 * The functions under test live in functions/index.js, which cannot be imported
 * here — requiring it boots firebase-admin and Stripe. They are small and pure,
 * so they are re-implemented verbatim below and pinned by
 * scripts/check-server-drift.sh, which asserts the constants match across both
 * servers. If you change the originals, change these and the drift guard will
 * tell you if the two servers disagree.
 */

// ── Mirrors of the server constants ────────────────────────────────────────
const FARE_TOLERANCE = 1.5;
const MAX_FARE_CENTS = 15000;
const DROPOFF_CONFIRM_RADIUS_KM = 3;

const PRICING = {
  passengerRateCentsPerKm: 25,
  minimumChargeCents: 100,
  minimumDistanceKm: 0.5,
};

type LL = { latitude: number; longitude: number };

function haversineKm(lat1: number, lon1: number, lat2: number, lon2: number): number {
  const R = 6371;
  const dLat = ((lat2 - lat1) * Math.PI) / 180;
  const dLon = ((lon2 - lon1) * Math.PI) / 180;
  const a =
    Math.sin(dLat / 2) ** 2 +
    Math.cos((lat1 * Math.PI) / 180) * Math.cos((lat2 * Math.PI) / 180) * Math.sin(dLon / 2) ** 2;
  return R * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
}

const gpLL = (g: LL | undefined | null) =>
  g && g.latitude != null && g.longitude != null ? { lat: g.latitude, lng: g.longitude } : null;

type Ride = {
  localisation?: LL;
  destinationCoords?: LL;
  passengerPickups?: Record<string, LL>;
  passengerDropoffs?: Record<string, LL>;
  quotedFareCents?: Record<string, number>;
};

function dropoffReference(ride: Ride, pid: string) {
  return gpLL((ride.passengerDropoffs || {})[pid]) || gpLL(ride.destinationCoords);
}

function legDistanceKm(ride: Ride, pid: string): number | null {
  const from = gpLL((ride.passengerPickups || {})[pid]) || gpLL(ride.localisation);
  const to = dropoffReference(ride, pid);
  if (!from || !to) return null;
  return haversineKm(from.lat, from.lng, to.lat, to.lng);
}

function calculatePassengerChargeCents(distKm: number): number {
  const d = Math.max(distKm, PRICING.minimumDistanceKm);
  return Math.max(Math.round(d * PRICING.passengerRateCentsPerKm), PRICING.minimumChargeCents);
}

function clampFare(fareCents: number, quotedFareCents?: number) {
  let capped = Math.min(fareCents, MAX_FARE_CENTS);
  let reason: string | null = capped < fareCents ? "max_fare" : null;
  const quote = Number(quotedFareCents);
  if (Number.isFinite(quote) && quote > 0) {
    const ceiling = Math.ceil(quote * FARE_TOLERANCE);
    if (capped > ceiling) {
      capped = ceiling;
      reason = "quote_tolerance";
    }
  }
  return { fareCents: capped, clampedBy: reason };
}

// ── Fixtures: Université Laval → Vieux-Québec, ~6.2 km ─────────────────────
const LAVAL: LL = { latitude: 46.7817, longitude: -71.2747 };
const VIEUX_QUEBEC: LL = { latitude: 46.8139, longitude: -71.2080 };
/** ~250 km away — a plausible "driver typed a distant destination" attack. */
const MONTREAL: LL = { latitude: 45.5019, longitude: -73.5674 };

describe("fare is priced from the passenger's own leg", () => {
  it("uses passengerDropoffs, not the driver-supplied ride destination", () => {
    // The attack: driver accepts, naming Montréal as the ride destination, then
    // actually drives the passenger to Vieux-Québec.
    const ride: Ride = {
      localisation: LAVAL,
      destinationCoords: MONTREAL,             // driver-controlled
      passengerPickups: { p1: LAVAL },         // passenger's own request
      passengerDropoffs: { p1: VIEUX_QUEBEC }, // passenger's own request
    };

    const km = legDistanceKm(ride, "p1")!;
    expect(km).toBeGreaterThan(5);
    expect(km).toBeLessThan(8); // the real leg, not the 250 km fiction

    const fare = calculatePassengerChargeCents(km);
    expect(fare).toBeLessThan(300); // ~$1.55, not ~$62
  });

  it("still prices correctly when only the ride destination is available", () => {
    const ride: Ride = {
      localisation: LAVAL,
      destinationCoords: VIEUX_QUEBEC,
      passengerPickups: { p1: LAVAL },
      // no passengerDropoffs — legacy/planned ride
    };
    const km = legDistanceKm(ride, "p1")!;
    expect(km).toBeGreaterThan(5);
    expect(km).toBeLessThan(8);
  });

  it("returns null rather than 0 when the leg is unmeasurable", () => {
    expect(legDistanceKm({ passengerPickups: {} }, "p1")).toBeNull();
  });

  it("agrees with the dropoff radius gate about which point matters", () => {
    // Both must reference passengerDropoffs, or a leg can pass the radius check
    // while being billed against a different destination entirely.
    const ride: Ride = {
      localisation: LAVAL,
      destinationCoords: MONTREAL,
      passengerPickups: { p1: LAVAL },
      passengerDropoffs: { p1: VIEUX_QUEBEC },
    };
    const ref = dropoffReference(ride, "p1")!;
    const driverAtDropoff = haversineKm(
      VIEUX_QUEBEC.latitude, VIEUX_QUEBEC.longitude, ref.lat, ref.lng,
    );
    expect(driverAtDropoff).toBeLessThanOrEqual(DROPOFF_CONFIRM_RADIUS_KM);
  });
});

describe("clampFare", () => {
  it("caps a charge at the quoted fare times the tolerance", () => {
    const { fareCents, clampedBy } = clampFare(6200, 155);
    expect(fareCents).toBe(Math.ceil(155 * FARE_TOLERANCE));
    expect(clampedBy).toBe("quote_tolerance");
  });

  it("leaves an ordinary charge alone", () => {
    const { fareCents, clampedBy } = clampFare(170, 155);
    expect(fareCents).toBe(170);
    expect(clampedBy).toBeNull();
  });

  it("allows genuine drift up to the tolerance", () => {
    const { clampedBy } = clampFare(232, 155); // 1.49x
    expect(clampedBy).toBeNull();
  });

  it("applies the absolute ceiling when there is no quote", () => {
    const { fareCents, clampedBy } = clampFare(999999, undefined);
    expect(fareCents).toBe(MAX_FARE_CENTS);
    expect(clampedBy).toBe("max_fare");
  });

  it("ignores a zero or malformed quote rather than pinning the fare to it", () => {
    expect(clampFare(500, 0).fareCents).toBe(500);
    expect(clampFare(500, NaN).fareCents).toBe(500);
  });
});
