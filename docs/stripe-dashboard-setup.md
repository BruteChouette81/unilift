# Stripe dashboard setup — Connect and webhooks

Everything that has to be configured **by hand in the Stripe dashboard** for the
payout rail to work, written against what the code actually does rather than
against Stripe's generic marketplace guide.

> Companion docs: [`payments-and-settlement.md`](payments-and-settlement.md) is
> how money moves and why; [`backend-cutover-checklist.md`](backend-cutover-checklist.md)
> is the wider release checklist. This file is only the dashboard.

**The one-line summary of why the code constrains the dashboard:** UniLift uses
**separate charges and transfers**. Passengers are charged on the platform
account; drivers receive `stripe.transfers.create` into their connected account;
Stripe's *own* account-level schedule then pays that out to their bank. The code
never calls `stripe.payouts.create` and never sets `settings.payouts.schedule`,
so the last hop is governed entirely by a dashboard setting.

---

## 1. Platform account (live mode)

| Setting | Value | Why it matters |
|---|---|---|
| Country / default currency | **Canada / CAD** | Every PaymentIntent and Transfer hardcodes `currency: "cad"`. The payout sweeper reads `balance.available` and pays **nothing** if there is no CAD entry. |
| Business profile | Complete — legal entity, support email + phone, website `https://unilift.ca` | Connect stays restricted until this is done. `unilift.ca` is also set as every driver's `business_profile.url`, so it is what a Stripe reviewer opens. |
| Statement descriptor | `UNILIFT` (set the short form too) | Riders see **one netted monthly charge**, weeks after the rides that produced it. An unrecognizable descriptor is a chargeback generator — and a dispute freezes that user's booking *and* their payouts. |
| Default API version | Pin it deliberately, and write down which one | The server SDK (`stripe: ^19.3.1`) passes **no `apiVersion`**, so it floats on whatever the account default is. Changing it in the dashboard changes server behaviour with no deploy and no code review. |

**Do not change the ephemeral-key API version.** `functions/index.js` pins
`"2024-06-20"` on both `ephemeralKeys.create` calls, and it has to stay
compatible with `@stripe/stripe-react-native@0.64.0` in the app.

---

## 2. Connect

Dashboard → Connect → Get started, then Settings.

| Setting | Value | Why it matters |
|---|---|---|
| Platform country | **Canada** | |
| Account type | **Express** | `accounts.create` hardcodes `type: "express"`, `country: "CA"`, `business_type: "individual"`. |
| Capabilities on connected accounts | **`transfers` only** | The code requests `capabilities: { transfers: { requested: true } }` and nothing else. **Do not enable `card_payments`** in the onboarding template — drivers never take card payments, and requesting it only adds verification screens for a capability that is never used. |
| Loss liability | **Platform** | With separate charges and transfers the platform owns every charge, every dispute and any negative balance. |
| **Payout schedule for connected accounts** | **Automatic — daily** | ⚠️ **The single most consequential setting on this page.** The code only creates Transfers. If the default is *Manual*, money lands in the driver's Stripe balance and **never reaches their bank**, with no error in any log. |
| Express Dashboard | **Enabled** | `POST /connect/dashboard` calls `accounts.createLoginLink`, which fails outright if the Express Dashboard is off. |
| Branding — logo, icon, brand colour, business name | Set | This is the hosted onboarding page and the Express dashboard the driver lives in. |
| Supported countries | **Canada only** | |

**Onboarding field collection is already scoped in code** —
`collection_options: { fields: "currently_due" }` — so do not force
"eventually due" in the dashboard.

**MCC** is set per connected account in code (`4121`, Taxicabs & Limousines)
along with `business_profile.url` and `product_description`. Nothing to do here,
but make sure the *platform's* own industry does not contradict it.

### What the code gates on

`connectFieldsFromAccount` reads exactly two things off the Stripe account:

```
payouts_enabled === true                → status "ready"
requirements.disabled_reason present    → status "restricted"
otherwise                               → status "pending"
```

`requirements.currently_due` is stored and shown to the driver but **never
blocks anything**, and `charges_enabled` / `capabilities` are never read for
drivers at all. So a connected account is "working" the moment
`payouts_enabled` flips true, regardless of what else is outstanding.

---

## 3. Webhooks

