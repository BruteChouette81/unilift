/**
 * Regression tests for the billing audit.
 *
 * Same approach as the other files here: the functions under test live in
 * functions/index.js, which cannot be imported without booting firebase-admin
 * and Stripe, so the pure ones are mirrored verbatim. Every constant below is
 * pinned across both servers by scripts/check-server-drift.sh.
 */

// ── Mirrors of the server constants ────────────────────────────────────────
const PRICING = {
  passengerRateCentsPerKm: 25,
  minimumChargeCents: 100,
  minimumDistanceKm: 0.5,
  stripePercentBps: 290,
  stripeFixedCents: 30,
  // Retired, kept at 0 as a rollback lever — see constants/pricing.ts.
  payoutReserveBps: 0,
  payoutFeeFlatCents: 225,
  payoutFeeBps: 25,
  minSettlementCents: 100,
  minChargeableCents: 50,
  minPayoutCents: 2500,
  maxOutstandingChargeCents: 7500,
  currency: "cad",
  operatingFloatCents: 0,
};

function calculatePassengerChargeCents(distKm: number, p = PRICING): number {
  const d = Math.max(distKm, p.minimumDistanceKm);
  return Math.max(Math.round(d * p.passengerRateCentsPerKm), p.minimumChargeCents);
}
function payoutReserveCents(fareCents: number, p = PRICING): number {
  if (!Number.isFinite(fareCents) || fareCents <= 0) return 0;
  return Math.round(fareCents * (p.payoutReserveBps / 10000));
}
function payoutFeeCents(payoutCents: number, p = PRICING): number {
  if (!Number.isFinite(payoutCents) || payoutCents <= 0) return 0;
  const fee = p.payoutFeeFlatCents + Math.round(payoutCents * (p.payoutFeeBps / 10000));
  return Math.min(Math.max(0, fee), payoutCents);
}
function grossUpChargeCents(netCents: number, p = PRICING): number {
  if (!Number.isFinite(netCents) || netCents <= 0) return 0;
  const pct = p.stripePercentBps / 10000;
  if (!(pct >= 0 && pct < 1)) return Math.ceil(netCents + p.stripeFixedCents);
  return Math.ceil((netCents + p.stripeFixedCents) / (1 - pct));
}

type User = Record<string, any>;

function chargeEligibility(user: User, pricing = PRICING) {
  const u = user || {};
  if (!u.stripePaymentMethodId) return { error: "no_payment_method" };
  const outstanding = Number(u.pendingChargeCents) || 0;
  if (u.disputeOpen === true) return { error: "dispute_open", outstandingCents: outstanding };
  if (u.lastSettlementFailedAt && outstanding > 0) {
    return { error: "settlement_failed", outstandingCents: outstanding };
  }
  const ceiling = Number(pricing.maxOutstandingChargeCents) || 0;
  if (ceiling > 0 && outstanding >= ceiling) {
    return { error: "balance_too_high", outstandingCents: outstanding, limitCents: ceiling };
  }
  return null;
}

function cashoutEligibility(user: User, pricing = PRICING, hasPending = false) {
  const balance = Number(user.availableEarningsCents) || 0;
  const owed = Number(user.pendingChargeCents) || 0;
  const available = Math.max(0, balance - owed);
  const min = pricing.minPayoutCents;
  const base = { available, min, balance, owed };
  if (hasPending) return { canCashout: false, reason: "already_pending", ...base };
  if (user.disputeOpen === true) return { canCashout: false, reason: "dispute_open", ...base };
  if (user.stripeConnectPayoutsEnabled !== true) {
    return { canCashout: false, reason: "payouts_not_enabled", ...base };
  }
  if (available < min) {
    return {
      canCashout: false,
      reason: owed > 0 && balance >= min ? "offsetting_charges" : "below_minimum",
      ...base,
    };
  }
  return { canCashout: true, reason: null, ...base };
}

const CARD = { stripePaymentMethodId: "pm_1" };

