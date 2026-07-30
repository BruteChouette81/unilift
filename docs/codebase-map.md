# UniLift — Codebase Map

> **Purpose:** navigation aid for Claude Code (and humans) working in this repo.
> Answers "where does X live?" without re-grepping the tree each session.
>
> **Line numbers are hints, valid as of v1.3.4.** Anchor on the symbol name;
> treat the line number as a starting offset. Everything below was derived by
> reading the code, not from assumptions.
>
> Companion docs: `ride-lifecycle-audit.md` (deep behavioural trace of the ride
> flow), `unilift-admin-inventory.md` + `website-handoff.md` (the *separate*
> `unilift-rides` website repo), `wizards-and-helpers-audit.md`.

---

## 1. The three deployables

This repo builds **three independently-shipped things**. Confusing them is the
single most common source of wrong edits.

| # | Thing | Root | Entry point | Talks to |
|---|---|---|---|---|
| 1 | **Expo app** (iOS/Android) | `app/`, `components/`, `services/`, … | `app/_layout.tsx` | Firestore direct + one of the two servers |
| 2 | **LIVE server** | `functions/` | `functions/index.js` → `exports.api` | `uniliftdefault` **and** `uniliftdev` |
| 3 | **SANDBOX server** | `functions-sandbox/` | `functions-sandbox/index.js` → `exports.apiSandbox` | `uniliftdev` only |

**The two servers are near-duplicates, not a shared library.** `functions-sandbox/`
began as a copy of `functions/`. Routes 1–31 are identical in both (same order,
~5–10 line offset). A fix to shared logic must usually be applied **twice**.

- **LIVE** (`functions/index.js`) is frozen at the last App Store build. It
  serves *both* environments per-request: `getDb(req)` / `getStripe(req)` switch
  on the `X-App-Env: dev` header (`functions/index.js:38-43`). Needs all four
  Stripe keys or it throws at boot.
- **SANDBOX** (`functions-sandbox/index.js`) is where new features land. It is
  hardwired to dev — `getDb()` ignores the header entirely
  (`functions-sandbox/index.js:33-35`). Test Stripe keys only.

**Sandbox-only routes** (the 15 that do *not* exist in LIVE):
`/cert/*` (5 routes), `/stripe/identity-webhook`, `/dev/*` (9 routes).
Certifications and the dev harness are sandbox features awaiting cutover.

Which server the app hits is decided in `constants/runtime-config.ts:95-97`:
`apiBaseUrl` = `EXPO_PUBLIC_API_BASE_URL` override, else sandbox when
`isDev`, else live.

---

## 2. Top-level layout

```
app/              Expo Router file-based routes (screens)
components/       Reusable UI + a few data helpers (userHelper.ts)
constants/        Design tokens, business config, i18n, runtime-config
context/          5 React providers (auth, profile, wallet, language, active ride)
hooks/            ~25 focused hooks
services/         All Firestore/Cloud-Function calls
utils/            Pure logic (geometry, matching, lifecycle predicates, logging)
types/models.ts   Single source of truth for domain types
functions/        LIVE Cloud Functions (monolithic index.js, ~2350 lines)
functions-sandbox/ SANDBOX Cloud Functions (monolithic index.js, ~2900 lines)
firestore.rules   Production rules · firestore.dev.rules  Dev-DB rules
docs/             Audits + hand-offs (this file)
```

No `src/`. Path alias `@/` → repo root (`tsconfig.json`).

---

## 3. App routing

Expo Router v6, file-based. `app/_layout.tsx` (736 lines) is the control tower.

### Provider stack — `app/_layout.tsx:185-204`
```
StripeProvider → AuthProvider → UserProfileProvider → WalletProvider
              → LanguageProvider → ActiveRideProvider → LayoutContent
```
Anything needing auth/profile/wallet must sit inside this.

