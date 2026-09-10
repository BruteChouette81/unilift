# How money moves through UniLift

Reference for the whole payment path: what a passenger is charged, what a driver
earns, when each actually moves, and what happens when a step fails.

Two codebases implement it identically — [functions/index.js](../functions/index.js)
(LIVE) and [functions-sandbox/index.js](../functions-sandbox/index.js) (dev). Every
change below must be made twice; `npm run check:server-drift` enforces it.

---

## 1. Two rails, and why they are separate

| | Charge rail — how a passenger **pays** | Payout rail — how a driver **gets paid** |
|---|---|---|
| Credential | A saved card (`pm_…`) on a Stripe **Customer** | A Stripe **Connect Express account** (`acct_…`) |
| Direction | Pull — off-session PaymentIntent | Push — transfer from the platform balance |
| Cadence | Once a month, netted, on the **1st** | Once a month, automatic, on the **5th** |
| Lives on | The platform account | The connected account, then their bank |

They never share state, and they cannot. A saved card is a **pull-only** credential —
it can be charged, but money can never be sent *to* it — so a driver has to register
something else entirely to receive money.

**Neither rail is on demand.** Passengers are charged on the 1st; drivers are paid on
the 5th. A driver cannot request money early and there is no cash-out button — see
§1.1 for why the four-day gap is the whole point.

**UniLift uses separate charges and transfers, deliberately not destination charges.**
A destination charge binds one charge to one connected account. That is wrong here,
because a single monthly netted charge funds *many* different drivers, and one
passenger's payment may be split across everyone who drove them that month. Do not
refactor toward `transfer_data` — it cannot express this.

### 1.1 Does passenger money actually pay drivers? Yes — and the delay is why the dates differ

The two rails do meet, in the **platform's Stripe balance**. That is the whole
mechanism, and it is worth stating plainly because the two halves look unconnected in
the code:

1. `settleAllUsers` charges the saved card with a PaymentIntent **on the platform
   account**. Those funds credit the platform balance.
2. `payoutPendingEarningsImpl` calls `stripe.transfers.create({ destination: acct_… })`,
   which **debits that same platform balance** and credits the connected account.
   Stripe then pays the connected account out to the driver's bank.

That is Stripe's *separate charges and transfers* model working as designed. Money
taken from a Customer is ordinary platform revenue and can fund any transfer.

**But it is not spendable the moment the charge succeeds.** A card charge lands in
Stripe's `pending` balance and becomes `available` at roughly T+2..7 (CAD), and
`transfers.create` can spend nothing but `available` funds — anything else fails
`balance_insufficient`. Hence the shape of the whole schedule:

```
  1st   charge the passengers      →  platform balance: pending
  T+2..7 Stripe clears the charges →  platform balance: available
  5th   queue the driver payouts   →  payouts rows written
  daily transfer what has cleared  →  connected accounts, then banks
```

Three things follow, and each is load-bearing:

- **`source_transaction` was considered and rejected.** Passing the originating charge
  id lets a transfer be created before that charge clears. It also binds one transfer
  to one charge, which cannot express the netting — do not reach for it as a way to
  pay drivers sooner.
- **Refunds, disputes and Stripe's own fees draw on the same balance.**
  `operatingFloatCents` is withheld from what the sweeper will spend so those always
  have something to land against. It is `0` today; that is a config decision, not a
  code one.
- **The connected account must have `payouts_enabled`.** The sweeper re-reads Stripe
  and self-heals a missed `account.updated` webhook before deciding a driver is not
  ready.

---

## 2. The lifecycle, end to end