Stripe signs platform events and connected-account events **separately**, so
this needs two endpoints per mode. Four in total, plus one sandbox-only Identity
endpoint.

### Live mode → the LIVE function

Base URL: `https://api-qsxtpust2a-uc.a.run.app`

| # | Endpoint | Listen to | Events | Signing secret → |
|---|---|---|---|---|
| 1 | `/stripe/webhook` | **Events on your account** | `charge.dispute.created`<br>`charge.dispute.closed`<br>`charge.refunded`<br>`payment_intent.payment_failed`<br>*(optional)* `payout.failed` | `STRIPE_WEBHOOK_SECRET` |
| 2 | `/stripe/connect-webhook` | **Events on connected accounts** | `account.updated`<br>**`payout.failed`** | `STRIPE_CONNECT_WEBHOOK_SECRET` |

### Test mode → the SANDBOX function

Base URL: `https://us-central1-unilift-6e756.cloudfunctions.net/apiSandbox`

| # | Endpoint | Listen to | Events | Signing secret → |
|---|---|---|---|---|
| 3 | `/stripe/webhook` | Events on your account | same four as #1 | `STRIPE_WEBHOOK_SECRET` |
| 4 | `/stripe/connect-webhook` | Events on connected accounts | `account.updated`, `payout.failed` | `STRIPE_CONNECT_WEBHOOK_SECRET` |
| 5 | `/stripe/identity-webhook` | Events on your account | `identity.verification_session.verified` | `STRIPE_IDENTITY_WEBHOOK_SECRET` |

Secrets for #1 and #2 go in `functions/.env`; #3, #4 and #5 in
`functions-sandbox/.env`. All five are `whsec_…`.

### `payout.failed` belongs on the Connect endpoint

This is the one that is easy to get wrong, and it is invisible when you do.

`handlePayoutFailed` identifies the driver by querying
`users where stripeConnectAccountId == event.account`. Stripe only populates
`event.account` on **connected-account** events. Subscribed only on the platform
endpoint, the handler matches nobody and returns silently — a driver whose bank
rejects a payout is simply never told.

Both endpoints call the same function, so subscribing it on the platform
endpoint as well is harmless and mildly useful: there it logs the *platform's
own* failed bank payouts and pushes nothing.

### Which events do what

| Event | Handled by | Effect |
|---|---|---|
| `account.updated` | connect-webhook | Writes the six `stripeConnect*` fields; pushes "Payouts enabled" on the transition. **This is what makes a driver payable.** |
| `payout.failed` | connect-webhook | Pushes "Payout returned" to the driver whose bank rejected it. |
| `charge.dispute.created` | webhook | Sets `disputeOpen`, records a `dispute` ledger row. **Freezes both booking and payouts** for that user. |
| `charge.dispute.closed` | webhook | Clears `disputeOpen` only if `status === "won"`. |
| `charge.refunded` | webhook | Records a `refund` row with `mode: "dashboard"`. **Counters are not adjusted** — a dashboard refund carries no ride id, so there is no way to know whose earnings to reverse. Use `POST /billing/refund` instead. |
| `payment_intent.payment_failed` | webhook | Stamps `lastSettlementFailedAt`; pushes "Payment declined". |
| `identity.verification_session.verified` | identity-webhook | Grants the `adult` certification. Sandbox only. |

Anything else you subscribe is acknowledged and ignored — the handlers have a
`default` branch precisely so Stripe stops retrying rather than treating an
unhandled type as an outage.

### Never cross the modes

Webhooks carry no `X-App-Env` header, so the LIVE function resolves them
unconditionally to the production database and the live Stripe keys. A test-mode
endpoint pointed at the live function fails signature verification (400) and
writes nothing — annoying but safe. A **live-mode endpoint pointed at the sandbox
would write production state into the dev database**. Check the mode toggle
before saving each endpoint.

### If the endpoint URL ever changes

`https://api-qsxtpust2a-uc.a.run.app` is a gen-2 Cloud Run hash. If
`firebase functions:list` ever shows a different URL for `api`, update **both**
the Stripe endpoints and `PUBLIC_BASE_URL` in `functions/index.js:71` — it is
also the bounce URL Stripe returns to after Connect onboarding.

---

## 4. Radar

