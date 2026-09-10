# The Dev Server (`functions-sandbox/`) — how it works, and how it lives in Firebase

Reference documentation for UniLift's **dev/sandbox backend**: the Cloud Functions
codebase at [functions-sandbox/index.js](../functions-sandbox/index.js) (~3 230 lines,
one monolithic file) that every **dev build** of the app talks to.

Scope note: this document covers the *sandbox* server. The frozen production server
in [functions/](../functions/) is described only where the two differ. For a
bird's-eye view of the whole repo, read [docs/codebase-map.md](codebase-map.md)
first; this file is the deep dive on deployable #3.

---

## 1. The three deployables

| # | Name | Source | Firebase codebase | Entry point | Data it touches |
|---|---|---|---|---|---|
| 1 | Expo app | repo root | — | `app/_layout.tsx` | whichever env it declares |
| 2 | **LIVE server** | `functions/` | `live` | `exports.api` | `uniliftdefault` **and** `uniliftdev` (per-request) |
| 3 | **SANDBOX server (dev)** | `functions-sandbox/` | `sandbox` | `exports.apiSandbox` | `uniliftdev` **only** |

They are **near-duplicates, not a shared library.** There is no common package;
`functions-sandbox/index.js` began as a copy of `functions/index.js` and the two
have drifted deliberately. Any change to a shared route must be made **twice**.

Why the split exists: `functions/` is frozen at whatever the last App Store binary
expects. New features land in `functions-sandbox/` where they cannot break a
shipped build, and get ported to `functions/` at cutover.

**The one-line summary of the pinning:** the LIVE server chooses its database
per-request from an `X-App-Env` header; the SANDBOX server has no choice to make —
it is hardwired to dev at module scope and ignores that header entirely.

---

## 2. How it lives in Firebase

### 2.1 The project

One Firebase project, `unilift-6e756` ([.firebaserc](../.firebaserc)), holding:

- **Two named Firestore databases** — `uniliftdefault` (prod) and `uniliftdev` (dev).
  Note that *neither* is the `(default)` database; both are explicitly named.
- **One shared Firebase Auth tenant.** This matters enormously — see §8.
- **One Cloud Storage bucket**, shared.
- **Two Cloud Functions codebases**, `live` and `sandbox`.

[firebase.json](../firebase.json) is what wires the two codebases and the two rule
files to that single project:

```jsonc
"firestore": [
  { "database": "uniliftdefault", "rules": "firestore.rules" },
  { "database": "uniliftdev",     "rules": "firestore.dev.rules" }
],
"functions": [
  { "source": "functions",         "codebase": "live"    },
  { "source": "functions-sandbox", "codebase": "sandbox" }
]
```

Because two codebases share one project, **a bare `firebase deploy --only functions`
deploys both.** Always scope it (§13).

### 2.2 What the sandbox codebase exports

Four Cloud Functions, all in `us-central1`, Node 20 runtime:

| Export | Type | Generation | Trigger |
|---|---|---|---|
| `apiSandbox` | `functions.https.onRequest(app)` | **gen 1** | HTTPS — the whole Express API |
| `getAdminMetricsSandbox` | `functions.https.onCall` | **gen 1** | Callable from the app (admin claim required) |
| `sweepStaleRidesSandbox` | `onSchedule` (v2) | **gen 2** | Cloud Scheduler, every 5 minutes |
| `monthlyBillingSandbox` | `onSchedule` (v2) | **gen 2** | Cloud Scheduler, 1st of month 03:00 ET |

The gen 1 / gen 2 mix is intentional and load-bearing for the URL:

```
https://us-central1-unilift-6e756.cloudfunctions.net/apiSandbox
```

Gen 1 HTTPS functions are always reachable at that deterministic
`{region}-{project}.cloudfunctions.net/{name}` address. Gen 2 functions get a
Cloud Run URL with a random hash assigned on first deploy — which is exactly why
the LIVE base URL is the opaque `https://api-qsxtpust2a-uc.a.run.app`. Keeping
`apiSandbox` on gen 1 means the sandbox URL can be hardcoded in `eas.json`, in
`constants/runtime-config.ts`, and in the Stripe webhook + certification link
builders without waiting for a deploy to learn it.

### 2.3 How the app chooses this server

[constants/runtime-config.ts](../constants/runtime-config.ts) resolves it:

```
apiBaseUrl = EXPO_PUBLIC_API_BASE_URL
           ?? (isDev ? SANDBOX_API_BASE_URL : LIVE_API_BASE_URL)
```

`isDev` comes from `EXPO_PUBLIC_APP_ENV`, which **must be declared** as exactly
`dev` or `production`. A missing or misspelled value throws at import time rather
than defaulting — the old "absence means production" behaviour meant any config
slip silently pointed a test build at real user data.

`eas.json` sets `EXPO_PUBLIC_API_BASE_URL` explicitly on every profile, so the
fallback above is really only exercised by local `expo start` runs.

| EAS profile | `APP_ENV` | Server | Database | Stripe |
|---|---|---|---|---|
| `development` | `dev` | sandbox | `uniliftdev` | test |
| `preview` | `production` | live | `uniliftdefault` | live |
| `production` | `production` | live | `uniliftdefault` | live |

`apiFetch()` adds an `X-App-Env: dev` header on dev builds. **The sandbox server
ignores it** — it is kept only as a harmless belt-and-suspenders signal, since the
separate URL already does the routing.

---

## 3. Boot sequence and the dev pinning

