/**
 * Coverage for the client-side fare math.
 *
 * These helpers power in-app *estimates*; the authoritative charge is computed
 * server-side by `calculatePassengerChargeCents` in functions/index.js and
 * functions-sandbox/index.js. The two implementations are a documented mirror,
 * so the cases below deliberately pin the behaviours that must match:
 * the minimum-distance floor, the minimum-charge floor, and rounding.
 */
import {
  DEFAULT_RIDE_PRICING,
  RIDE_PRICING,
  calculateDriverEarningCents,
  calculateFareCents,
  calculatePassengerChargeCents,
  calculatePayoutFeeCents,
  calculatePayoutReserveCents,
  formatCentsAsDollars,
  grossUpChargeCents,
  isValidPricingValue,
  setRidePricing,
} from "../pricing";

// RIDE_PRICING is module-level mutable state hydrated at app startup, so every
// test restores it rather than leaking a mutation into the next one.
const restorePricing = () => {
  Object.assign(RIDE_PRICING, DEFAULT_RIDE_PRICING);
};

beforeEach(restorePricing);
afterAll(restorePricing);

describe("calculateFareCents", () => {
  // The FARE is the number both sides of the ride are measured against: the
  // driver is credited exactly this, and the passenger pays this plus the
  // payout reserve. Pinning it separately from the passenger charge is what
  // keeps the two from drifting when the reserve rate moves.
  it("applies the $1.00 minimum charge to a very short ride", () => {
    // 0.5 km x 25 c/km = 12.5 c, well under the 100 c floor.
    expect(calculateFareCents(0.1)).toBe(100);
  });

  it("applies the minimum DISTANCE before the rate, not after", () => {
    // Anything below minimumDistanceKm (0.5) is priced as 0.5 km. Both of these
    // land under the charge floor, so the floor is what surfaces.
    expect(calculateFareCents(0)).toBe(100);
    expect(calculateFareCents(0.4)).toBe(100);
  });

  it("charges the per-km rate once past the floor", () => {
    // 10 km x 25 c = 250 c.
    expect(calculateFareCents(10)).toBe(250);
    expect(calculateFareCents(20)).toBe(500);
  });

  it("rounds half UP when the product is exactly .5", () => {
    // 4.5 km x 25 c = 112.5 c exactly -> 113 (truncation would give 112).
    expect(calculateFareCents(4.5)).toBe(113);
  });

  it("is subject to binary floating-point drift at .5 boundaries", () => {
    // Pinned deliberately, not aspirationally. In IEEE-754, 4.1 * 25 is
    // 102.49999999999999, not 102.5, so Math.round yields 102 — a cent less
    // than exact decimal arithmetic would give.
    //
    // This is NOT a bug to fix here: the authoritative charge is computed
    // server-side by the identical expression `Math.round(d * rate)`, so both
    // sides drift the same way and always agree. Rewriting one side to use
    // decimal math would DESYNC the estimate from the real charge.
    expect(calculateFareCents(4.1)).toBe(102);
    expect(4.1 * 25).not.toBe(102.5);
  });

  it("never returns a fractional cent", () => {
    for (const km of [0, 0.37, 1, 3.333, 7.77, 42.5]) {
      expect(Number.isInteger(calculateFareCents(km))).toBe(true);
      expect(Number.isInteger(calculatePassengerChargeCents(km))).toBe(true);
    }
  });

  it("is monotonic in distance", () => {
    let prev = -1;
    for (const km of [0, 1, 2, 5, 10, 25, 100]) {
      const cents = calculatePassengerChargeCents(km);
      expect(cents).toBeGreaterThanOrEqual(prev);
      prev = cents;
    }
  });
});