### Gates in `LayoutContent` (order matters)
| Gate | Where | Effect |
|---|---|---|
| OTA update | `useOtaUpdate()` | Fetch/reload JS bundle before first render; fail-open |
| Force update | `useForceUpdateConfigFetcher()` + `isUpdateRequired()` | → `updateRequiredScreen` |
| Countdown | `useCountdownConfigFetcher()`, `~:517-540` | → `countdown` (logged out) / `countdown-confirmation` (logged in) |
| Auth | `status` from `AuthContext` | `(auth)` stack vs `(tabs)` stack |
| Notification gate | `useNotificationGate()` | `components/NotificationGateScreen.tsx` |
| Active-ride resume | `~:405-479` | Validates stored ride; resumes `findingDriverScreen`/`matchDriverScreen` after cold start |

Three floating banners also live here: `AppHeader` (wallet pill + DEV badge),
`ActiveRideBanner`, `DriverOnlineBanner` / `GlobalDriverAvailabilityBanner`.

### Screen graph

```
(auth)/countdown ──► (auth)/login ──► (auth)/signup ──► onboardingScreen ──► (tabs)
                          ▲
(tabs)/index (map + search)
   ├─ passenger: request ──► findingDriverScreen ──► matchDriverScreen ──► rideScreen
   └─ driver:    driveOnlineScreen ──► driverRequestsScreen ──► riderScreen
                        ▲                    │
   push notification ───┴──► acceptRideScreen┘
(tabs)/wallet
(tabs)/profile
   ├─ settingsScreen ──► profileSettings | privacyScreen | helpSupportScreen
   ├─ certificationScreen
   ├─ favoriteScreen
   └─ rewardsScreen
devToolsScreen  (long-press DEV badge, dev builds only)
```

**Passenger vs driver ride screen — the naming is a trap:**
- `app/rideScreen.tsx` (1026 lines) = **passenger** view
- `app/riderScreen.tsx` (1609 lines) = **driver** view

Screens with no literal inbound link (reached via template strings):
- `acceptRideScreen` ← `hooks/use-push-notifications.ts:44`
- `matchDriverScreen` ← `findingDriverScreen.tsx:123`
- `findingDriverScreen` ← `(tabs)/index.tsx:399`
- `profileSettings` ← `settingsScreen.tsx:279`, `profile-completion-card.tsx:72`
- `driverModeScreen` — registered at `_layout.tsx:632`; recurring-availability
  editor, currently reachable only from driver settings UI

---

## 4. State layers

### Contexts (`context/`)
| File | Owns | Key export |
|---|---|---|
| `AuthContext.tsx` | `user`, `status`, `loading`, `authActionLoading`; sign-in/up/Apple/out | `useAuth()` |
| `UserProfileContext.tsx` | Cached `UserProfile` doc | `useUserProfile()` |
| `WalletContext.tsx` | `pendingChargeCents`, `pendingEarningsCents`, saved card | `useWallet()` |
| `LanguageContext.tsx` | `en`/`fr` + `t()` | `useLanguage()` |
| `ActiveRideContext.tsx` | Persisted active ride **and** pending ride request (survives app kill) | `useActiveRide()` |

`ActiveRideContext` is what makes "reopen the app mid-ride and land back in it"
work. If a flow leaves a stale banner, look at `clearActiveRide` /
`clearPendingRequest` call sites.

### Hooks worth knowing (`hooks/`)
- **Profile split** (per CLAUDE.md convention): `use-profile-data`,
  `use-profile-favorites`, `use-profile-rides`, `use-profile-avatar`,
  `use-profile-completion`
- **Ride discovery**: `use-ride-recommendations.ts` (228 lines) — scoring
  (`scoreDistance/Time/Direction/Preference` → `recommendRides`)
- **Driver**: `use-driver-session.ts`
- **Notifications**: `use-push-notifications` (routes on tap),
  `use-notification-gate`, `use-notification-prompt`
- **Social**: `use-facebook-auth` (implicit flow), `use-social-connect`
  (Instagram/TikTok/Spotify auth-code, server does the exchange)