Settlement charges are created `confirm: true, off_session: true`. **Any Radar
rule that requests 3-D Secure turns them into `requires_action`**, which the code
treats as a failure: the counters roll forward untouched and the passenger gets a
"payment declined" push for a card that was never actually declined.

- Review Radar for rules that request 3DS, and exclude off-session traffic.
- Put strict checks on the **SetupIntent** (card-add) path instead — that is
  interactive, so a challenge can actually be answered.

---

## 5. Keys and secrets

| Stripe dashboard | `functions/.env` (live server) | `functions-sandbox/.env` |
|---|---|---|
| Live secret key | `STRIPE_SECRET_KEY_LIVE` | — |
| Live publishable key | `STRIPE_PUBLISHABLE_KEY_LIVE` | — |
| Test secret key | `STRIPE_SECRET_KEY_TEST` | `STRIPE_SECRET_KEY_TEST` |
| Test publishable key | `STRIPE_PUBLISHABLE_KEY_TEST` | `STRIPE_PUBLISHABLE_KEY_TEST` |
| Endpoint #1 / #3 secret | `STRIPE_WEBHOOK_SECRET` | `STRIPE_WEBHOOK_SECRET` |
| Endpoint #2 / #4 secret | `STRIPE_CONNECT_WEBHOOK_SECRET` | `STRIPE_CONNECT_WEBHOOK_SECRET` |
| Endpoint #5 secret | — | `STRIPE_IDENTITY_WEBHOOK_SECRET` |

The LIVE server requires **both** the live and test pairs at boot and throws if
either is missing, so a missing key fails the deploy rather than a request.

Publishable keys are also committed in `eas.json` and served unauthenticated by
`GET /config` — that is fine, they are public by design, and the app prefers the
server's value so the client key can never drift from the secret key in use.

### Known gaps to close

- **`functions-sandbox/.env` has neither webhook secret**, so endpoints #3 and #4
  return `500 not_configured` and the Connect flow cannot be rehearsed in test
  mode at all. Create them and fill both in.
- **`functions-sandbox/.env` has an empty `BILLING_SECRET`.** It fails closed
  (403), which is safe, but it blocks the manual `settle-monthly` /
  `queue-payouts` / `run-payouts` triggers used for rehearsal. Set it.

---

## 6. Verifying it

**Start here.** The dashboard tells you about the account you logged into; it
cannot tell you which key `functions/.env` is actually holding, and a stale or
accidentally test-mode `STRIPE_SECRET_KEY_LIVE` fails in exactly the same way as
"Connect not enabled":

```bash
npm run probe:connect              # LIVE server
npm run probe:connect -- --sandbox # SANDBOX server
```

It is read-only — no account, no link, no charge — and reports the platform
account and its capabilities, whether Connect is enabled **on that key**, the
key's `livemode`, and whether a **CAD balance exists**. A green board here is the
precondition for everything else.

Then, in order:

1. **Payout schedule** — not visible to the probe. Check it directly at
   Connect → Settings → Payouts, and again on a test driver's Express dashboard
   after onboarding. This is the one that silently strands money.
2. **Each endpoint** — send a test event from the dashboard, confirm a `200`.
3. **`account.updated` for real** — complete Connect onboarding in test mode and
   confirm `users/{uid}.stripeConnectPayoutsEnabled` flips to `true`.
4. **`payout.failed` end to end** — onboard a test account with a bank number
   Stripe rejects on payout, run the sweeper, confirm the driver gets the
   "Payout returned" push. This path has never fired in production.
5. **Full money rehearsal on sandbox**, once §5's gaps are closed:
   ```bash
   curl -X POST $SANDBOX/billing/settle-monthly -H "x-billing-secret: $SECRET" …
   curl -X POST $SANDBOX/billing/queue-payouts  -H "x-billing-secret: $SECRET" …
   curl -X POST $SANDBOX/billing/run-payouts    -H "x-billing-secret: $SECRET" …
   ```
   `queue-payouts` is safe to re-run — a driver with a row already in flight is
   skipped.

**Do not do any of this near the 1st or the 5th.** `monthlyBilling` charges every
card at 03:00 ET on the 1st and `monthlyDriverPayouts` queues every payout at
03:00 ET on the 5th; the first supervised production run of either should be
deliberate, not incidental.