describe("the payout reserve", () => {
  // RETIRED — the Connect cost it funded is now deducted from the driver's
  // payout (calculatePayoutFeeCents), because that cost is fixed per driver per
  // month and a percentage of every fare was the wrong shape for it. The code
  // path stays, at 0, so re-enabling it in config/pricing is a rollback.
  it("is off by default, so the passenger pays exactly the fare", () => {
    expect(DEFAULT_RIDE_PRICING.payoutReserveBps).toBe(0);
    const fare = calculateFareCents(10);
    expect(fare).toBe(250);
    expect(calculatePayoutReserveCents(fare)).toBe(0);
    expect(calculatePassengerChargeCents(10)).toBe(fare);
    expect(calculateDriverEarningCents(10, 1)).toBe(fare);
  });

  it("is still charged on top of the fare when configured", () => {
    // The rollback direction: turning it back on must add to the passenger's
    // charge and leave the driver's credit untouched, exactly as before.
    setRidePricing({ payoutReserveBps: 400 });
    const fare = calculateFareCents(10);              // 250
    expect(calculatePayoutReserveCents(fare)).toBe(10); // 4%
    expect(calculatePassengerChargeCents(10)).toBe(fare + 10);
    expect(calculateDriverEarningCents(10, 1)).toBe(fare);
  });

  it("is exactly the gap between what is paid and what is earned", () => {
    setRidePricing({ payoutReserveBps: 400 });
    for (const km of [0, 0.4, 1, 4.1, 7.5, 23.7, 100]) {
      const gap = calculatePassengerChargeCents(km) - calculateDriverEarningCents(km, 1);
      expect(gap).toBe(calculatePayoutReserveCents(calculateFareCents(km)));
    }
  });

  it("disappears entirely when the rate is 0", () => {
    // The rollback path: setting config/pricing.payoutReserveBps to 0 must
    // restore the exact previous behaviour, not merely approximate it.
    setRidePricing({ payoutReserveBps: 0 });
    for (const km of [0, 1, 4.1, 10, 100]) {
      expect(calculatePassengerChargeCents(km)).toBe(calculateDriverEarningCents(km, 1));
    }
  });

  it("never rounds up to more than a cent above the true percentage", () => {
    for (const km of [1, 4.1, 10, 23.7, 100]) {
      const fare = calculateFareCents(km);
      const exact = fare * (DEFAULT_RIDE_PRICING.payoutReserveBps / 10000);
      expect(Math.abs(calculatePayoutReserveCents(fare) - exact)).toBeLessThanOrEqual(0.5);
    }
  });
});

describe("calculateDriverEarningCents", () => {
  it("credits the driver the full fare, with no spread taken out of it", () => {
    // THE no-cut invariant, and it still holds. UniLift used to keep a 25 -> 20
    // spread (20%) inside the fare; the driver rate was deleted so this equality
    // is structural. The payout reserve does NOT reappear as a cut here — it is
    // added on top of what the passenger pays, and tested separately above.
    expect(calculateDriverEarningCents(10, 1)).toBe(250);
    expect(calculateDriverEarningCents(10, 1)).toBe(calculateFareCents(10));
  });

  it("holds the no-cut invariant across a range of distances", () => {
    for (const km of [0, 0.4, 1, 4.1, 7.5, 23.7, 100]) {
      expect(calculateDriverEarningCents(km, 1)).toBe(calculateFareCents(km));
    }
  });

  it("scales linearly with passenger count", () => {
    expect(calculateDriverEarningCents(10, 3)).toBe(750);
  });

  it("applies the minimum distance but NOT the minimum charge", () => {
    // The driver is credited the fare, floor included: 0.5 km -> 12.5 c, but
    // the $1.00 minimum charge applies, so 100 c.
    expect(calculateDriverEarningCents(0, 1)).toBe(100);
  });

  it("earns nothing when there are no passengers", () => {
    expect(calculateDriverEarningCents(20, 0)).toBe(0);
  });
});

describe("setRidePricing", () => {
  it("merges valid overrides from the remote config doc", () => {
    setRidePricing({ passengerRateCentsPerKm: 50 });
    expect(calculateFareCents(10)).toBe(500);
    // Untouched keys keep their defaults.
    expect(RIDE_PRICING.minimumChargeCents).toBe(
      DEFAULT_RIDE_PRICING.minimumChargeCents,
    );
  });

  it("ignores non-positive and non-finite values so estimates never break", () => {
    setRidePricing({
      passengerRateCentsPerKm: 0,
      minimumChargeCents: Number.NaN,
      minSettlementCents: -5,
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      minimumDistanceKm: "abc" as any,
    });
    expect(RIDE_PRICING).toEqual(DEFAULT_RIDE_PRICING);
  });

  it("ignores an empty payload", () => {
    setRidePricing({});
    expect(RIDE_PRICING).toEqual(DEFAULT_RIDE_PRICING);
  });
});