- **Perf**: `use-adaptive-polling`, `use-live-refresh`, `use-debounced-value`

---

## 5. Data access — the hybrid rule

Per CLAUDE.md: **`onSnapshot` for live screens, REST for everything else.**

Only five files use `onSnapshot`:
`app/driverRequestsScreen.tsx`, `app/findingDriverScreen.tsx`,
`app/matchDriverScreen.tsx`, `app/riderScreen.tsx`, `components/mapview.tsx`.
Everything else goes through `services/` over the REST API with manual
`Authorization: Bearer {idToken}` and type-wrapper unwrapping.

### Service index (`services/`)
| File | Lines | Responsibility |
|---|---|---|
| `rideServices.ts` | 1258 | **The big one.** Ride CRUD, join/accept/reject, start, dropoff, ratings, cancel/leave/quit, geocoding, autocomplete, rides cache |
| `driverSessionService.ts` | 326 | Go online/offline, dispatch, accept request, driver counts |
| `authService.ts` | 336 | Email + Apple sign-in, password reset, session validity, error normalization |
| `rideRequestService.ts` | 238 | Passenger `rideRequests` CRUD |
| `routeService.ts` | 216 | Google Directions: route stats, multi-waypoint, detour km |
| `userService.ts` | 193 | User doc fetch, favorites, driver profile extraction |
| `eventService.ts` | 181 | Hype events + interest toggle + **local cache** |
| `certificationService.ts` | 134 | Adult (Stripe Identity) + student email verification — **sandbox only** |
| `devRideService.ts` | 98 | `/dev/*` harness client — **sandbox only** |
| `notificationService.ts` | 91 | Push token registration |
| `paymentService.ts` | 73 | QR generation/validation, ride payment trigger |
| `pricingService.ts` | 42 | Fetch `config/pricing` |
| `walletService.ts` | 36 | Card setup/confirm/remove, transactions, can-join |
| `sponsorService.ts` | 116 | Sponsors |

**Invariant:** call `invalidateRidesCache()` after any ride mutation
(`rideServices.ts`).

### Parsing helpers
REST responses need unwrapping: `parseRideFromFirestoreDocument`
(`rideServices.ts`), `normalizeUserData` (`components/userHelper.ts`),
`extractFavoriteRoutes` (`userService.ts`), `parseDriverSession`
(`driverSessionService.ts`).

`components/userHelper.ts` is misfiled — it is a data-layer module, not a
component (`normalizeUserData`, `patchUserField`, `fetchAndSyncUserData`,
`encodeDriverAvailabilityFields`, birth-date utilities).

---

## 6. Domain model

`types/models.ts` (262 lines) is the single source of truth. Key types:
`UserProfile`, `Ride`, `RideRequest`, `DriverSession`,
`DriverAvailabilityWindow`, `JoinRequest`, `WalletTransaction`,
`QrBoardingToken`, `ScoredRide`.

### State machines
```
RideStatus        planned → started → completed | expired
RideRequestStatus open → matched | cancelled | expired
JoinRequestStatus pending → accepted | rejected
```
Predicates live in `utils/ride-lifecycle.ts`: `isRideLive`, `isRideScheduled`,
`isRideExpired`, `isRideJoinable` (+ `RIDE_LIVE_WINDOW_MS` = 3h).

### Firestore collections
| Collection | Written by | Notes |
|---|---|---|
| `users/{uid}` | app + server | Profile, wallet counters, Stripe ids, driver availability, `certifications` (**server-only**) |
| `users/{uid}/transactions/{txId}` | server only | Wallet ledger |
| `rides/{rideId}` | app + server | The ride doc; `pendingConfirmation` gates start |
| `rideRequests/{id}` | app + server | Passenger-initiated requests |
| `driverSessions/{uid}` | app | Live "online to drive" session |
| `events/{id}` | admin site | Hype map |
| `sponsors/{id}` | admin site | Sponsor cards |
| `config/{doc}` | admin site | `pricing`, `countdown`, `forceUpdate` |
| `certEmailTokens`, `certAdultSessions` | sandbox server | Certification flow |