```
  ADD A CARD           POST /wallet/setup                → Customer + ephemeral key
                       POST /wallet/setup-payment-method → SetupIntent (off_session)
                       POST /wallet/confirm-payment-method
                            └─ mirrors stripePaymentMethodId / Last4 / Brand

  BEFORE A RIDE        chargeEligibility()   card present? no dispute? last charge
                                             ok? balance under the ceiling?
                       POST /requests/dispatch  ← gate + writes quotedFareCents
                       POST /requests/accept    ← gate again; creates the ride

  RIDE HAPPENS         /rides/start → /rides/board → /rides/dropoff → /rides/finish

  ACCRUAL              /rides/finish, one transaction:
                         passenger  pendingChargeCents   += fare + reserve
                         driver     pendingEarningsCents += fare
                         + a ride_charge and a ride_earning ledger row

  SETTLEMENT           monthlyBilling, 1st at 03:00 ET → settleAllUsers()
                         net = pendingEarningsCents − pendingChargeCents
                         net < 0 → charge the card for grossUp(|net|)
                         net > 0 → availableEarningsCents += net
                         net = 0 → clear both, no money moves

  (2–7 days)           Stripe clears those charges into the available balance

  ENQUEUE              monthlyDriverPayouts, 5th at 03:00 ET
                         → queueMonthlyPayouts()
                         every balance clearing minPayoutCents after the offset:
                         debits availableEarningsCents, writes a payouts row

  PAYOUT               payoutPendingEarnings, daily 04:00 ET
                         stripe.transfers.create → the connected account
                         Stripe then pays out to the driver's bank
```

Nothing in that column is driver-initiated. `POST /payouts/cashout` still exists but
only answers `409 automatic_payouts` with the next run's date — it is kept registered
so builds shipped before this change get an explainable error instead of a 404, and
because the drift guard compares route tables.

---

## 3. The three counters

Getting these confused is the single most common mistake in this system.

| Field | Means | Real money? |
|---|---|---|
| `pendingChargeCents` | Ride charges accrued this cycle | **No.** An accrual. Nothing has been charged. |
| `pendingEarningsCents` | Ride earnings accrued this cycle | **No.** Offsets the above at settlement. |
| `availableEarningsCents` | Settled earnings, queued on the 5th | **Yes** — the passengers behind it have been charged. |
| a `payouts` row | A payout in flight | Debited from the balance, not yet at the bank. |

**`availableEarningsCents` is written by settlement and by nothing else.** That single
fact is what makes "a driver is never paid money no passenger was charged for"
structural rather than a scheduling coincidence: the enqueue job can only queue what
is in that field, and the only way in is through a succeeded charge. The 5th is about
Stripe's clearing delay; *this* is the guarantee. Adding a second writer to that field
would quietly remove it.

The netting is the point: **a driver's own ride charges are cancelled out by their
earnings before anything moves.** Drive enough in a month and you pay nothing. That is
also why the enqueue holds back `pendingChargeCents` from what it will send — paying
out money already earmarked for the offset would defeat it. A driver sitting exactly on
the $25 floor with any unsettled charge of their own is not queued.

---

## 4. The money math

**One fare rate.** `passengerRateCentsPerKm: 25` is charged to the passenger *and*
credited to the driver. There is no spread. The driver keeps all of it; the only
deduction anywhere is the once-a-month payout fee below, which is itemised. This used to be two numbers (25 charged /
20 credited) — a silent 20% cut — and the second was deleted rather than set equal, so
a stray config edit cannot reintroduce it.

**The fare** is `max(round(distanceKm × rate), minimumChargeCents)`, where distance is
floored at `minimumDistanceKm` (0.5 km) first. Distance is straight-line between the
**passenger's own** pickup and dropoff — not road distance, and not the ride's
destination, which the driver supplies and could inflate.

**The payout fee** (`payoutFeeFlatCents` 225 + `payoutFeeBps` 25) is deducted from the
driver's monthly payout — **not** charged to the passenger. It recovers Stripe Connect
Express exactly: $2.00/month per account that receives any payout, plus 0.25% + $0.25
per payout.

> **It is cost recovery, not margin.** UniLift takes no commission today. Passengers
> pay exactly the fare; drivers are credited exactly the fare and then pay this once a
> month for the transfer itself. It is itemised as a `payout_fee` ledger row and shown
> on the payout card *before* it happens — a driver must never find a smaller number
> than they earned with no explanation.