describe("formatCentsAsDollars", () => {
  it("always shows two decimal places", () => {
    expect(formatCentsAsDollars(100)).toBe("$1.00");
    expect(formatCentsAsDollars(5)).toBe("$0.05");
    expect(formatCentsAsDollars(1234)).toBe("$12.34");
    expect(formatCentsAsDollars(0)).toBe("$0.00");
  });
});

/** What Stripe actually keeps from a charge of `gross`, per their published
 *  formula. Used to prove the gross-up leaves UniLift whole. */
const stripeFeeOn = (gross: number) =>
  Math.round(gross * (DEFAULT_RIDE_PRICING.stripePercentBps / 10000)) +
  DEFAULT_RIDE_PRICING.stripeFixedCents;

describe("grossUpChargeCents", () => {
  it("charges enough that UniLift nets exactly what it owes drivers", () => {
    // $50.00 owed at 2.9% + $0.30 -> ceil(5030 / 0.971) = 5181.
    expect(grossUpChargeCents(5000)).toBe(5181);
    expect(5181 - stripeFeeOn(5181)).toBeGreaterThanOrEqual(5000);
  });

  it("NEVER leaves the platform short, across a wide sweep", () => {
    // The whole point of the change: no settlement may end with UniLift owing
    // drivers more than it received. `ceil` guarantees the error is a surplus.
    for (const owed of [100, 137, 250, 999, 1000, 4321, 5000, 12345, 99999]) {
      const gross = grossUpChargeCents(owed);
      expect(gross - stripeFeeOn(gross)).toBeGreaterThanOrEqual(owed);
    }
  });

  it("keeps the surplus to at most a cent or two", () => {
    // Covering the fee must not become a cut by the back door.
    for (const owed of [100, 250, 1000, 5000, 12345]) {
      const gross = grossUpChargeCents(owed);
      expect(gross - stripeFeeOn(gross) - owed).toBeLessThanOrEqual(2);
    }
  });

  it("rounds up, never down", () => {
    // (1000 + 30) / 0.971 = 1060.76... -> 1061, not 1060.
    expect(grossUpChargeCents(1000)).toBe(1061);
  });

  it("returns 0 for nothing owed", () => {
    expect(grossUpChargeCents(0)).toBe(0);
    expect(grossUpChargeCents(-500)).toBe(0);
    expect(grossUpChargeCents(Number.NaN)).toBe(0);
  });

  it("degrades safely if the configured rate is nonsensical", () => {
    // A percentage >= 100% makes the division diverge or flip sign; fall back to
    // additive recovery rather than billing a garbage amount.
    const broken = { ...DEFAULT_RIDE_PRICING, stripePercentBps: 10000 };
    expect(grossUpChargeCents(5000, broken)).toBe(5030);
    const negative = { ...DEFAULT_RIDE_PRICING, stripePercentBps: -100 };
    expect(grossUpChargeCents(5000, negative)).toBe(5030);
  });

  it("is a no-op when Stripe costs nothing", () => {
    const free = { ...DEFAULT_RIDE_PRICING, stripePercentBps: 0, stripeFixedCents: 0 };
    expect(grossUpChargeCents(5000, free)).toBe(5000);
  });
});

describe("isValidPricingValue", () => {
  it("accepts 0 for the fee fields — 0 is a real setting, not 'unset'", () => {
    // A bare `> 0` guard here would discard a deliberate 0 and silently fall
    // back to the default, i.e. the config field would stop working exactly
    // when someone tried to switch it off.
    expect(isValidPricingValue("payoutReserveBps", 0)).toBe(true);
    expect(isValidPricingValue("stripeFixedCents", 0)).toBe(true);
    expect(isValidPricingValue("stripePercentBps", 0)).toBe(true);
  });

  it("rejects 0 for rates and minimums, where it would be an accident", () => {
    expect(isValidPricingValue("passengerRateCentsPerKm", 0)).toBe(false);
    expect(isValidPricingValue("minimumChargeCents", 0)).toBe(false);
    expect(isValidPricingValue("minSettlementCents", 0)).toBe(false);
  });

  it("rejects negatives and non-numbers everywhere", () => {
    expect(isValidPricingValue("payoutReserveBps", -1)).toBe(false);
    expect(isValidPricingValue("passengerRateCentsPerKm", Number.NaN)).toBe(false);
    expect(isValidPricingValue("stripeFixedCents", "abc")).toBe(false);
  });
});

