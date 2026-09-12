# Backend cutover checklist — v1.3.x payout-rail release

Everything that must happen **by hand**, in order, before and around deploying the
LIVE server. The code changes are already in the working tree; nothing has been
pushed or deployed.

> **Superseded by the audit release.** This document covers the payout-rail cutover.
> The same release now also carries the pre-launch security audit — see
> `docs/security-audit.md` for the findings and what changed. The published
> checklist at the artifact URL is the current, complete version; this file is kept
> for the payout-rail detail it carries.

What this release does to production, in one paragraph: the LIVE server gains the
Stripe Connect driver-payout rail (`/connect/*`, `/payouts/*`), its monthly
settlement stops writing ledger stubs and starts crediting a real cashable balance,
its scheduled jobs stop pointing at the dev database and start running against
production, and `firestore.rules` is replaced by the hardened ruleset. Three of
those four move real money or real data the first time they run.

---

## 0. Before you touch anything

- [ ] Read the diff. `git diff functions/index.js firestore.rules` is the whole
      surface area that reaches production.
- [ ] Confirm the new app binary is (or is about to be) the floor. The hardened
      rules deny ride writes that older App Store builds still make.
- [ ] Pick a window that is **not** near the 1st of the month — `monthlyBilling`
      fires at 03:00 ET on the 1st, and the first production run should be
      supervised, not incidental.

---

## 1. Stripe (live mode) — do this first, it gates everything else

- [ ] **Enable Connect** on the live-mode platform account.
      Dashboard → Connect → Get started. Choose **Express**, platform country
      **Canada**. Without this, `/connect/onboard` fails on the driver's first tap.
- [ ] Complete the **platform profile** Stripe asks for (business details, support
      contact, statement descriptor). Connect stays restricted until it is done.
- [ ] Confirm the platform can create **transfers** in `cad`. Balance → check the
      CAD balance exists. The sweeper reads `balance.available` and pays nothing if
      there is no CAD entry.
- [ ] **Create the Connect webhook.**
      - Endpoint: `https://api-qsxtpust2a-uc.a.run.app/stripe/connect-webhook`
      - Listen to: **Connect** events (not account events)
      - Event: `account.updated`
      - Copy the signing secret (`whsec_…`)
- [ ] Verify `unilift.ca` resolves and describes ridesharing. It is set as every
      driver's `business_profile.url` and is what a Stripe reviewer opens.

> The endpoint URL above is a gen-2 Cloud Run hash. If `firebase functions:list`
> ever shows a different URL for `api`, update **both** the Stripe endpoint and
> `PUBLIC_BASE_URL` in `functions/index.js:69`.

---

## 2. Secrets

- [ ] Put the signing secret from §1 into `functions/.env`:
      `STRIPE_CONNECT_WEBHOOK_SECRET=whsec_…`
      (a documented placeholder is already there, empty)
- [ ] **Create a server-side Google Maps key** and set `GOOGLE_MAPS_SERVER_KEY` in
      `functions/.env`. API restriction: Directions, Geocoding, Places only.
      Application restriction: IP addresses. Keep it separate from the native SDK
      key in `app.config.js`.
- [ ] **Rotate the old Maps key** — it shipped inside every existing build and is
      extractable. Restrict the old one to the native SDKs by bundle id / package
      name, and set per-API daily quotas plus a billing alert.
- [ ] Re-confirm the other five are still set and are **live** values where they
      should be: `STRIPE_SECRET_KEY_LIVE`, `STRIPE_PUBLISHABLE_KEY_LIVE`,
      `STRIPE_SECRET_KEY_TEST`, `STRIPE_PUBLISHABLE_KEY_TEST`, `BILLING_SECRET`.
- [ ] `functions/.env` is gitignored. Confirm `git status` does not list it.

Optional, but it makes rehearsal possible:

- [ ] Add a **test-mode** Connect webhook pointing at
      `https://us-central1-unilift-6e756.cloudfunctions.net/apiSandbox/stripe/connect-webhook`
      and put its secret in `functions-sandbox/.env` as
      `STRIPE_CONNECT_WEBHOOK_SECRET`. Neither codebase has this set today, so the
      sandbox webhook currently 500s `not_configured`.

---

## 3. Firestore indexes — deploy these BEFORE the server

The `payouts` composite indexes have never been deployed to `uniliftdefault`.
Without them the sweeper throws `The query requires an index` on its first run and
`monthlyDriverPayouts` cannot find whether a driver already has a row in flight.

```bash
firebase deploy --only firestore:uniliftdefault:indexes
```

- [ ] Run it.
- [ ] Wait for all three indexes to reach **Enabled** in the console (Firestore →
      Indexes → database `uniliftdefault`). Building is not enough.
      - `payouts`: `status` ASC, `createdAt` ASC
      - `payouts`: `uid` ASC, `status` ASC
      - `rides`: `driverId` ASC, `status` ASC  *(new — the account-deletion
        active-ride check)*