[functions-sandbox/index.js:1-42](../functions-sandbox/index.js#L1-L42) is where
the whole security model of this codebase is established, at module scope, before
any request is served:

```js
require("dotenv").config();

// Hard-throw at boot (⇒ deploy fails) if the TEST Stripe pair is absent.
if (!process.env.STRIPE_SECRET_KEY_TEST || !process.env.STRIPE_PUBLISHABLE_KEY_TEST) {
  throw new Error("Missing STRIPE_SECRET_KEY_TEST / STRIPE_PUBLISHABLE_KEY_TEST …");
}

admin.initializeApp();
const devDb     = getFirestore("uniliftdev");        // the ONLY database handle
const stripeTest = require("stripe")(process.env.STRIPE_SECRET_KEY_TEST);

const TARGET_DB     = devDb;      // scheduled jobs
const TARGET_STRIPE = stripeTest;

const getDb     = () => devDb;    // note: ignores its `req` argument
const getStripe = () => stripeTest;
```

Four consequences worth internalising:

1. **There is no live handle in this file.** Not a live Firestore handle, not a
   live Stripe client, not a live key in `.env`. A bug in a route cannot reach
   production data, because the reference does not exist in the process.
2. **`getDb(req)` takes a `req` it never reads.** The signature is preserved so
   route bodies stay diff-able against `functions/index.js`, where the same call
   really does switch on the header.
3. **The boot guard fails the deploy, not a request.** A missing Stripe test key
   surfaces at `firebase deploy` time (predeploy container build), not as a
   500 three days later.
4. **The scheduled jobs are pinned too.** `sweepStaleRidesSandbox` and
   `monthlyBillingSandbox` run against `TARGET_DB`, so no cron in this codebase
   can ever mutate live production data or move real money.

### Request pipeline

```js
const app = express();
app.use(express.json({ verify: (req, _res, buf) => { req.rawBody = buf; } }));
```

The `verify` hook stashes the **raw bytes** alongside the parsed body. Only
`POST /stripe/identity-webhook` uses `req.rawBody` — Stripe signs the exact byte
sequence, so verifying against the re-serialised `req.body` would fail. Every
other route uses the parsed `req.body` normally.

### `authenticate` middleware

[index.js:44-57](../functions-sandbox/index.js#L44-L57). Every route except
`/hello`, `/config`, `/cert/adult/return`, `/cert/student/confirm` and
`/stripe/identity-webhook` is wrapped in it:

```
Authorization: Bearer <Firebase ID token>
  → admin.auth().verifyIdToken(token)
  → req.uid = decoded.uid
  → 401 { error: "Unauthorized" | "Invalid token" } on failure
```

`req.uid` is the **only** identity any route trusts. No route accepts a
caller-supplied user id for authorization purposes.

---

## 4. Route reference

45 routes. The 30 shared with LIVE are marked ⚖; the 15 sandbox-only ones are
marked ★.

### 4.1 Health & config

| Route | Auth | Notes |
|---|---|---|
| `GET /hello` ⚖ | — | `{ status: "ok" }`. **The health check is `/hello`, not `/health`** — [docs/terminal-commands.md:253-254](terminal-commands.md) documents `/health`, which 404s. |
| `GET /config` ⚖ | — | Returns `{ stripePublishableKey, env: "development" }`. The app fetches this at startup so the client's publishable key always matches the server's secret key. Publishable keys are public by design, hence no auth. |

### 4.2 Wallet & payments ⚖

All five back [services/walletService.ts](../services/walletService.ts) and
[services/paymentService.ts](../services/paymentService.ts).

| Route | What it does |
|---|---|
| `POST /wallet/setup` | Gets/creates the Stripe customer, mints an ephemeral key, returns `pendingChargeCents`, `pendingEarningsCents`, and the saved card. |
| `POST /wallet/setup-payment-method` | Creates a SetupIntent with `payment_method_types: ["card"]` + `usage: "off_session"`. **Deliberately not `automatic_payment_methods`** — that makes the intent depend on per-mode Dashboard toggles and produces the "this payment method isn't enabled in your settings" error. Off-session reuse is required for monthly billing. |
| `POST /wallet/confirm-payment-method` | Verifies the SetupIntent succeeded, sets the card as the customer's default, mirrors `stripePaymentMethodId/Last4/Brand` onto `users/{uid}`. |
| `POST /wallet/remove-payment-method` | Detaches in Stripe, deletes the three mirror fields. |
| `GET /wallet/transactions` | Last 50 docs from `users/{uid}/transactions`, newest first. |

`getOrCreateCustomer()` ([index.js:257-283](../functions-sandbox/index.js#L257-L283))
is self-healing: if the stored `stripeCustomerId` no longer resolves in Stripe (deleted
from the dashboard, or a test-mode/live-mode mismatch), it wipes the stale id and
payment-method mirror fields and creates a fresh customer rather than erroring.

### 4.3 Ride matching & dispatch ⚖

| Route | What it does |
|---|---|
| `POST /rides/can-join` | Gate: 403 `no_payment_method` unless `users/{uid}.stripePaymentMethodId` exists. |
| `POST /requests/dispatch` | Fan a passenger's `rideRequests/{id}` out to drivers by push. |
| `POST /drivers/available` | Count who *would* be reached, without sending. Shares the eligibility rule with dispatch so the number the passenger sees matches reality. |
| `POST /requests/accept` | A driver claims a request. Atomic first-wins. |

#### The matching algorithm is currently switched OFF

[index.js:1087](../functions-sandbox/index.js#L1087):

```js
const USE_LEGACY_MATCHING = false;
```

While `false`, dispatch **ignores proximity, availability windows and destination
entirely** and broadcasts to every eligible user — a full-collection scan of
`users`, intentionally simple and non-scalable, chosen for accessibility while the
user base is small. Flip it back to `true` to restore the two-phase proximity
algorithm, which is still present below the flag:

- **Phase 1a** — online `driverSessions`: live position within `DRIVER_PROXIMITY_KM`
  (15 km) of the pickup **and** destination within the driver's own match radius
  (`destinationRadiusKm`, default 10 km) of the passenger's destination.
- **Phase 1b** — Ride Mode availability windows: destination radius + an active
  window for today. No live-GPS gate, because there is no live fix for these drivers.
- **Phase 2 (fallback)** — if fewer than `MIN_DIRECTION_MATCHES` (3) drivers were
  heading that way, also notify every online driver within 15 km regardless of
  destination, plus every Drive Mode driver ignoring day/time windows.

Deduped by `driverId` via `notifiedDriverIds`, so a driver who is both online and
inside a Ride Mode window is pushed once. `rejectedDrivers` (passengers who swiped
left) are skipped. The claim into `notifiedDriverIds` happens *before* the await,
so concurrent phases cannot double-send.

**The flag must be kept in sync with `functions/index.js`.** The sandbox spent a
release without it while LIVE had it, which broke dev dispatch.

#### `POST /requests/accept` — the accept transaction

[index.js:1418-1640](../functions-sandbox/index.js#L1418-L1640). One Firestore
transaction that reads the request, verifies `status === "open"` (409
`request_not_open` if another driver won), then creates `rides/{new}` and flips the
request to `matched`.

Two driver flows are supported:

- **Flow B (live session)** — `driverSessions/{driverId}` exists with
  `status: "online"`. Seats, origin, destination, detour budget and route polyline
  all come from the session. Seats are decremented and the session auto-goes
  offline at zero.
- **Flow A (no session)** — the driver was reached by a broadcast push. The client
  supplies `originLat/originLng` (**required** — without it there is no pickup
  route to plot). The destination is **optional**: under broadcast dispatch the
  push carries no `driverDest*` keys, so requiring one made every broadcast accept
  fail; it falls back to the passenger's own dropoff, which is the correct
  semantic — the driver agreed to take *this* passenger where *they* are going.

Every refusal returns a machine-readable `reason` alongside the HTTP status
(`request_not_found`, `request_not_open`, `request_missing_origin`,
`missing_driver_origin`, `missing_destination`, `not_enough_seats`) so
"impossible to accept" is diagnosable without server logs.

The new ride is seeded with `pendingConfirmation: [passengerId]` and
`confirmDeadlineAt = now + CONFIRM_WINDOW_MS` (2 minutes) — the **mutual match**
gate. The passenger then gets a `driver_accepted` push.

### 4.4 Ride lifecycle ⚖ — server-authoritative

[index.js:1642-2228](../functions-sandbox/index.js#L1642-L2228). These endpoints
own **every** ride state transition. Clients cannot PATCH `rides/*` directly (§9);
they read the doc and call these. Each runs in a transaction, derives the caller's
role from the ride doc itself, and computes money server-side.

```
planned ──/rides/confirm-driver──▶ (pendingConfirmation empties)
   │                                          │
   │  /rides/reject-driver                    ▼
   │  /rides/leave                       /rides/start ──▶ started
   │  sweep: match expired                                   │
   ▼                                              /rides/qr ─┤
cancelled / expired                          /rides/board ───┤
                                           /rides/dropoff ───┤
                                           /rides/finish ────▶ completed
                                                               │
                                                     /rides/rate
```

| Route | Caller | Guard |
|---|---|---|
| `POST /rides/start` | driver | `status === "planned"`, ≥1 passenger, and **428 if `pendingConfirmation` is non-empty**. Passengers who joined a planned ride are never in that array and so never block start. |
| `POST /rides/qr` | driver | Mints a 16-byte nonce, 10-minute TTL, stored on the ride and returned base64-encoded as `{ rideId, driverUid, issuedAt, expiresAt, nonce }`. |
| `POST /rides/board` | passenger | Decodes the payload; validates ride match, driver match, nonce equality, expiry, membership, and no double-board — all inside one transaction. |
| `POST /rides/confirm-driver` | passenger | Swipe right. `pendingConfirmation` −= uid, `confirmedPassengers` += uid. |
| `POST /rides/reject-driver` | passenger | Swipe left. Removes them, restores the seat, cancels the ride if it empties, and re-opens the originating request with the driver added to `rejectedDrivers`. |
| `POST /rides/dropoff` | driver | See below. |
| `POST /rides/finish` | driver | Charges + credits + completes in **one** transaction. |
| `POST /rides/rate` | passenger | Weighted-average rating + XP, computed server-side, once per passenger. |
| `POST /rides/cancel` | driver | Any non-completed ride; pushes every affected passenger. |
| `POST /rides/leave` | passenger | Before boarding, `status === "planned"` only. Restores the seat, notifies the driver. |

#### The dropoff radius gate — the money-critical part

`evaluateDropoff()` ([index.js:1683-1712](../functions-sandbox/index.js#L1683-L1712))
is the single source of truth for "is this leg billable":

- It measures the **driver's device fix at the moment they tapped Drop off**
  (`driverLat`/`driverLng` in the body) against `dropoffReference()`.
- `ride.driverLocation` is a fallback for app builds predating that parameter —
  it is throttled telemetry that can be minutes stale, and a stationary driver
  stops emitting it entirely.
- `dropoffReference()` is the passenger's own `passengerDropoffs[pid]`, else the
  ride's `destinationCoords`. **Never the pickup** — falling back to the pickup
  (as it once did) meant dropping a passenger where you collected them scored as
  an in-range delivery and billed them.
- Threshold: `DROPOFF_CONFIRM_RADIUS_KM = 3`. **Mirrored in
  [constants/ride-geo.ts](../constants/ride-geo.ts) and in `functions/index.js` —
  change all three together.**
- **Fails closed**: anything unmeasurable is not billable.

The measured distance and the driver's fix are written onto the ride
(`dropoffDistanceKm.{pid}`, `dropoffDriverLocation.{pid}`) so the charge is
re-derivable — and disputable — after the fact.

`chargeablePassengers()` then re-derives the charge set at finish time as
**boarded ∩ dropped ∩ within-radius**, preferring the recorded distance over the
stored `confirmedDropoffPassengers` boolean.

> **History worth knowing:** the legacy `POST /rides/complete` charged whatever
> passenger ids the *client* put in `confirmedPassengerIds` — no boarded check, no
> dropped check, no radius check. It has been removed; all ride payment now flows
> through `/rides/finish`.

### 4.5 Billing ⚖

`POST /billing/settle-monthly`, plus two legacy aliases `charge-monthly` and
`payout-drivers` that now run the same handler.

Double-guarded: `authenticate` **and** an `x-billing-secret` header matching
`BILLING_SECRET`. If the env var is unset, all three routes always 403.

`settleAllUsers()` ([index.js:613-…](../functions-sandbox/index.js#L613)) nets each
user's two counters:

```
net = pendingEarningsCents − pendingChargeCents

net < 0  → they owe us  → one off-session PaymentIntent for |net|
                          idempotencyKey: monthly-settle-{uid}-{YYYY-MM}
net > 0  → we owe them  → "monthly_payout" ledger stub, status "pending"
                          (real payouts await Stripe Connect)
net == 0 → offset; both counters cleared, no ledger entry
```

This is what lets a driver wipe out their own ride debt by driving, and what the
wallet UI renders as one signed balance.

Two failure modes are handled carefully:

- **No card on file** → *both* counters are left untouched so the balance rolls
  into next month. Nothing is lost.
- **PaymentIntent not `succeeded`** → counters are left untouched. Zeroing
  earnings on a failed charge would silently confiscate money the driver is owed.

Because Firestore cannot OR across two fields in one query, the candidate set is
the union of `pendingChargeCents > 0` and `pendingEarningsCents > 0`.

### 4.6 Account deletion ⚖

`POST /account/delete` erases everything for `req.uid`, in this order:

1. Detach the Stripe payment method, delete the Stripe customer.
2. Delete `users/{uid}/transactions` in batches of 400.
3. Delete `users/{uid}`.
4. Delete the Firebase Auth account — **last**, because it invalidates the token.

The client must sign out on success; any subsequent token refresh will fail.

### 4.7 Social linking ⚖

| Route | Flow |
|---|---|
| `POST /social/link-facebook` / `unlink-facebook` | **Implicit** — the client already holds an access token; the server just validates it against the Graph API. No server secret, which is why Facebook is absent from `.env`. |
| `POST /social/link/:provider` / `unlink/:provider` | **Authorization-code** for `instagram`, `tiktok`, `spotify`. The client obtains a short-lived `code`; the server exchanges it using the provider *secret* (never shipped to the client) and reads the public profile. |

Provider quirks encoded in `SOCIAL_EXCHANGERS`:

- **Spotify** — confidential code flow, HTTP Basic auth, no PKCE.
- **TikTok** — code flow **with PKCE**; `codeVerifier` is required (400
  `missing_code_verifier` without it).
- **Instagram** — appends `#_` to the redirect; the server defensively strips it
  again even though the client should have.

All of them enforce **one social account → one user** (409 `already_linked`), and
store `{provider}Id` + a handle field on the user doc. A missing credential pair
fails only that provider, with `missing_config:<KEY>` at HTTP 500.

### 4.8 Certification ★ — sandbox-only

[index.js:2229-2511](../functions-sandbox/index.js#L2229-L2511). Certifications are
**stackable** strings on `users/{uid}.certifications`. Clients cannot write that
field (the dev rules block it); every tier is granted here by the admin SDK, only
after the server verifies the requirement.

#### Tier `adult` — Stripe Identity

```
app → POST /cert/adult/session { returnUrl }
        └─ creates a Stripe Identity verificationSession
           (type: document, require_matching_selfie: true)
           metadata.firebaseUid = req.uid
           return_url = <this function>/cert/adult/return?app=<deeplink>
        └─ remembers sessionId in certAdultSessions/{uid}
        └─ returns { url }  →  app opens it in a browser

user completes the check in Stripe's hosted flow

Stripe → GET  /cert/adult/return?app=…   302 → back into the app scheme
Stripe → POST /stripe/identity-webhook   (primary grant path)
app    → POST /cert/adult/reconcile      (fallback grant path)
```

Three details that each solve a real problem:

1. **The https bounce.** Stripe Identity rejects native deep links
   (`exp://`, `unilift://`) with "Not a valid URL". So Stripe is never handed the
   app link — it gets an https endpoint on this function that 302-redirects to the
   app scheme, which closes the in-app browser and resolves
   `openAuthSessionAsync` as success. The redirect target is validated against
   `^[a-z][a-z0-9+.-]*://` so it cannot become an open redirect.
2. **The webhook has no `authenticate`.** Trust comes from the Stripe signature,
   verified against `req.rawBody`. Missing `STRIPE_IDENTITY_WEBHOOK_SECRET` →
   500 `not_configured` and no Adult certification is ever granted. Bad signature
   → 400 `invalid_signature`.
3. **`/cert/adult/reconcile` exists because webhooks are not guaranteed.** The app
   calls it after returning from Stripe, so the grant still lands if the webhook is
   delayed, unreachable, or unconfigured. Both paths use `arrayUnion`, so they are
   idempotent with each other.

**Privacy:** UniLift stores only the boolean grant. Never the dob, name, or
document images — Stripe holds those. Age is computed from
`verified_outputs.dob` via `ageFromStripeDob()` and compared against
`ADULT_MIN_AGE = 18`.

> **Sandbox-specific leniency:** `/cert/adult/reconcile` grants on `age === null`.
> Stripe TEST mode often returns a null dob because the synthetic test document
> has no real birth date, and the flow has to be testable. A *real* dob is still
> enforced at 18+, so under-age rejection stays testable with a proper test
> document. **This branch must be removed when porting to `functions/`.**

#### Tier `student` — school-email magic link

```
POST /cert/student/request { schoolEmail }
  → domain must be in SCHOOL_EMAIL_DOMAINS
    (ulaval.ca, cegep-ste-foy.qc.ca, cegepgarneau.ca,
     clc.qc.ca, cegeplevis.ca, uqar.ca)
    — mirrors constants/certifications.ts, keep in sync
  → 32-byte random token → certEmailTokens/{token} { uid, schoolEmail, expiresAt +24h }
  → emails <base>/cert/student/confirm?token=…

GET /cert/student/confirm?token=…   (no auth — the unguessable token IS the credential)
  → grants "student", deletes the token, renders a small dark-themed HTML page
```

**SMTP is optional.** With no `SMTP_HOST`, the confirmation link is `console.log`ged
instead of emailed, so the flow stays fully testable in sandbox without a mail
provider. Grab the link from `firebase functions:log --only apiSandbox`.

`certEmailTokens` is `allow read, write: if false` in the rules — the token value is
a bearer credential and must not be enumerable or forgeable by any client.

### 4.9 The dev harness ★ — `/dev/*`, sandbox-only

[index.js:2512-2947](../functions-sandbox/index.js#L2512-L2947). These let **one
device** drive an entire ride end-to-end without a second phone, real GPS, or a
physical QR scan. Client counterparts: [services/devRideService.ts](../services/devRideService.ts)
and the Dev Ride Panel in [app/devToolsScreen.tsx](../app/devToolsScreen.tsx), both
gated on `isDev`.

Every one of them calls `assertDevEnv(db)`, which throws unless `db === devDb`.
That is belt-and-suspenders: the codebase has no other handle, and is reachable
only via the sandbox URL.

| Route | What it does |
|---|---|
| `POST /dev/dispatch-report` | **Read-only diagnostic.** Sends nothing. Lists every user with `wouldNotify` and, when false, the exact `skipReason` — reusing `isEligibleRecipient()` verbatim so the report can never drift from real behaviour. Headline field is `meWouldReceive`. |
| `POST /dev/seed-request` | Creates an open `rideRequests` doc for the caller, bypassing the GPS fix and the payment-method gate. Defaults to two fixed points — `46.7817,-71.2747` (≈ Université Laval) → `46.8139,-71.2080` (≈ Vieux-Québec) — so range logic is deterministic. That is **6.2 km apart**, comfortably outside the 3 km dropoff radius; the source comment saying "~2 km apart" is wrong. |
| `POST /dev/accept-as-bot` | Claims the request as the synthetic `dev-bot-driver`, so the **real** passenger listener (`findingDriverScreen`) fires and the passenger flow runs solo. |
| `POST /dev/start` | Starts the ride on the bot's behalf. |
| `POST /dev/auto-board` | Boards the caller without a camera scan. |
| `POST /dev/dropoff` | Drops a passenger on the bot's behalf. |
| `POST /dev/finish` | Ends + charges, reusing the exact `/rides/finish` math. Ledger entries are prefixed `[DEV]`. |
| `POST /dev/force-status` | Jumps a ride and/or its request to any branch — e.g. `paymentStatus: "processing"` (stuck-payment) or request `expired` (no-driver give-up). |
| `POST /dev/reset` | Expires every non-completed request/ride involving the caller, for a clean slate. |

Two design rules the harness deliberately follows:

- **`/dev/dropoff` has no `confirmed` override.** It runs the same
  `evaluateDropoff()` gate as the real route. It once took `confirmed` straight
  from the body (defaulting to `true`), which meant the harness never exercised
  the radius check and happily paid the driver for a passenger dropped anywhere.
  You pass `driverLat/driverLng` — where you are *pretending* the bot is — and the
  server decides.
- **`started` and `boarded` preconditions are enforced**, so the harness rehearses
  the real route rather than a laxer one.

`/dev/finish` also mirrors the driver's `transactions` entry, without which the
bot's `pendingEarningsCents` and its ledger diverge — making "was the driver paid?"
hard to assert when testing the radius gate.

### 4.10 Push relay ⚖

`POST /notifications/send { uid, title, body, data }` — a thin relay. Two things to
know: it does **not** apply `pushEnvMatches` (it is the raw send path), and unlike
LIVE it returns `{ success: <did Expo accept the ticket> }` rather than an
unconditional `true`.

---

## 5. Scheduled functions

### `sweepStaleRidesSandbox` — every 5 minutes, America/Toronto

Self-healing timeouts so no ride or request can wedge forever. Five passes:

| # | Condition | TTL | Action |
|---|---|---|---|
| 1 | `rideRequests.status == "open"` | 15 min | → `expired` + push `request_expired` |
| 2 | `rides.status == "planned"` never started | 30 min | → `expired`, clear passengers, push all |
| 3 | `rides.paymentStatus == "processing"` | 2 min | → `pending` (retryable) |
| 4 | `rides.status == "started"` | 3 h (`RIDE_LIVE_WINDOW_MS`) | → `expired` (abandoned) |
| 5 | `planned` with non-empty `pendingConfirmation` past `confirmDeadlineAt` | 2 min | tear down the match, restore seats, cancel if empty, **re-open the request**, push `match_expired` |

Pass 3 is vestigial: nothing writes `"processing"` any more (it was the non-atomic
lock held by the removed `/rides/complete`). It is marked with a `TODO` to delete
once no ride doc is stuck in it.

`RIDE_LIVE_WINDOW_MS` mirrors [utils/ride-lifecycle.ts](../utils/ride-lifecycle.ts).

`ageMs()` accepts a Firestore `Timestamp`, an ISO string, or a millisecond number —
necessary because some fields are written server-side (real Timestamps) and others
by the client through the REST API (ISO strings).

### `monthlyBillingSandbox` — `0 3 1 * *`, America/Toronto

Runs `settleAllUsers(TARGET_DB, TARGET_STRIPE)` — the same netted pass as
§4.5 — and logs a tally by status.

---

## 6. The callable: `getAdminMetricsSandbox`

`functions.https.onCall`, gated on the **`admin` custom claim** (set via
[functions-sandbox/scripts/set-admin-claims.js](../functions-sandbox/scripts/set-admin-claims.js)).
Unauthenticated → `unauthenticated`; non-admin → `permission-denied`.

Returns counts only — no PII, so it stays Loi 25-safe: `users`, `rides`, `events`,
`rideRequests`, `onlineDrivers`, `ridesLast7d`, `ridesLast30d`, `completedRides`,
`driveModeDrivers`, `gmvCents` (a `collectionGroup` sum over `ride_charge`
transactions), `totalAuthUsers` (paged `admin.auth().listUsers`).

**Each metric is isolated** in a try/catch returning `null`, so one failing query
(typically a missing composite index on `date`) yields a partial dashboard instead
of failing the whole call.

For production numbers the founder dashboard should call the LIVE `getAdminMetrics`;
this twin exists so dev metrics stay isolated.

---

## 7. Configuration read from Firestore (no redeploy needed)

Two documents in `uniliftdev` change server behaviour live. Both are cached
per-environment with a **~60 s TTL**, which makes them the only kill switches that
reach binaries already installed on phones.

### `config/pricing`

```js
const DEFAULT_PRICING = {
  passengerRateCentsPerKm: 25,
  driverRateCentsPerKm:    20,
  minimumChargeCents:      100,
  minimumDistanceKm:       0.5,
};
```

Each field is validated as a finite number > 0 before it overrides the default, and
a read failure falls back to defaults with a warning — charges never break.
Mirrors [constants/pricing.ts](../constants/pricing.ts). Seed with
[functions-sandbox/scripts/seed-pricing.js](../functions-sandbox/scripts/seed-pricing.js).

Driver earnings are derived as
`totalPassengerCents × (driverRateCentsPerKm / passengerRateCentsPerKm)` — i.e. the
platform keeps the 25→20 spread, 20 %.

### `config/broadcast`

Default-allow, so production works with no doc at all:

| Doc state | Effect |
|---|---|
| absent / empty | allowed, capped at `DEFAULT_MAX_RECIPIENTS` = 500 |
| `{ prodEnabled: false }` | kill switch — notifies nobody |
| `{ maxRecipients: N }` | custom cap |

**In dev the cap is `Infinity`** — dev is already bounded by the strict eligibility
rule of §8 and by how few accounts exist in `uniliftdev`.

---

## 8. Push isolation — the most important thing in this codebase

> The dev/prod split isolates **data**. It does **not** isolate **push delivery**.

Three facts combine into a real hazard:

1. An Expo push token identifies a **device installation**, and one EAS project
   serves every environment.
2. Both builds share the bundle id — so a token stored in `uniliftdev` rings
   whatever UniLift build is on that phone, possibly the App Store one.
3. **Firebase Auth is shared** (one project, two named databases), so a real person
   who once signed in against dev still has a `uniliftdev/users/{uid}` doc holding
   their live token.

That is how a dev ride test once paged real users.

The fix is `isEligibleRecipient()`
([index.js:149-183](../functions-sandbox/index.js#L149-L183)), which filters
**broadcasts** on which environment last registered the token — a field the client
rewrites on every authenticated launch, so it self-populates with no allowlist and
no migration. The rule is **deliberately asymmetric**:

| | Untagged token | `"dev"` token | `"production"` token | Age check |
|---|---|---|---|---|
| **Dev** (`uniliftdev`) | ✗ excluded | ✓ | ✗ | must be < **14 days** old |
| **Prod** (`uniliftdefault`) | ✓ allowed | ✗ excluded | ✓ | none |

- **Dev is strict.** Untagged cannot be *shown* to belong to a dev build, so it is
  excluded. The 14-day recency check catches a device that ran a dev build once and
  has since gone back to the store build — its stale `"dev"` tag would otherwise
  ring the production app.
- **Prod is permissive.** Untagged must keep working: every user already on the App
  Store predates tagging. Recency must *not* apply — someone who hasn't opened the
  app in a month is still a valid recipient.

Also gated on `driverModeEnabled !== false` (absent counts as ON).

### The looser rule for targeted sends

`pushEnvMatches(tokenEnv, db)` — used by `driver_accepted`, `ride_cancelled`,
`match_expired`, etc. **Untagged tokens pass here.** A targeted send answers an
action the user just took in this same environment; dropping it would break a
legitimate reply to a tester whose token predates tagging. Broadcasts get the
strict rule; 1:1 replies get this one.

### Delivery is verified, not assumed

`sendPushNotification()` inspects the response body, not just the status. Expo
answers **200 even when it rejects the message** —
`{ data: { status: "error", details: { error: "DeviceNotRegistered" } } }` — so a
device that silently stopped receiving pushes would otherwise be indistinguishable
from a healthy one. It never throws; callers treat a failure as "this driver wasn't
reached".

### Debugging "my phone doesn't buzz"

Long-press the **DEV** badge → *Dispatch diagnostics* → **Run dispatch report**
(`POST /dev/dispatch-report`). `meWouldReceive` is the headline answer and every
other account is listed with its exact skip reason. Remember you never receive your
*own* request, so an end-to-end push test needs a second account on a second device.

---

## 9. Relationship to Firestore security rules

[firestore.dev.rules](../firestore.dev.rules) is the other half of the
server-authoritative design — the server only *is* authoritative because the rules
make the direct client path impossible.

| Collection | Client access | Why |
|---|---|---|
| `users/{uid}` | read any signed-in; create/update own, **minus** financial fields and `certifications` | Money counters and certification grants are admin-SDK-only |
| `users/{uid}/transactions` | read own; **write: false** | Ledger is server-written |
| `rides/{id}` | read any signed-in; create/delete **false**; update only if you are the driver **and** the diff touches *only* `driverLocation` | Every state/money transition goes through a Cloud Function. The one exception is live GPS telemetry — high-frequency, not used for billing — so it stays a cheap direct write |
| `payouts/{id}` | **read, write: false** | The payout queue is server-only; the user-visible copy of each row is in `users/{uid}/transactions` |
| `rideRequests/{id}` | owner sees own; anyone sees `open`; matched driver sees theirs | Driver inbox needs the open set |
| `certEmailTokens/{token}` | **read, write: false** | The token is a bearer credential |
| `config/{doc}` | read signed-in; write admin-only | Pricing / broadcast rails |
| `driverSessions/{uid}` | own only | Live drive state |
| `events`, `sponsors` | read signed-in; write admin | |

Deploy rules per-database:

```bash
firebase deploy --only firestore:uniliftdev       # firestore.dev.rules
firebase deploy --only firestore:uniliftdefault   # firestore.rules
firebase deploy --only firestore                  # BOTH — usually not what you want
```

`firestore.rules` (prod) and `firestore.dev.rules` are now **identical apart from
their header comments** — the hardened ruleset was promoted to production at
cutover. Change one, change both.

---

## 10. Collections this server touches

| Collection | Written by | Purpose |
|---|---|---|
| `users/{uid}` | server + client (limited) | Profile, `stripeCustomerId`, `stripePaymentMethodId/Last4/Brand`, `pendingChargeCents`, `pendingEarningsCents`, `certifications[]`, `expoPushToken` + `expoPushTokenEnv` + `expoPushTokenUpdatedAt`, `driverModeEnabled`, `driverDays[]`, `driverAvailability[]`, social ids |
| `users/{uid}/transactions/{id}` | server only | `ride_charge`, `ride_earning`, `monthly_charge`, `monthly_payout` |
| `rides/{id}` | server (+ `driverLocation` by driver) | See §4.4 |
| `rideRequests/{id}` | client creates; server transitions | `open` → `matched` / `expired` |
| `driverSessions/{uid}` | client + server | Live drive; seats decremented on accept |
| `config/pricing`, `config/broadcast` | admin/console | §7 |
| `certEmailTokens/{token}` | server only ★ | Student magic links |
| `certAdultSessions/{uid}` | server only ★ | Stripe Identity session ids |
| `events`, `sponsors` | admin | Hype map / partnerships |

Key ride-doc fields the lifecycle depends on: `passengers[]`, `passengerSeats{}`,
`passengerPickups{}`, `passengerDropoffs{}`, `pendingConfirmation[]`,
`confirmedPassengers[]`, `confirmDeadlineAt`, `boardedPassengers[]`,
`droppedPassengers[]`, `confirmedDropoffPassengers[]`, `dropoffDistanceKm{}`,
`dropoffDriverLocation{}`, `pendingRatings[]`, `ratingsSubmitted[]`, `qrToken`,
`qrTokenExpiresAt`, `status`, `paymentStatus`, `requestId`.

---

## 11. Environment variables — `functions-sandbox/.env`

Loaded by `require("dotenv").config()` and **uploaded with the source** on deploy.
dotenv resolves relative to each codebase's own directory, which is why the sandbox
needs its own file. Never commit it (`functions-sandbox/.gitignore`).

| Var | Required | Effect if missing |
|---|---|---|
| `STRIPE_SECRET_KEY_TEST` | **yes** | **throws at boot — deploy fails** |
| `STRIPE_PUBLISHABLE_KEY_TEST` | **yes** | **throws at boot — deploy fails** |
| `BILLING_SECRET` | for billing | all three `/billing/*` routes always 403 |
| `STRIPE_IDENTITY_WEBHOOK_SECRET` | for adult cert | webhook 500s `not_configured`; Adult grants only via `/cert/adult/reconcile` |
| `STRIPE_CONNECT_WEBHOOK_SECRET` | for driver payouts | `/stripe/connect-webhook` 500s `not_configured`; Connect status still lands via `/connect/status` and the sweeper's self-heal, but the "payouts enabled" push never fires. **Not currently set in either codebase's `.env`.** |
| `SMTP_HOST/PORT/USER/PASS`, `CERT_FROM_EMAIL` | optional | confirmation link is logged instead of emailed |
| `SPOTIFY_CLIENT_ID/SECRET` | optional | `/social/link/spotify` → `missing_config:…` |
| `TIKTOK_CLIENT_KEY/SECRET` | optional | `/social/link/tiktok` → `missing_config:…` |
| `INSTAGRAM_APP_ID/SECRET` | optional | `/social/link/instagram` → `missing_config:…` |

There are intentionally **no live Stripe keys here**. Facebook has no entry — its
implicit flow needs no server secret.

Point the Stripe **test-mode** Identity webhook at:

```
https://us-central1-unilift-6e756.cloudfunctions.net/apiSandbox/stripe/identity-webhook
```

---

## 12. Sandbox vs LIVE — the actual diff

**Sandbox-only (15 routes)** — certifications and the dev harness, both awaiting
cutover:

```
POST /cert/adult/session      GET  /cert/adult/return
POST /cert/student/request    GET  /cert/student/confirm
POST /stripe/identity-webhook POST /cert/adult/reconcile
POST /dev/dispatch-report     POST /dev/seed-request
POST /dev/accept-as-bot       POST /dev/start
POST /dev/auto-board          POST /dev/dropoff
POST /dev/finish              POST /dev/force-status
POST /dev/reset
```

**No longer sandbox-only.** The Stripe Connect payout rail — `/connect/onboard`,
`/connect/return`, `/connect/status`, `/connect/dashboard`, `/connect/disconnect`,
`/stripe/connect-webhook`, `/payouts/summary`, `/payouts/cashout`,
`/billing/queue-payouts`, `/billing/run-payouts` — plus the
`monthlyDriverPayouts` enqueue and the `payoutPendingEarnings` sweeper were ported
to LIVE. (`/payouts/cashout` is a retired stub: payouts are automatic and monthly,
and it only answers `409` with the next run's date. See
[payments-and-settlement.md](payments-and-settlement.md).) They are shared routes now and `scripts/check-server-drift.sh` enforces
that. The client's [services/connectService.ts](../services/connectService.ts) is
**not** `isDev`-gated, so a production build calls them against LIVE; that is why
they had to cut over with the app release.

**Structural differences:**

| | LIVE (`functions/`) | SANDBOX (`functions-sandbox/`) |
|---|---|---|
| Export names | `api`, `getAdminMetrics`, `sweepStaleRides`, `monthlyBilling`, `payoutPendingEarnings` | same + `Sandbox` suffix |
| Databases | both, switched on `X-App-Env` | `uniliftdev` only, header ignored |
| Stripe | live **and** test pairs | test pair only |
| Scheduled jobs | `TARGET_DB = prodDb`, `TARGET_STRIPE = stripeLive`, **not paused** | `devDb` / `stripeTest`, paused |
| Deps | — | `+ nodemailer` |
| Lines | ~3 300 | ~4 000 |
| URL | `https://api-qsxtpust2a-uc.a.run.app` (gen 2 hash) | `…/cloudfunctions.net/apiSandbox` (gen 1, deterministic) |

**Behavioural drift in shared routes: none left.** The two honest-delivery fixes
that used to live only in the sandbox — `sendPushNotification` returning a real
boolean after inspecting the Expo ticket body, `pushToDriver` propagating it so
`notified` counts accepted tickets rather than attempts, and `/notifications/send`
returning `{ success: delivered }` — were ported to LIVE. Both servers now report
delivery the same way.

Verify with a plain diff; every remaining hunk should be one of: the dev/prod
pinning at the top of the file, an export name, a `devDb` vs `getDb(req)`
reference, a comment pointing at the *other* file, or a sandbox-only block
(`/cert/*`, `/dev/*`).

> An older note here claimed the sandbox `/drivers/available` carried an extra
> requirement marked `// PORT AT CUTOVER`. No such marker exists in either file.

**Verify the route tables still line up:**

```bash
diff <(grep -E '^app\.(get|post)\(' functions/index.js) \
     <(grep -E '^app\.(get|post)\(' functions-sandbox/index.js)
```

**Constants that must be changed in lockstep across three files:**

| Constant | Files |
|---|---|
| `DROPOFF_CONFIRM_RADIUS_KM` | `constants/ride-geo.ts`, `functions/index.js`, `functions-sandbox/index.js` |
| `USE_LEGACY_MATCHING` | both server files |
| `SCHOOL_EMAIL_DOMAINS` | `constants/certifications.ts`, sandbox |
| pricing defaults | `constants/pricing.ts`, both servers |
| `RIDE_LIVE_WINDOW_MS` | `utils/ride-lifecycle.ts`, both servers |
| `CONFIRM_WINDOW_MS` | both servers + the client countdown |

---

## 13. Operating it

### Deploy

Both codebases run `npm run lint` as a **predeploy hook** — a lint error blocks the
deploy.

```bash
npm --prefix functions-sandbox run lint          # check first
firebase deploy --only functions:sandbox         # all four sandbox functions
firebase deploy --only functions:sandbox:apiSandbox   # just the API
```

⚠️ **Never run a bare `firebase deploy --only functions`** — it touches both
codebases, including the frozen production server.

**Order matters:** deploy the **servers before the client**, so the guards are live
before any build that can trigger a dispatch.

```bash
firebase deploy --only functions:sandbox
firebase deploy --only functions:live
```

### Observe

```bash
firebase functions:log --only apiSandbox
firebase functions:log --only sweepStaleRidesSandbox
firebase functions:list
curl -s https://us-central1-unilift-6e756.cloudfunctions.net/apiSandbox/hello
```

### Local emulation

```bash
npm --prefix functions-sandbox run serve      # firebase emulators:start --only functions:sandbox
firebase emulators:start --only functions,firestore
firebase functions:shell
```

Caveat: the emulator still reads the real `uniliftdev` unless you also emulate
Firestore, and Stripe/Expo calls still go out to the real (test-mode) services.

### Switching the app to point here

```
.env:  EXPO_PUBLIC_APP_ENV=dev
expo start --clear
```

You'll know it worked when the orange **DEV** badge appears next to "UniLift".
Never delete the line — a missing value throws at startup by design.

---

## 14. Gotchas, in one place

1. **The health route is `/hello`, not `/health`.** `docs/terminal-commands.md`
   currently documents `/health`, which 404s.
2. **`USE_LEGACY_MATCHING = false`** — dispatch is a full-collection broadcast
   right now, not the proximity algorithm the code below the flag describes.
3. **A bare `firebase deploy --only functions` deploys production too.**
4. **The dev/prod split does not isolate push.** See §8 before testing anything
   that dispatches.
5. **Two codebases, no shared library.** Every shared fix must be applied twice.
6. **`/cert/adult/reconcile` grants on a null dob.** Sandbox-only leniency for
   Stripe test mode — must not be ported as-is.
7. **Firestore transactions cannot do external reads**, which is why
   `getPricing()` is awaited *before* `db.runTransaction()` in `/rides/finish`.
8. **`getDb(req)` ignores `req`** in this codebase. The parameter exists only to
   keep the file diff-able against LIVE.
9. **A missing Stripe test key fails the deploy, not a request** — that is the
   intended behaviour.
10. **`sweepStaleRides` pass 3 is dead code** pending a cleanup TODO.
11. **Tests exist and run.** `npm test` (jest + ts-jest) covers the fare math,
    the shared Firestore REST unwrapping, and the matching geometry.
    `npm run check` runs lint + tests + `scripts/check-server-drift.sh`, which
    guards the shared route table and the mirrored constants. (This entry used
    to read "no test runner is configured" — that was true only in the sense
    that nothing was wired to a script.)
12. **`notified` means the same thing on both servers now** — push tickets Expo
    accepted, not attempts. It used to differ; if you are reading an old log,
    LIVE's pre-cutover numbers were inflated.
13. **`/dev/seed-request`'s "~2 km apart" comment is wrong** — the default points
    are 6.2 km apart.

---

## 15. Where to go next

| I want to… | Start here |
|---|---|
| Add an API route | Both `functions/index.js` **and** `functions-sandbox/index.js`, then a `services/` wrapper |
| Change ride pricing | `config/pricing` doc (live, ~60 s), or `DEFAULT_PRICING` + `constants/pricing.ts` |
| Change who gets notified | `isEligibleRecipient()` / `USE_LEGACY_MATCHING` |
| Test a ride solo | `app/devToolsScreen.tsx` + `services/devRideService.ts` + `/dev/*` |
| Change certifications | `constants/certifications.ts` + `app/certificationScreen.tsx` + `/cert/*` |
| Debug missing pushes | `POST /dev/dispatch-report` via the DEV badge |
| Understand the whole repo | [docs/codebase-map.md](codebase-map.md) |
| Switch environments | [DEV-PROD-SWITCHING.md](../DEV-PROD-SWITCHING.md) |
| Look up a CLI command | [docs/terminal-commands.md](terminal-commands.md) |