Two named databases: **`uniliftdefault`** (prod) and **`uniliftdev`** (dev).
Rules: `firestore.rules` / `firestore.dev.rules` — collection blocks at
`firestore.rules:60` (users), `:95` (rides), `:151` (rideRequests), `:175`
(events), `:184` (sponsors), `:193` (config), `:202` (driverSessions).

---

## 7. Ride lifecycle — client ↔ server

Server is authoritative for every state transition. Client calls, never writes
status directly.

| Step | Client | Server route (both codebases) |
|---|---|---|
| Passenger requests | `(tabs)/index.tsx` → `createRideRequest` | — |
| Notify drivers | `dispatchRideRequest` | `POST /requests/dispatch` |
| Passenger waits | `findingDriverScreen` (`onSnapshot`) | — |
| Driver sees request | `driverRequestsScreen` / push → `acceptRideScreen` | `POST /drivers/available` |
| Driver accepts | `acceptRideRequest` | `POST /requests/accept` |
| Passenger confirms | `matchDriverScreen` swipe | `POST /rides/confirm-driver` / `/rides/reject-driver` |
| Driver starts | `riderScreen` | `POST /rides/start` (428 if `pendingConfirmation` non-empty) |
| Boarding | QR: `QrCodeDisplay` / `QrScanner` | `POST /rides/qr`, `POST /rides/board` |
| Dropoff | `riderScreen` | `POST /rides/dropoff` |
| Finish + charge | — | `POST /rides/finish`, `POST /rides/complete` |
| Rate | `components/ratings.tsx` | `POST /rides/rate` |
| Abort | — | `POST /rides/cancel`, `POST /rides/leave` |

**Mutual-match invariant:** a dispatch-accepted passenger lands in
`pendingConfirmation[]`; the driver cannot start until it drains. Passengers
joining a *planned* ride skip this entirely.

Matching logic: client-side scoring in `hooks/use-ride-recommendations.ts` and
geometry in `utils/matching/geometry.ts` (`projectOntoPolyline`,
`computeDetour`) + `utils/matching/matchRide.ts`. Server-side proximity/detour
matching lives under `// ── Proximity matching tunables` (`functions/index.js:997`,
`functions-sandbox/index.js:992`). **The client and server implement matching
separately — keep them in sync.**

**Broadcast mode is currently active in both servers.** `USE_LEGACY_MATCHING =
false` makes `/requests/dispatch` and `/drivers/available` skip all
proximity/window logic and fan out to every user with `driverModeEnabled !==
false`; the proximity code below the early return is dead until the flag flips.
The sandbox spent a release without this flag while LIVE had it, which meant dev
builds silently ran a different algorithm than production — that divergence is
what produced "0 drivers available" and missing dispatch pushes in dev. If you
change one server's dispatch, change both.

One deliberate difference remains: the sandbox `/drivers/available` also requires
`expoPushToken` before counting a user, so the number the passenger sees equals
the number `/requests/dispatch` can actually reach. LIVE still over-counts —
port it at cutover (marked `// PORT AT CUTOVER` in the sandbox).

---

## 8. Server internals

Both `index.js` files follow the same section order (`// ── ` banners make good
grep anchors). Offsets below are `functions/` → `functions-sandbox/`.

| Section | live | sandbox |
|---|---|---|
| Auth middleware | 48 | 43 |
| Payment utilities (mirrors `constants/pricing.ts`) | 63 | 58 |
| Stripe customer helper | 125 | 120 |
| Wallet routes | 174–306 | 169–301 |
| Rides: complete / can-join | 307 | 302 |
| Push notifications | 439 | 434 |
| Billing (charge / payout) | 532, 593 | 527, 588 |
| Account delete | 663 | 658 |
| Social: Facebook | 722 | 717 |
| Social: Instagram/TikTok/Spotify | 781 | 776 |
| Detour matching + dispatch | 970 | 965 |
| Hype events interest | 1517 | 1475 |
| Ride lifecycle | 1558 | 1516 |
| **Certification** | — | **2027** |
| **Dev harness `/dev/*`** | — | **2310** |
| Admin metrics (`onCall`) | 2073 | 2639 |
| Scheduled: sweep stale rides | 2182 | 2747 |
| Scheduled: monthly billing | 2327 | 2892 |