### 3b. Backfill public profiles — BEFORE deploying the rules

`users/{uid}` becomes owner-only in this release; what other people see moves to
`users/{uid}/public/profile`, written by the new `mirrorPublicProfile` trigger. That
trigger only fires when a user document is *written*, so existing accounts would have
no public profile and would render as blank cards everywhere.

```bash
firebase deploy --only functions:live      # the trigger must exist first
node functions/scripts/backfill-public-profiles.js --db uniliftdefault --dry
node functions/scripts/backfill-public-profiles.js --db uniliftdefault
```

- [ ] Deploy `functions:live` first, so the trigger exists.
- [ ] Dry run; sanity-check the user count.
- [ ] Run it for real; spot-check a few `users/{uid}/public/profile` docs.
- [ ] **Only then** deploy the rules. This is the one place in the release where
      rules go *after* the server, not before.

---

## 4. Production data audit — the ride backlog

**This is the item most likely to cause an incident.** `sweepStaleRides` has never
run against `uniliftdefault`. The moment it does, every stale ride and request in
the entire production history is expired **and every affected passenger is pushed**.

Query these in the console (database `uniliftdefault`) before deploying:

| Collection | Filter | What the sweep will do |
|---|---|---|
| `rideRequests` | `status == "open"`, older than 15 min | → `expired` + push `request_expired` to the passenger |
| `rides` | `status == "planned"`, older than 30 min | → `expired`, clear passengers, push **all** of them |
| `rides` | `status == "started"`, older than 3 h | → `expired`, no push |
| `rides` | `status == "planned"` with non-empty `pendingConfirmation` | tear down the match, re-open the request, push `match_expired` |

- [ ] Count the documents in each bucket.
- [ ] If the total is more than a handful, **clean them up manually first** (set
      them to `expired` with the admin SDK / console, which sends no push), then
      deploy. A one-time push storm to your entire user base is a worse first
      impression than a few minutes of manual cleanup.
- [ ] Sanity-check `config/broadcast` in `uniliftdefault`: absent or
      `{ prodEnabled: true }` is normal. Setting `{ prodEnabled: false }`
      temporarily is a blunt way to silence dispatch broadcasts during the deploy,
      but it does **not** silence the sweep's pushes.

---

## 5. Production data audit — money

- [ ] **`config/pricing` in `uniliftdefault`.** Confirm it exists and that any
      field it sets is intentional. Missing fields fall back to `DEFAULT_PRICING`
      in `functions/index.js`, which is correct — so an absent doc is fine, a
      *wrong* doc is not. Check `minPayoutCents` (2500) and `payoutReserveBps`
      (must stay **0** until you deliberately raise it).
- [ ] **Orphaned `monthly_payout` rows.** Previous settlements wrote
      `users/{uid}/transactions` entries of type `monthly_payout` with
      `status: "pending"`. Nothing drains those any more — the new model uses
      `availableEarningsCents` + the `payouts` queue. Decide per row: mark them
      `status: "cancelled"`, or credit the amount into the driver's
      `availableEarningsCents` so they actually get paid. Do **not** leave them
      `pending` — the wallet renders them as money owed that will never arrive.
      Collection-group query: `transactions where type == "monthly_payout" and
      status == "pending"`.
- [ ] **Outstanding `pendingChargeCents`.** The first `monthlyBilling` run will
      charge every one of these off-session. Eyeball the list and the totals now,
      not on the 1st.
- [ ] No backfill is needed for `availableEarningsCents`. Absent reads as zero.
      `cashoutEligibleSince` is legacy — it fed the dormancy sweep that automatic
      monthly payouts replaced, and nothing reads it any more.

---

## 6. Deploy — order matters

Servers before the client, so the guards are live before any build can hit them.
**Never run a bare `firebase deploy --only functions`** — it deploys both codebases.

```bash
# 1. Lint both (also runs as a predeploy hook)
npm --prefix functions run lint
npm --prefix functions-sandbox run lint
npm run check                    # lint + jest + server-drift

# 2. Rules + indexes
firebase deploy --only firestore:uniliftdefault

# 3. LIVE functions
firebase deploy --only functions:live

# 4. Sandbox, only if you also changed it
firebase deploy --only functions:sandbox
```

- [ ] Step 2 first. The rules must be in place before the server starts assuming
      clients cannot write rides.
- [ ] Step 3 will create a **new scheduled function**, `payoutPendingEarnings`.
      Confirm Cloud Scheduler accepted it: `firebase functions:list`.
- [ ] Confirm the `api` URL did not change:
      `curl -s https://api-qsxtpust2a-uc.a.run.app/hello` → `{"status":"ok"}`
      (the health route is `/hello`, **not** `/health`).

---

## 7. Post-deploy smoke tests

Do these with a **real test account on a real device** against the production build.