// ─────────────────────────────────────────────────────────────────────────────
describe("the payout reserve is retired but reversible", () => {
  it("collects nothing at the shipped default", () => {
    // Superseded by payoutFeeCents below. Kept in the code at 0 so re-enabling
    // it in config/pricing is a rollback rather than a redeploy.
    expect(PRICING.payoutReserveBps).toBe(0);
    for (const km of [0, 1, 4.1, 10, 100]) {
      expect(payoutReserveCents(calculatePassengerChargeCents(km))).toBe(0);
    }
    // Passenger pays exactly the fare; driver is credited exactly the fare.
    expect(calculatePassengerChargeCents(10)).toBe(250);
  });

  it("is charged on top of the fare again once the rate is restored", () => {
    const on = { ...PRICING, payoutReserveBps: 400 };
    const fare = calculatePassengerChargeCents(10, on);  // 250
    expect(fare).toBe(250);
    expect(payoutReserveCents(fare, on)).toBe(10);       // passenger pays 260
  });
});

describe("the payout fee recovers Connect's real cost", () => {
  // The reshape: Connect Express bills $2.00/month per account that receives a
  // payout plus 0.25% + $0.25 per payout — nearly all of it fixed per driver
  // per month. The old 4%-of-fare reserve therefore under-collected on small
  // earners and over-collected on large ones. These cases pin that the
  // replacement tracks the real cost at every size, which is the whole point.
  const connectCost = (payout: number) => 200 + 25 + Math.round(payout * 0.0025);

  it("matches the real cost at every payout size", () => {
    for (const payout of [2500, 3000, 5000, 10000, 20000]) {
      expect(Math.abs(payoutFeeCents(payout) - connectCost(payout))).toBeLessThanOrEqual(1);
    }
  });

  it("is what the old reserve could not be — flat where the cost is flat", () => {
    // The exact failure being fixed: at $30/month the 4% reserve collected
    // $1.20 against a $2.33 cost, and at $200/month it collected $8.00 against
    // $2.75. The fee is within a cent of cost at both.
    expect(payoutReserveCents(3000, { ...PRICING, payoutReserveBps: 400 })).toBe(120);
    expect(payoutFeeCents(3000)).toBe(233);
    expect(payoutReserveCents(20000, { ...PRICING, payoutReserveBps: 400 })).toBe(800);
    expect(payoutFeeCents(20000)).toBe(275);
  });

  it("never exceeds the payout", () => {
    // A fee larger than the balance would turn a payout into a debt.
    expect(payoutFeeCents(100)).toBe(100);
    expect(payoutFeeCents(0)).toBe(0);
    expect(payoutFeeCents(-1)).toBe(0);
  });

  it("collects nothing when both rates are 0 — the rollback is exact", () => {
    const off = { ...PRICING, payoutFeeFlatCents: 0, payoutFeeBps: 0 };
    for (const payout of [2500, 5000, 20000]) {
      expect(payoutFeeCents(payout, off)).toBe(0);
    }
  });
});

describe("grossUpChargeCents leaves the platform whole", () => {
  const stripeFeeOn = (gross: number) =>
    Math.round(gross * (PRICING.stripePercentBps / 10000)) + PRICING.stripeFixedCents;

  it("never nets less than what is owed", () => {
    for (const owed of [100, 137, 999, 5000, 99999]) {
      const gross = grossUpChargeCents(owed);
      expect(gross - stripeFeeOn(gross)).toBeGreaterThanOrEqual(owed);
    }
  });

  it("is applied once per settlement, not once per ride", () => {
    // Ten $5 rides netted into one charge must cost ONE fixed fee, not ten.
    // Grossing up per ride would over-collect $2.70 a month from every user —
    // a platform cut by another name.
    const netted = grossUpChargeCents(5000);
    const perRide = Array.from({ length: 10 }, () => grossUpChargeCents(500))
      .reduce((a, b) => a + b, 0);
    expect(perRide - netted).toBeGreaterThan(250);
  });
});