### Shared helpers (same names in both files)
`getPricing`, `haversineKm`, `calculatePassengerChargeCents`,
`getOrCreateCustomer`, `sendPushNotification`, `getUserPushToken`,
`getUserPushInfo`, `pushTo` (bilingual), `chargeAllPassengers`,
`payoutAllDrivers`, `chargeablePassengers`, `requireEnv`,
`representativeDriverDest`, `matchAvailabilityWindow`, `sweepStaleRidesImpl`.
Sandbox adds `grantCertification`, `sendStudentConfirmationEmail`,
`ageFromStripeDob`, `assertDevEnv`.

### Exports
```
functions/          api · getAdminMetrics · sweepStaleRides · monthlyBilling
functions-sandbox/  apiSandbox · getAdminMetricsSandbox · sweepStaleRidesSandbox · monthlyBillingSandbox
```

**Cutover landmine:** `functions/index.js:35-36` pins `TARGET_DB = devDb` and
`TARGET_STRIPE = stripeTest` for the *scheduled* jobs so they can never touch
production. Flip to `prodDb`/`stripeLive` at cutover.

---

## 9. Config & environment

- `constants/runtime-config.ts` — **read this before touching any config.**
  `required()` throws at startup on missing Firebase/Maps values. Also owns
  `firestoreDocumentUrl`, `apiFetch` (injects `X-App-Env`), `devLog`/`devWarn`,
  `isDev`, `socialClientIds`.
- `app.config.js` — pipes `process.env` into `extra`; native Maps keys.
- `eas.json` — per-profile env for cloud builds (development / preview /
  production). Local `expo start` uses `.env` instead.
- `.env` files: root (app), `functions/.env`, `functions-sandbox/.env`.
  All gitignored. See `DEV-PROD-SWITCHING.md`.
- Business config in `constants/`: `pricing.ts`, `cancellation.ts`,
  `ride-search.ts`, `rewards.ts`, `certifications.ts`, `sponsors.ts`,
  `events.ts`, `countdown-config.ts`, `force-update-config.ts`.
  `constants/pricing.ts` is **mirrored** in both servers' `DEFAULT_PRICING` —
  change all three together.
- i18n: `constants/translations/{en,fr}.ts` (~1030 lines each, kept parallel).

---

## 10. "I want to change X" index

| Task | Start here |
|---|---|
| Add a screen | `app/<name>.tsx` + register in `app/_layout.tsx` Stack |
| Change ride pricing | `constants/pricing.ts` **+** `DEFAULT_PRICING` in both servers **+** `config/pricing` doc |
| Change the dropoff-radius (payment) gate | `constants/ride-geo.ts` **+** `DROPOFF_CONFIRM_RADIUS_KM` in both servers; logic in `evaluateDropoff` / `dropoffReference` / `chargeablePassengers` |
| Add an API route | Both `functions/index.js` and `functions-sandbox/index.js`, then a `services/` wrapper |
| Change matching | `hooks/use-ride-recommendations.ts` + `utils/matching/` + server "Proximity matching tunables" |
| Add a user field | `types/models.ts` → `normalizeUserData` → `firestore.rules` |
| Touch payments | `services/walletService.ts` + server Wallet section + `context/WalletContext.tsx` |
| Add a translation | `constants/translations/en.ts` **and** `fr.ts` |
| Debug a ride | `utils/ride-logger.ts` (`rideLog`, in-memory buffer) → `devToolsScreen` |
| Test the ride flow solo | `devToolsScreen` + `services/devRideService.ts` + sandbox `/dev/*` |
| Change certifications | `constants/certifications.ts` + `app/certificationScreen.tsx` + sandbox `/cert/*` |
| Force users to update | `config/forceUpdate` doc; logic in `constants/force-update-config.ts` |