describe("the payout fee", () => {
  // Replaces the per-ride reserve. Stripe Connect Express costs $2.00/month per
  // account that receives a payout, plus 0.25% + $0.25 per payout — almost
  // entirely fixed per driver per month. These cases pin that the fee tracks
  // that cost at every payout size, which the 4%-of-fare reserve did not.
  it("recovers Stripe's actual Connect cost at any payout size", () => {
    // flat 225 + 0.25% of the amount
    expect(calculatePayoutFeeCents(3000)).toBe(225 + 8);   // $30.00 → $2.33
    expect(calculatePayoutFeeCents(5000)).toBe(225 + 13);  // $50.00 → $2.38
    expect(calculatePayoutFeeCents(20000)).toBe(225 + 50); // $200.00 → $2.75
  });

  it("stays close to cost where the old 4% reserve did not", () => {
    // The failure the reshape exists to fix: 4% of fare volume under-collected
    // on small earners and over-collected on large ones, because the underlying
    // cost barely moves. The fee must never drift like that.
    for (const payout of [2500, 5000, 10000, 20000]) {
      const fee = calculatePayoutFeeCents(payout);
      const realCost = 200 + 25 + Math.round(payout * 0.0025);
      expect(Math.abs(fee - realCost)).toBeLessThanOrEqual(1);
    }
  });

  it("never exceeds the payout or goes negative", () => {
    // A fee bigger than the balance would turn a payout into a debt. The floor
    // (minPayoutCents, $25) means this should be unreachable in production, but
    // the clamp is what makes that a guarantee rather than an assumption.
    expect(calculatePayoutFeeCents(100)).toBe(100);
    expect(calculatePayoutFeeCents(0)).toBe(0);
    expect(calculatePayoutFeeCents(-500)).toBe(0);
    expect(calculatePayoutFeeCents(Number.NaN)).toBe(0);
  });

  it("disappears entirely when both rates are 0", () => {
    // The rollback path, mirroring the reserve's.
    setRidePricing({ payoutFeeFlatCents: 0, payoutFeeBps: 0 });
    for (const payout of [2500, 5000, 20000]) {
      expect(calculatePayoutFeeCents(payout)).toBe(0);
    }
  });

  it("leaves a driver at the payout floor with most of their money", () => {
    // Sanity on minPayoutCents: the fee is what makes a small payout not worth
    // sending, so the floor has to keep it a small share of the smallest one.
    const fee = calculatePayoutFeeCents(DEFAULT_RIDE_PRICING.minPayoutCents);
    expect(fee / DEFAULT_RIDE_PRICING.minPayoutCents).toBeLessThan(0.1);
  });
});

describe("grossUpChargeCents at the small-charge boundary", () => {
  // The economics of keeping minSettlementCents at $1.00: Stripe's $0.30 fixed
  // fee dominates a ~$1 charge. The gross-up passes that to the passenger, so
  // UniLift nets exactly what it owes drivers — these cases pin that it really
  // does net out, because a rounding slip here is a per-settlement shortfall.
  const netsAtLeast = (net: number) => {
    const gross = grossUpChargeCents(net);
    const stripeTakes = Math.round(gross * 0.029) + 30;
    return gross - stripeTakes;
  };

  it("covers Stripe's cut on a single minimum-fare month", () => {
    const owed = DEFAULT_RIDE_PRICING.minimumChargeCents; // $1.00
    expect(grossUpChargeCents(owed)).toBe(134);           // passenger pays $1.34
    expect(netsAtLeast(owed)).toBeGreaterThanOrEqual(owed);
  });

  it("never under-recovers, at any balance", () => {
    // ceil(), not round(): the surplus must always land in the platform's
    // favour. A cent short here happens on EVERY settlement.
    for (const owed of [100, 137, 250, 999, 1040, 5000, 7500]) {
      expect(netsAtLeast(owed)).toBeGreaterThanOrEqual(owed);
    }
  });

  it("costs proportionally less the larger the balance", () => {
    // Why batching would help and why not batching is a priced decision: the
    // surcharge on $1.00 is ~34%, on $10.40 it is ~6%.
    const small = grossUpChargeCents(100) / 100;
    const large = grossUpChargeCents(1040) / 1040;
    expect(small).toBeGreaterThan(1.3);
    expect(large).toBeLessThan(1.07);
  });
});
