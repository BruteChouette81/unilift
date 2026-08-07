# UniLift — Admin Dashboard Inventory (Firebase side)

> **Status:** Phase 1 deliverable (READ-ONLY analysis). No code, rules, or config
> have been changed to produce this document.
>
> **Audience:** the founder admin dashboard being built in the separate
> `unilift-rides` website repo.
>
> **Target environment:** Firebase project `unilift-6e756`, **named Firestore
> database `uniliftdefault` (production)**.

---

## 0. Environment model (important)

There is **one** Firebase project: `unilift-6e756` ([.firebaserc](../.firebaserc)).
There are **no** separate dev/prod projects. Dev vs prod is split by **two named
Firestore databases inside the same project**:

| Env  | Named DB         | How the app selects it |
|------|------------------|------------------------|
| dev  | `uniliftdev`     | `isDev` (`EXPO_PUBLIC_APP_ENV=dev`) in [constants/runtime-config.ts](../constants/runtime-config.ts#L50-L52); functions read header `X-App-Env: dev` |
| prod | `uniliftdefault` | default (no dev flag); functions default branch |

The Cloud Functions hold both DB handles and route per request:
```js
const prodDb = getFirestore("uniliftdefault");
const devDb  = getFirestore("uniliftdev");
const getDb  = (req) => req.headers["x-app-env"] === "dev" ? devDb : prodDb;
```
([functions/index.js](../functions/index.js#L20-L34))

The web client builds REST URLs against the **named** DB too
([constants/runtime-config.ts](../constants/runtime-config.ts#L62-L64)). **The
website must therefore connect to `uniliftdefault`, not `(default)`** — see the
hand-off doc.

---

## 1. Firebase products in use

| Product | Used? | Notes |
|---------|-------|-------|
| **Auth** | ✅ | Firebase Auth (email/password + Apple Sign-In). Session persistence via `getReactNativePersistence(AsyncStorage)`. Source of `idToken` attached to every REST/Function call. |
| **Firestore** | ✅ | Named DBs `uniliftdev` / `uniliftdefault`. Hybrid access: SDK `onSnapshot` (forced long-polling) for live screens; REST API for one-time reads + all writes. |
| **Cloud Functions** | ✅ | firebase-functions **v1** API (pkg v6), firebase-admin v12, Node 20. One Express app: `exports.api = functions.https.onRequest(app)`, region **us-central1** (`api-qsxtpust2a-uc.a.run.app`). Handles Stripe wallet/billing, push, social linking, driver dispatch, `events/interest`, account delete. |
| **Remote Config** | ❌ | Not used. App constants live in code or the `events` Firestore collection. |
| **Storage** | ⚠️ | A storage bucket is configured (`firebaseStorageBaseUrl` helper exists) but no Storage SDK upload/download writes were found in `services/`. Avatars are stored as `avatar` **strings** on the user doc. Treat Storage as "configured, not actively written by services." |

External (non-Firebase): **Stripe** (payments/billing), **Google Maps**
(geocoding/places), **Expo Push** (notifications), social OAuth (Facebook /
Instagram / TikTok / Spotify).

---

## 2. Firestore collections — schema & PII classification

PII / Loi 25 flags call out personal data: contact info, **addresses**, and
**precise locations** (GeoPoints). The dashboard must **never** surface these;
metrics stay aggregate.

### `users/{uid}` — 🔴 PII-heavy + financial
Schema inferred from [types/models.ts](../types/models.ts#L26-L81),
[services/userService.ts](../services/userService.ts), and
[functions/index.js](../functions/index.js).

| Field | Type | Classification |
|-------|------|----------------|
| `email` | string | 🔴 PII (contact) |
| `name` | string | 🔴 PII |
| `avatar` | string (url) \| null | PII (image) |
| `homeAddress` | string \| null | 🔴 **Loi 25 — address** |
| `homeAddressCoords` | geoPoint/map \| null | 🔴 **Loi 25 — precise location** |
| `localisation` | geoPoint `{latitude,longitude}` | 🔴 **Loi 25 — precise location** |
| `birthDate` / `age` | string / number | 🔴 PII |
| `school` | string | PII |
| `preferences` | string[] | low |
| `xp`, `rating`, `ratings`, `ratingWeigth`, `ridesCompleted` | number | non-PII (gamification) |
| `favorite[]` | array of `{ destination, destinationGeolocation: geoPoint }` | 🔴 **Loi 25 — saved locations** |
| `language` | "en"\|"fr" | non-PII |
| `expoPushToken` | string | 🟠 PII (device identifier) |
| `facebookId/Name`, `instagramId/Handle`, `tiktokId/Handle`, `spotifyId/Name` | string | 🟠 PII (social identity) |
| `driverAvailability[]` | window objects incl. `destinationCoords` geoPoint | 🔴 location |
| `driverDays`, `driverMaxDetourKm`, `driverDestinationRadiusKm` | array/number | low |
| `driverDefaultDestination(+Coords)` | string / geoPoint | 🔴 location |
| `pendingChargeCents`, `pendingEarningsCents` | number (cents) | 🟠 financial — Cloud-Function-only |
| `stripeCustomerId`, `stripePaymentMethodId`, `stripePaymentMethodLast4`, `stripePaymentMethodBrand` | string | 🔴 financial/payment — Cloud-Function-only |

> Financial fields are write-protected from clients by the existing rules
> (`isFinancialField` / `touchesFinancialFields`).

### `users/{uid}/transactions/{txId}` — 🟠 financial (subcollection)
From [functions/index.js](../functions/index.js#L240-L258) +
[types/models.ts](../types/models.ts#L125-L135).

| Field | Type |
|-------|------|
| `type` | "ride_charge" \| "ride_earning" \| "monthly_charge" \| "monthly_payout" |
| `amount` | number (cents) |
| `status` | "completed" \| "pending" \| "failed" |
| `description` | string |
| `createdAt` | ISO string |
| `rideId`, `distanceKm`, `stripePaymentIntentId` | optional |

Read: owner only. Write: Cloud Functions only (admin SDK). **Good GMV source for
metrics**, but per-doc data is financial — aggregate only.

### `rides/{rideId}` — 🔴 PII (precise locations)
From [services/rideServices.ts](../services/rideServices.ts) +
[types/models.ts](../types/models.ts#L159-L197).

Key fields: `driverId`, `driverName`, `driverAvatar`, `destination`,
`destinationCoords` (geoPoint), `localisation` (geoPoint — driver origin),
`date`/`departureAt`, `seatsAvailable`, `passengers[]`, `passengerSeats{}`,
`passengerPickups{}` (geoPoints 🔴), `passengerDropoffs{}` (geoPoints 🔴),
`joinRequests{}` (incl. passenger `location` geoPoint 🔴), `driverLocation`
(geoPoint 🔴), `status` (`planned|started|completed|expired|cancelled`),
`started`, `paymentStatus`, `maxDetourKm`, `baseRouteKm`, `routePolyline`,
`pendingRatings[]`, `ratingsSubmitted[]`, `droppedPassengers[]`,
`confirmedDropoffPassengers[]`.

→ Good source for ride-count / completed-ride / 7–30 day metrics. **Never expose
coordinates or passenger lists** in the dashboard.

### `rideRequests/{requestId}` — 🔴 PII (locations)
From [types/models.ts](../types/models.ts#L204-L222) +
[functions/index.js](../functions/index.js#L992-L1001).

`passengerId`, `passengerName`, `passengerAvatar`, `origin` (geoPoint 🔴),
`originLabel`, `destination`, `destinationCoords` (geoPoint 🔴), `date`,
`seatsRequested`, `status` (`open|matched|cancelled|expired`), `createdAt`,
`matchedRideId`, `matchedDriverId`.

### `driverSessions/{uid}` — 🔴 PII (live GPS)
From [types/models.ts](../types/models.ts#L107-L123) +
[functions/index.js](../functions/index.js#L1053-L1056). Doc id == driver uid.

`driverId`, `driverName`, `driverAvatar`, `origin` (geoPoint 🔴), `destination`,
`destinationCoords` (geoPoint 🔴), `baseRouteKm`, `routePolyline`, `maxDetourKm`,
`destinationRadiusKm`, `seatsAvailable`, `status` (`online|offline`), `updatedAt`.

→ "Online drivers right now" = `where status == "online"` count. Aggregate only.

### `events/{eventId}` — 🟢 CONFIG (no PII) — **the editable target**
See section 3.

---

## 3. Editable-constant collections

### `events` — Hype-map events (PRIMARY, already in Firestore) 🟢
Read by the app via REST `:runQuery` ordered by `score`
([services/eventService.ts](../services/eventService.ts#L100-L122)); seeded by
[functions/seed-events.js](../functions/seed-events.js); the dashboard will
create/edit/delete these documents. No PII.

**Collection path:** `events/{eventId}` (document id is a slug, e.g. `neon-rave`).

**Document shape (app read/write contract):**

| Field | REST type | Required | Meaning |
|-------|-----------|----------|---------|
| `name` | `stringValue` | ✅ | English event name |
| `nameFr` | `stringValue` | — | French name (falls back to `name`) |
| `venue` | `stringValue` | ✅ | Venue label |
| `location` | `geoPointValue` `{latitude,longitude}` | ✅ | Map marker position |
| `score` | `integerValue` 1–10 | ✅ | Hype level → flame marker size (10 = biggest) |
| `description` | `stringValue` | — | EN description |
| `descriptionFr` | `stringValue` | — | FR description |
| `date` | `stringValue` | — | Display text, e.g. `"Sat Apr 5"` |
| `time` | `stringValue` | — | Display text, e.g. `"11 PM"` |
| `tag` | `stringValue` | — | EN tag, e.g. `"Party"` |
| `tagFr` | `stringValue` | — | FR tag |
| `ticketPriceCents` | `integerValue` | — | Omit ⇒ free entry |
| `attendeeCount` | `integerValue` | — | **Server-managed** via `/events/interest`. The dashboard should **not** edit it (race-safe counter). |

`score` is clamped to 1–10 on read (`clampHypeScore`). The dashboard editor
should validate `score ∈ [1,10]` and write `location` as a GeoPoint.

> **SDK write tip (website):** with the Firebase JS SDK use
> `new GeoPoint(lat, lng)` for `location`; the REST type wrappers above are only
> needed if writing via the raw REST API.

### `sponsors` — map sponsors (in Firestore) 🟢
Paying partner businesses shown on the home map. Read by the app via REST
`:runQuery` ([services/sponsorService.ts](../services/sponsorService.ts)); dev
test data seeded by [functions/scripts/seed-sponsors.js](../functions/scripts/seed-sponsors.js)
(**`uniliftdev` only**); the **admin dashboard creates/edits/deletes these in
`uniliftdefault`** (see [website-sponsors-handoff.md](website-sponsors-handoff.md)).
No PII (business data). Rules: `read: isSignedIn()`, `create/update/delete: isAdmin()`.

**Collection path:** `sponsors/{sponsorId}` (document id is a slug, e.g. `mcdonalds-laurier`).

**Document shape (app read/write contract — write via SDK with native types):**

| Field | REST type | Required | Meaning |
|-------|-----------|----------|---------|
| `name` | `stringValue` | ✅ | Business name |
| `category` | `stringValue` | ✅ | `fast-food` \| `cafe` \| `bar` \| `store` \| … (drives fallback icon) |
| `location` | `geoPointValue` `{latitude,longitude}` | ✅ | Map marker position |
| `tier` | `stringValue` | ✅ | `gold` \| `silver` \| `bronze` → marker size / glow / z-order / badge |
| `logoUrl` | `stringValue` | — | **Raster** (PNG/JPG/WebP) logo URL — no SVG. Omit ⇒ category icon |
| `brandColor` | `stringValue` | — | Hex accent, e.g. `#FFC72C` |
| `address` | `stringValue` | — | Modal display line |
| `tagline` | `stringValue` | — | Short eyebrow, e.g. `Open till 3 AM` |
| `offers` | `arrayValue` of `mapValue` | — | Each `{ title (req), description?, discount? }` |
| `active` | `booleanValue` | — | Default true; `false` hides from the map |

> The dashboard writes with the Firebase JS SDK (`new GeoPoint(lat,lng)`, real
> arrays/maps) — the REST wrappers above are only how the app *reads* them.

### Other constants — NOT yet in Firestore (future candidates)
- **Ride pricing** — hardcoded in [constants/pricing.ts](../constants/pricing.ts)
  and **mirrored** in [functions/index.js](../functions/index.js#L54-L58)
  (`PASSENGER_RATE_CENTS_PER_KM`, etc.). Making this dashboard-editable would
  require migrating both the app constant and the function to read Firestore —
  **out of scope** for this phase.
- **Promoted events** — `PROMOTED_EVENTS` in
  [constants/events.ts](../constants/events.ts#L73) is currently an empty
  hardcoded array. Future Firestore candidate.
- **Cancellation fees** — hardcoded in `constants/cancellation.ts`.

These are listed so the dashboard roadmap knows what *could* become editable, but
only `events` is wired for Firestore editing today.

---

## 4. Candidate "first metrics" — sorted by cost

### A. Cheap — client-side `getCountFromServer` (web SDK, admin-gated by rules)
All sources are already `read: if isSignedIn()`, so an admin can run these
directly from the website with one aggregation read each (no documents
transferred):

| Metric | Query |
|--------|-------|
| Total users | `count(collection("users"))` |
| Total rides | `count(collection("rides"))` |
| Total events | `count(collection("events"))` |
| Total ride requests | `count(collection("rideRequests"))` |
| Online drivers (now) | `count(query(collection("driverSessions"), where("status","==","online")))` |

### B. Needs a Cloud Function (filtered/aggregated; some over protected data)
- **Rides last 7 / 30 days** — `where("date", ">=", cutoff)` count. (`date` is a
  Timestamp; needs a server-side cutoff and possibly an index.)
- **Completed rides** — `where("status","==","completed")` count.
- **Active drivers** — distinct drivers with an active Ride-Mode window /
  recent session (mirrors dispatch logic).
- **GMV (gross marketplace value)** — sum of `ride_charge` transaction amounts
  across `users/*/transactions` (collection-group), Cloud-Function-only because
  transactions are not client-readable across users.

### C. Admin SDK only
- **Total Auth users** — `admin.auth().listUsers()` paging. Not available from
  the client at all.

→ Recommendation: expose **B + C** (plus optionally A) through one admin-gated
callable `getAdminMetrics` (Phase 2), and let the website run **A** directly for
instant cheap counts.

---

## 5. Current `firestore.rules` — summary & minimal additive change

**Current rules** ([firestore.rules](../firestore.rules)) — `rules_version = '2'`:

- **Helpers:** `isSignedIn`, `isOwner`, `isRideDriver`, `isRidePassenger`, and
  financial-field guards. **No admin concept.**
- `users/{uid}`: read if signed-in; create/update by owner (minus financial
  fields); cross-user update limited to `ratings/ratingWeigth/xp/ridesCompleted`;
  no delete.
- `users/{uid}/transactions`: owner read; **all writes denied** (CF only).
- `rides/{rideId}`: read if signed-in; driver/passenger/join-request scoped
  updates; **no client delete**.
- `rideRequests/{requestId}`: read if signed-in; owner-scoped writes.
- `events/{eventId}`: read if signed-in; **`write: if false`** (console/CF only).
- `driverSessions/{uid}`: read if signed-in; owner writes.

**Minimal additive change for the dashboard (Phase 2):**
1. Add helper:
   ```
   function isAdmin() {
     return request.auth != null && request.auth.token.admin == true;
   }
   ```
2. In `match /events/{eventId}`, replace `allow write: if false;` with
   `allow create, update, delete: if isAdmin();` (read rule unchanged).
3. **No read-rule changes needed** for metrics: `users`, `rides`,
   `rideRequests`, `driverSessions`, `events` are already admin-readable via
   `isSignedIn()`. Privileged/aggregate metrics (Auth totals, cross-user GMV)
   go through the `getAdminMetrics` callable, which checks the same claim.

This is strictly additive — every existing user/ride/request rule is untouched.

> ⚠️ **Deploy-target caveat (to resolve in Phase 2):**
> [firebase.json](../firebase.json) declares `firestore.rules` with **no
> `database` key**, so `firebase deploy --only firestore:rules` targets the
> `(default)` database — **not** the `uniliftdefault` DB the app actually uses.
> Before the admin `events` write rule can take effect, `firebase.json` likely
> needs an additive multi-database Firestore config so the rules are enforced on
> `uniliftdefault`. This will be presented as a small additive diff in Phase 2.

---

## 6. Admin gating (decision for Phase 2)

**Recommended: Firebase Auth custom claims** (`{ admin: true }`) on the two
founder accounts.

- Website: `getIdTokenResult()` → `claims.admin === true` (zero extra reads).
- Rules: `request.auth.token.admin == true` (no `get()` cost).
- Founders: `thomasberthiaume183@gmail.com`, `vachonbegin@gmail.com`.
- Set once via an Admin SDK script (Phase 2 `functions/scripts/set-admin-claims.js`).

Alternative `admins/{uid}` Firestore doc was considered but rejected: it adds a
Firestore read on every admin rule evaluation and another collection to secure.

---

## Next step
Phase 2 (after your approval): additive `firestore.rules` diff + `firebase.json`
multi-db config, `set-admin-claims.js`, the `getAdminMetrics` callable, and
`docs/website-handoff.md` — all as files + commands for **you** to deploy.

---

## 7. Grant your account admin clearance — step by step

**Goal:** put the `{ admin: true }` custom claim on `thomasberthiaume183@gmail.com`
so `getAdminMetrics` stops returning `permission-denied` and the dashboard rules
recognize you as admin.

**What's already done (no action needed):**
- `getAdminMetrics` is deployed and checks `context.auth.token.admin === true`
  ([functions/index.js](../functions/index.js#L1456)).
- The grant script exists and already lists your email
  ([functions/scripts/set-admin-claims.js](../functions/scripts/set-admin-claims.js#L33-L36)).
- The claim is **project-wide** — one run covers both `uniliftdev` and
  `uniliftdefault` (Auth is shared across the named DBs).

So clearance = run the script once with an admin credential, then refresh your token.

### Step 1 — Confirm your account exists in Firebase Auth
Your account must have signed into the app at least once (email/password or Apple),
so a Firebase Auth user record exists for `thomasberthiaume183@gmail.com`. If it
doesn't, the script prints `auth/user-not-found` — sign in through the app first,
then continue.

### Step 2 — Get a service-account key with Auth-admin rights
The script authenticates as the project, not as you.

1. Open the Firebase console → project **`unilift-6e756`** → **Project settings**
   (gear) → **Service accounts** tab.
2. Click **Generate new private key** → confirm → a `serviceAccount.json` downloads.
3. Move it somewhere private and **outside the git repo** (e.g.
   `C:\Users\hbari\secrets\unilift-serviceAccount.json`). Never commit it.

> The default "Firebase Admin SDK" service account already has the
> `setCustomUserClaims` / `listUsers` permissions the script needs.

### Step 3 — Point the environment at the key and project
In a **Git Bash** shell (the Bash tool), from the repo root:

```bash
export GOOGLE_APPLICATION_CREDENTIALS="/c/Users/hbari/secrets/unilift-serviceAccount.json"
export GOOGLE_CLOUD_PROJECT=unilift-6e756
```

PowerShell equivalent:

```powershell
$env:GOOGLE_APPLICATION_CREDENTIALS = "C:\Users\hbari\secrets\unilift-serviceAccount.json"
$env:GOOGLE_CLOUD_PROJECT = "unilift-6e756"
```

### Step 4 — Run the grant script
```bash
cd functions
node scripts/set-admin-claims.js
```

Expected output:
```
✅ admin granted to thomasberthiaume183@gmail.com (uid: …)
✅ admin granted to vachonbegin@gmail.com (uid: …)   # (or user-not-found if that account hasn't signed in)

Done. 2/2 processed. Founders must re-login (token refresh) for the claim to take effect.
```

The script is idempotent — safe to re-run. To remove the claim later:
`node scripts/set-admin-claims.js --revoke`.

### Step 5 — Refresh your ID token so the claim appears
Custom claims only land in the ID token on the **next** token issuance. Do one of:
- **App:** sign out and sign back in, **or**
- **Web dashboard / any client:** call `await auth.currentUser.getIdToken(true)`
  (force-refresh) then re-issue the request.

### Step 6 — Verify clearance
Call the deployed callable as your signed-in self:

```js
import { getFunctions, httpsCallable } from "firebase/functions";
const fns = getFunctions(app, "us-central1");           // region matches deploy
const res = await httpsCallable(fns, "getAdminMetrics")({ env: "prod" });
console.log(res.data);   // { users, rides, gmv, authUsers, … } → success
```

- Success → JSON metrics object = clearance is live.
- `permission-denied` ("Admins only.") → token not refreshed yet; redo Step 5.
- `unauthenticated` → you're not signed in on that client.

### Step 7 — Clean up
Delete or lock down `serviceAccount.json` once done — it grants full project
access. Do **not** leave it in the repo or in shell history.

> **Note (dashboard write rules):** this claim also satisfies the `isAdmin()`
> rule for editing `events`. But per the §5 caveat, confirm `firestore.rules` is
> actually deployed to the **`uniliftdefault`** DB (not `(default)`) before
> relying on admin `events` writes. The `getAdminMetrics` callable itself does
> **not** depend on rules — it enforces the claim in code — so metrics work
> regardless.