**Why it is not a percentage of the fare.** It used to be: `payoutReserveBps` charged
the passenger 4% of every ride. The cost it funds is almost entirely fixed per
*driver per month*, so a percentage of *ride* volume was the wrong shape and drifted
in both directions:

| Driver earns / month | Real Connect cost | Old 4% reserve | |
|---|---|---|---|
| $30 | $2.33 | $1.20 | short $1.13 |
| $50 | $2.38 | $2.00 | short $0.38 |
| $200 | $2.75 | $8.00 | over-collected $5.25 |

`payoutReserveBps` still exists and still works, shipped at **0**. Setting it back
above 0 in `config/pricing` (~60 s TTL) and the payout fee to 0 is a no-redeploy
rollback to the old shape.

> **The wallet is debited by the GROSS.** `queueMonthlyPayouts` takes
> `availableEarningsCents − gross` and stores `grossCents`, `feeCents` and the net
> `amountCents` on the `payouts` row. Every refund path in the sweeper — the give-up
> branch and the 30-day `awaiting_setup` expiry — therefore credits back
> **`grossCents`**, not `amountCents`. Refunding the net would pocket the fee for a
> payout that never happened.

**Stripe's charge fee** is grossed up onto the passenger at settlement:
`gross = ceil((net + fixed) / (1 − percent))`. `ceil`, not `round` — rounding down
leaves the platform a cent short on every settlement, and a sub-cent surplus is the
intended direction of error.

**Once per settlement, never per ride.** Ten $5 rides netted into one charge incur
Stripe's fixed fee once. Applying the gross-up per ride would collect ten fixed fees
against Stripe's one — over-collection, which is a platform cut by another name.

---

## 5. Who may take on a charge

`chargeEligibility(user, pricing)` is the single gate, called from
`/requests/dispatch`, `/requests/accept` and `/rides/can-join`. It refuses when:

| Reason | Meaning |
|---|---|
| `no_payment_method` | No card on file. |
| `dispute_open` | A chargeback is being contested. No more credit until it resolves. |
| `settlement_failed` | Their last charge failed and the balance is still outstanding. |
| `balance_too_high` | Unsettled debt has reached `maxOutstandingChargeCents` ($75). |

The ceiling exists because a card is not touched until settlement. Without it the
exposure per passenger is unbounded for a whole billing cycle — and because a failed
settlement deliberately leaves the counters untouched, a *declined* card did not stop
anyone either.

**The gate is enforced at accept, not only at dispatch.** That is where the ride, and
therefore the charge, actually comes into existence.

---

## 6. Failure behaviour, step by step

| Step | On failure | Where the money is |
|---|---|---|
| `/rides/finish` | One transaction; nothing partial. A deleted passenger no longer fails the whole ride. | Nothing charged yet — accrual only. |
| Settlement, no card | Counters untouched, balance rolls forward, push sent, `lastSettlementFailedAt` stamped. | Nothing moved. |
| Settlement, declined | Same, plus the reason recorded. `requires_action` (3-D Secure off-session) is treated the same way. | Nothing moved. |
| Settlement, charge succeeded but the write failed | A `settlements/{uid}_{month}` claim doc records the attempt. The next run finds the succeeded PaymentIntent by `metadata.settlementMonth` and reconciles instead of charging again. | Charged once. |
| Settlement, balance below `minSettlementCents` | Rolls forward. Stripe rejects charges under ~$0.50, and grossing up a few cents would bill more than the debt. | Nothing moved. |
| The enqueue runs twice | `findPendingCashout` skips anyone with a row in flight, and the balance is debited inside the same transaction that creates the row. Re-running the job is a no-op. | Debited once. |
| Transfer fails | Retried daily, up to `MAX_PAYOUT_ATTEMPTS` (5). | Still in the queue. |
| Transfer gave up | **Stripe is checked first** for a transfer with `metadata.payoutId`. Found → the row is completed. Not found → the balance is credited back. | Never both. |
| Insufficient platform balance | The sweeper stops rather than skipping ahead, so the driver who waited longest is paid first. | Queued. |
| Connect onboarding never finished | After `AWAITING_SETUP_TTL_MS` (30 days) the row is cancelled and the balance refunded, and the next month's run queues it again. | Back in the wallet. |
| Chargeback | `charge.dispute.created` freezes that user's payouts and records a `dispute` row. | Already left the platform balance. |