---

## 11. Invariants & gotchas

1. **Two servers, one change → two edits.** Verify with
   `diff <(grep -E '^app\.(get|post)\(' functions/index.js) <(grep -E '^app\.(get|post)\(' functions-sandbox/index.js)`.
   Note that this only catches *missing routes*. Behaviour can diverge inside a
   route that exists in both — which is exactly how `USE_LEGACY_MATCHING` ended
   up in LIVE only, giving dev builds a different matching algorithm than
   production for a full release. When touching dispatch/matching, diff the
   handler bodies, not just the route list.
2. **`rideScreen` = passenger, `riderScreen` = driver.**
3. **Call `invalidateRidesCache()`** after mutating a ride.
4. **`certifications` is server-authoritative — but only enforced on the dev DB.**
   `firestore.dev.rules:42-53` blocks client writes to the field; production
   `firestore.rules` has no such clause (the feature is still sandbox-only, and
   prod's `touchesFinancialFields()` guards Stripe/wallet fields only). Add the
   clause to `firestore.rules` at cutover.
5. **Firestore long-polling is mandatory** — `firebaseConfig.js` sets
   `experimentalForceLongPolling`; without it `onSnapshot` silently hangs on
   device. `initializeFirestore` must run before any `getFirestore()`.
6. **Named databases**: always pass the db id. A bare `getFirestore()` hits
   `(default)`, which is empty.
7. **Pricing is mirrored in three places** (app constant, both servers, Firestore doc).
   Same for `DROPOFF_CONFIRM_RADIUS_KM` (`constants/ride-geo.ts` + both servers).
7b. **A ride leg only bills if the server measured it in range.** `/rides/dropoff`
   evaluates the driver's fix against the passenger's destination and records
   `dropoffDistanceKm`; `/rides/finish` re-derives the charge set from that via
   `chargeablePassengers()`. Clients cannot write any of those fields — the
   `touchesRideMoneyFields()` deny-list in `firestore.rules` blocks it. Adding a
   new billing input means adding it to that list too.
8. **Design tokens are per-file** (`const C = {...}`) by convention — there is no
   global theme module beyond `constants/theme.ts` / `auth-theme.ts`.
9. **No test script.** `jest.config.js` exists (ts-jest, scoped to
   `utils/matching/__tests__/**`) and one test file
   (`utils/matching/__tests__/geometry.test.ts`), but `package.json` defines no
   `test` script — run it via `npx jest`. Only `expo lint` is wired up.
10. **`app/_layout.tsx` opens with ~115 lines of commented-out legacy layout.**
    Live code starts at the imports on line 116.
11. **A blank env var is not an absent one.** `fromEnv` in
    `constants/runtime-config.ts` now maps `""` → `undefined`, because every
    consumer defaults with `??`, which only falls through on null/undefined. A
    blank `EXPO_PUBLIC_API_BASE_URL=` in `.env` previously made `apiBaseUrl` the
    empty string, turning every Cloud Function call into an unfetchable relative
    URL under `expo start` — and `fetchAvailableDriverCount` reported that as
    "0 drivers". Prefer `required()`-style truthiness over `??` for new config.
12. **`driverSessions` has no TTL, no server sweep, and nothing reads
    `updatedAt`.** A driver who force-quits stays `status: "online"` forever.
    `hooks/use-driver-session.ts` now heartbeats and auto-offlines after 15 min
    backgrounded, but **only when `isDev`** — harmless today because broadcast
    mode never queries `driverSessions`. Drop the `isDev` gate and add a
    server-side staleness filter when `USE_LEGACY_MATCHING` flips back to `true`.