- [ ] `GET /hello` returns ok (above).
- [ ] `GET /config` returns the **live** publishable key (`pk_live_…`).
- [ ] Wallet loads: `/wallet/setup` returns a `connect` block with
      `status: "none"` for a driver who has never onboarded.
- [ ] `/payouts/summary` returns `canCashout: false`,
      `reason: "payouts_not_enabled"`, `minPayoutCents: 2500`.
- [ ] Tap **Set up payouts** → Stripe Express onboarding opens → complete it →
      the browser closes and returns to the app.
      *(This is the step that fails loudly if §1 was skipped.)*
- [ ] The `account.updated` webhook fired: check Stripe → Webhooks → delivery log
      for a 200, and the user doc now has `stripeConnectPayoutsEnabled: true`.
      Then confirm the "Payouts enabled" push arrived.
- [ ] `POST /connect/dashboard` opens the Express dashboard.
- [ ] `POST /connect/disconnect` on an account with no queued payout succeeds and
      clears the fields.
- [ ] Run one real ride end to end and confirm the driver's
      `pendingEarningsCents` moves.
- [ ] **Supervised settlement dry run**, with one seeded test user only:
      ```bash
      curl -X POST https://api-qsxtpust2a-uc.a.run.app/billing/settle-monthly \
        -H "Authorization: Bearer <idToken>" \
        -H "x-billing-secret: $BILLING_SECRET"
      ```
      Expect `earnings_available` for the driver and a matching
      `availableEarningsCents`.
- [ ] **Supervised payout dry run:**
      ```bash
      curl -X POST https://api-qsxtpust2a-uc.a.run.app/billing/run-payouts \
        -H "Authorization: Bearer <idToken>" \
        -H "x-billing-secret: $BILLING_SECRET"
      ```
      A tally of `{ paid, awaitingSetup, insufficient, failed, skipped }`.
      `insufficient` on the first run is **normal** — card charges take 2–7 days to
      become `available` in the Stripe balance, which is exactly why the sweeper is
      daily rather than monthly.
- [ ] Cash out from the app once, end to end, and watch the money reach a real
      test bank account.
- [ ] Watch the logs for the first 24 h:
      ```bash
      firebase functions:log --only api
      firebase functions:log --only sweepStaleRides
      firebase functions:log --only payoutPendingEarnings
      ```
      Each scheduled job now logs a JSON summary of what it did.

---

## 8. Rollback

Each piece reverts independently — you do not have to undo the whole release.

| Symptom | Fastest fix |
|---|---|
| Sweep is push-storming | `SCHEDULED_JOBS_PAUSED = true` in `functions/index.js`, redeploy `functions:live`. Fastest kill switch for all three jobs. |
| Payouts misbehaving, rides fine | Leave the jobs on; the sweeper is idempotent per row. Investigate with `/billing/run-payouts` rather than waiting for 04:00. |
| Rules broke a client flow | Redeploy the previous `firestore.rules` from git: `git show HEAD:firestore.rules > firestore.rules && firebase deploy --only firestore:uniliftdefault:rules`. Takes seconds and needs no function redeploy. |
| Connect is not ready after all | Nothing to roll back on the server — the routes simply error on tap. Fix §1 and the same code works. |
| Dispatch reaching the wrong people | `config/broadcast` → `{ prodEnabled: false }` in `uniliftdefault`. Live within ~60 s, no redeploy, reaches phones already installed. |

- [ ] Before deploying, note the current LIVE function revision so you can roll
      back to it: `gcloud functions describe api --region us-central1`.

---

## 9. Known gaps shipped with this release

Neither is a regression — both predate it — but a live payout rail changes how
much they matter.

- **`/account/delete` does not delete the driver's Stripe Connect account.**
  Deleting a UniLift account now leaves an orphaned Express account at Stripe
  holding that person's bank details and SIN. That is a Loi 25 exposure and it
  gets worse with every driver who onboards. Roughly a 15-line fix
  (`stripe.accounts.del` next to the existing customer deletion, with the same
  `balance_not_zero` handling as `/connect/disconnect`).
- **`/account/delete` does not settle outstanding balances** before deletion, so a
  user with a positive `pendingChargeCents` can delete their way out of it.

---

## 10. What is deliberately NOT in this release

- **Certification** (`/cert/*`, `/stripe/identity-webhook`) stays sandbox-only, as
  you asked. Safe because `services/certificationService.ts` returns
  `unavailable` on every call when `isDev` is false — a production build never
  reaches those routes.
  `firestore.rules` **does** now block client writes to `certifications`, ahead of
  the feature, so nobody can forge a Student or 18+ badge in production.
- **The `/dev/*` harness** stays sandbox-only and always will.
- **`payoutReserveBps` stays 0.** Raising it to the eventual 400 (4%) is a pricing
  change, not part of this port, and must not happen until `config/pricing` carries
  the field in both databases.