**Idempotency keys:** `monthly-settle-{uid}-{month}-{gross}` (the amount is in the key,
so a changed balance gets a fresh key rather than an `idempotency_error`) and
`payout-{payoutDocId}`.

---

## 7. Ledger row types

Written to `users/{uid}/transactions`. Every type here must appear in
`txTypeNames` in [app/(tabs)/wallet.tsx](../app/(tabs)/wallet.tsx) or it renders
unlabeled — TypeScript enforces exhaustiveness against
[types/models.ts](../types/models.ts).

| `type` | Written by | Direction |
|---|---|---|
| `ride_charge` | `/rides/finish` | debit |
| `ride_earning` | `/rides/finish` | credit |
| `earnings_available` | settlement, `net > 0` | credit |
| `monthly_charge` | settlement, `net < 0` | debit |
| `cashout` | `queueMonthlyPayouts` — the monthly enqueue | credit |
| `payout_fee` | `queueMonthlyPayouts` — Stripe's Connect cost for that payout | debit |
| `refund` | `/billing/refund`, `charge.refunded` | credit |
| `clawback` | `/billing/refund` when the driver was already paid | debit |
| `dispute` | `charge.dispute.created` | debit |
| `monthly_payout` | *legacy* — the pre-Connect design | credit |

---

## 8. Refunds

`POST /billing/refund { rideId, passengerId, amountCents, reason }`, guarded by
`x-billing-secret`. Support tooling, not a client route. Two cases, because the money
is in different places:

- **Not yet settled** — the charge is still an accrual. Both sides are decremented.
  No Stripe call.
- **Already settled** — `stripe.refunds.create` against the PaymentIntent recorded on
  the settlement claim doc, then the driver's side is reversed against
  `pendingEarningsCents` or `availableEarningsCents`. If they have already been paid
  out, a `clawback` row is recorded instead of driving their balance negative — a
  negative balance would silently eat next month's earnings with no explanation.

A refund issued from the Stripe dashboard is recorded by the `charge.refunded`
webhook, but the **counters are not adjusted**: a dashboard refund carries no ride id,
so there is no way to know whose earnings to reverse. Use the route.

---

## 9. Operations

Four scheduled jobs, all `America/Toronto`, 540 s, 512 MiB:

| Job | Schedule | Does |
|---|---|---|
| `sweepStaleRides` | every 5 min | Expires wedged rides and requests. |
| `monthlyBilling` | `0 3 1 * *` | `settleAllUsers` — up to `SETTLEMENT_BATCH` (300) users per run; the rest roll to the next. |
| `monthlyDriverPayouts` | `0 3 5 * *` | `queueMonthlyPayouts` — writes a `payouts` row for every balance clearing the floor. |
| `payoutPendingEarnings` | `0 4 * * *` | Drains the `payouts` queue. |

**The order is the cash-flow design, not a preference.** Charge on the 1st, let Stripe
clear for four days, queue on the 5th, transfer daily from there. `PAYOUT_DAY_OF_MONTH`
is a mirrored constant the drift guard checks on both servers — a server paying on a
different day than its twin is one transferring money that has not landed.

Do not move the enqueue earlier to pay drivers faster. On the 1st the money is still
`pending` at Stripe, so every row would go straight into the sweeper's `insufficient`
branch and nobody would be paid sooner anyway.

The payout sweeper stays **daily** because clearing is a range, not a date: it picks up
whatever became available since the last run. A non-zero `insufficient` in the tally on
the 5th–7th is **normal**; still non-zero by the 10th is not, and means the platform
balance genuinely does not cover what drivers are owed.