describe("credit gate", () => {
  it("refuses a passenger with no card", () => {
    expect(chargeEligibility({})).toEqual({ error: "no_payment_method" });
  });

  it("lets an ordinary balance through", () => {
    expect(chargeEligibility({ ...CARD, pendingChargeCents: 2000 })).toBeNull();
  });

  it("blocks at the ceiling", () => {
    const r = chargeEligibility({ ...CARD, pendingChargeCents: 7500 });
    expect(r?.error).toBe("balance_too_high");
  });

  it("blocks a passenger whose card already failed, however small the balance", () => {
    const r = chargeEligibility({
      ...CARD, pendingChargeCents: 500, lastSettlementFailedAt: "2026-08-01T03:00:00Z",
    });
    expect(r?.error).toBe("settlement_failed");
  });

  it("lets them back in once the balance is cleared", () => {
    // The marker alone must not lock someone out forever — a cleared balance is
    // the signal that the card worked.
    expect(chargeEligibility({
      ...CARD, pendingChargeCents: 0, lastSettlementFailedAt: "2026-08-01T03:00:00Z",
    })).toBeNull();
  });

  it("blocks while a chargeback is open", () => {
    expect(chargeEligibility({ ...CARD, disputeOpen: true })?.error).toBe("dispute_open");
  });

  it("is disabled entirely when the ceiling is 0", () => {
    const noCeiling = { ...PRICING, maxOutstandingChargeCents: 0 };
    expect(chargeEligibility({ ...CARD, pendingChargeCents: 999999 }, noCeiling)).toBeNull();
  });
});

// Payouts are automatic and monthly now — nobody taps a button — but this is
// still the gate the enqueue job asks before queuing a row, so the holdback
// rules below are exactly as load-bearing as they were.
describe("the monthly payout gate holds back the offset", () => {
  const READY = { stripeConnectPayoutsEnabled: true };

  it("only queues what is not owed back", () => {
    const e = cashoutEligibility({ ...READY, availableEarningsCents: 5000, pendingChargeCents: 3000 });
    expect(e.balance).toBe(5000);
    expect(e.owed).toBe(3000);
    expect(e.available).toBe(2000);
  });

  it("blocks the withdrawal that would defeat the netting promise", () => {
    // $50 earned, $40 owed: only $10 is really theirs, under the $25 floor.
    const e = cashoutEligibility({ ...READY, availableEarningsCents: 5000, pendingChargeCents: 4000 });
    expect(e.canCashout).toBe(false);
    expect(e.reason).toBe("offsetting_charges");
  });

  it("distinguishes 'not enough yet' from 'spoken for'", () => {
    const poor = cashoutEligibility({ ...READY, availableEarningsCents: 500 });
    expect(poor.reason).toBe("below_minimum");
    const owing = cashoutEligibility({ ...READY, availableEarningsCents: 5000, pendingChargeCents: 4000 });
    expect(owing.reason).toBe("offsetting_charges");
  });

  it("never reports a negative cashable amount", () => {
    const e = cashoutEligibility({ ...READY, availableEarningsCents: 1000, pendingChargeCents: 9000 });
    expect(e.available).toBe(0);
  });

  it("allows a clean driver with no debt to take the lot", () => {
    const e = cashoutEligibility({ ...READY, availableEarningsCents: 5000 });
    expect(e.canCashout).toBe(true);
    expect(e.available).toBe(5000);
  });

  it("freezes withdrawals while a chargeback is open", () => {
    const e = cashoutEligibility({ ...READY, availableEarningsCents: 5000, disputeOpen: true });
    expect(e.canCashout).toBe(false);
    expect(e.reason).toBe("dispute_open");
  });

  it("does not queue a balance that only clears the floor before the offset", () => {
    // Exactly at the $25 floor, but a dollar of it is owed. The Firestore query
    // that feeds the enqueue selects on the RAW balance, so this row is fetched;
    // the gate is what has to reject it. Queuing it would pay out money
    // earmarked to cancel this driver's own charges next settlement.
    const e = cashoutEligibility({
      ...READY,
      availableEarningsCents: PRICING.minPayoutCents,
      pendingChargeCents: 100,
    });
    expect(e.available).toBe(PRICING.minPayoutCents - 100);
    expect(e.canCashout).toBe(false);
    expect(e.reason).toBe("offsetting_charges");
  });

  it("queues a balance sitting exactly on the floor with nothing owed", () => {
    const e = cashoutEligibility({ ...READY, availableEarningsCents: PRICING.minPayoutCents });
    expect(e.canCashout).toBe(true);
    expect(e.available).toBe(PRICING.minPayoutCents);
  });

  it("leaves the held-back remainder in the balance, rather than zeroing it", () => {
    // The bug this guards: cashing out `available` while writing
    // `availableEarningsCents: 0` would destroy the offset holdback.
    const e = cashoutEligibility({ ...READY, availableEarningsCents: 8000, pendingChargeCents: 3000 });
    const remaining = e.balance - e.available;
    expect(e.available).toBe(5000);
    expect(remaining).toBe(3000);
  });
});