Manual triggers, same `x-billing-secret` guard:

```bash
curl -X POST $BASE/billing/settle-monthly -H "Authorization: Bearer $TOKEN" -H "x-billing-secret: $SECRET"
curl -X POST $BASE/billing/queue-payouts  -H "Authorization: Bearer $TOKEN" -H "x-billing-secret: $SECRET"
curl -X POST $BASE/billing/run-payouts    -H "Authorization: Bearer $TOKEN" -H "x-billing-secret: $SECRET"
```

`queue-payouts` is safe to re-run — a driver with a row already in flight is skipped.

Reading a settlement tally: `charged` is the goal. `no_payment_method` and
`not_succeeded` are **uncollected receivables** — money drivers were credited that
nobody paid. Watch that number; it is the gap between what the wallet says drivers are
owed and what UniLift actually holds.

Webhooks — two endpoints, two secrets, because Stripe signs platform and Connect
events separately. Full dashboard configuration, including the test-mode
endpoints and the Connect settings, is in
[stripe-dashboard-setup.md](stripe-dashboard-setup.md):

| Endpoint | Secret | Events |
|---|---|---|
| `/stripe/webhook` | `STRIPE_WEBHOOK_SECRET` | `charge.dispute.created`, `charge.dispute.closed`, `charge.refunded`, `payment_intent.payment_failed` |
| `/stripe/connect-webhook` | `STRIPE_CONNECT_WEBHOOK_SECRET` | `account.updated`, `payout.failed` |

**`payout.failed` belongs on the Connect endpoint, not the platform one.** The handler
identifies the driver from `event.account`, which Stripe only populates on
connected-account events. Subscribed on the platform endpoint it matched nobody, so a
driver whose bank rejected a payout was never told. Both endpoints call the same
`handlePayoutFailed`; on the platform endpoint it only logs the platform's own failed
bank payouts.

---

## 10. Known gaps

- **Uncollected receivables are now measured, not inferred.** `settlementTotals()`
  sums `below_threshold` + `no_payment_method` + `not_succeeded` into
  `uncollectedCents`, logged by `monthlyBilling` and returned by
  `POST /billing/settle-monthly`. That is the gap between what the wallets promise
  drivers and what UniLift actually collected. `below_threshold` in particular is
  silent by design — the balance rolls forward with no notification — so watch it.
- **Small charges are expensive, deliberately.** With `minSettlementCents` at $1.00 a
  one-ride month bills $1.34 for a $1.00 fare: Stripe's $0.30 is ~30% of it, grossed
  up onto the passenger. Letting balances accumulate to ~$10 would cut that to ~6%,
  and is the lever to reach for if the surcharge becomes a complaint.
- **No commission.** UniLift takes cost recovery only. The stated business model is a
  transaction fee; it is not implemented. Adding one means a `platformFeeBps` deducted
  from the fare before the driver is credited — deliberately *not* the reserve, which
  is a cost pass-through and should stay legible as one.
- **No tax handling, no receipts or invoices.** Quebec ridesharing has GST/QST
  implications and drivers may need earnings statements. Out of scope pending an
  accountant on registration and thresholds.
- **Driver credit can still exceed collected funds — narrowed, not closed.** Moving
  payouts to a fixed monthly date after the charges clear removed the *timing* hole: a
  driver can no longer pull money on the 2nd that the platform collects on the 7th.
  What remains is per-counterparty. Settlement credits `availableEarningsCents` for a
  ride whether or not *that passenger's* charge succeeded, so a month with failed
  settlements leaves the wallet promising more than UniLift collected. No money can
  actually leave — the sweeper transfers only against the real Stripe balance, minus
  `operatingFloatCents` — but the shortfall shows up as a stuck `insufficient` tally
  rather than as an obvious accounting error. The receivables line in §9 is how you
  see it.
- **Charges are straight-line distance, not road distance.** Passengers are
  systematically undercharged relative to the trip actually driven.
