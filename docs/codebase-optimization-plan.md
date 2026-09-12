# UniLift — Codebase Optimization Proposal & Plan

Analysis of all three deployables (Expo app, LIVE server, SANDBOX server), a
verified dead-code inventory, and a phased plan to act on it.

**Analysed:** 33 332 lines of app code (138 files) + 5 714 lines of server code
(2 files). **Date:** 2026-08-24, `master` @ `1a0ad3f`.

---

## Implementation status — 2026-08-25

Findings **2–12 are implemented**. Finding **#1 (server de-duplication) was
deliberately not done** at the user's direction, so `functions/` and
`functions-sandbox/` still share ~2 430 identical lines.

| # | Finding | Status |
|---|---|---|
| 1 | Server de-duplication | **skipped by request** — a drift guard was added instead (`npm run check:server-drift`) |
| 2 | `/drivers/available` full scan | done — 60 s server cache + client poll 12 s → 30 s + backgrounding pause |
| 3 | Dead dependencies | done — 7 packages removed, node_modules 792 MB → 747 MB |
| 4 | Parked matching algorithm | done — extracted into `dispatchByProximity` / `countReachableByProximity` |
| 5 | Expo template subtree | done — 12 files + `components/ui/` removed entirely |
| 6 | Dead symbols | done — 4 dead files + 22 symbol blocks removed |
| 7 | REST unwrap duplication | done — `services/firestore-rest.ts`, 8 copies collapsed to 1 |
| 8 | Design tokens | done — `constants/palette.ts`, 37 files migrated (values verified identical) |
| 9 | Social-connect feature | done — **deleted** (linking path only; see note) |
| 10 | `sweepStaleRides` double query | done — one query reused; pass 3 kept, see below |
| 11 | Over-exported internals | done — 58 un-exported (2 documented mirrors kept) |
| 12 | Tests unreachable | done — `npm test` wired, 6 → 43 tests |

### Finding #9 — what was deleted, and what deliberately was not

The **linking (write) path** is gone: `connect-socials.tsx`, both hooks, the four
`/social/*` routes on both servers (248 lines each), the six OAuth secrets in
both `functions*/.env`, and the `EXPO_PUBLIC_*` client ids in `.env`,
`app.config.js`, `eas.json` and `runtime-config.ts`.

The **display (read) path was kept**, because it turned out to be live — a fact
the original analysis missed. Five screens render these fields today:

| Screen | Field shown |
|---|---|
| `app/riderScreen.tsx`, `app/rideScreen.tsx`, `app/acceptRideScreen.tsx`, `app/driverRequestsScreen.tsx` | `@instagramHandle` in the profile modal |
| `app/(tabs)/profile.tsx` | `facebookId` |

Those fields, their parsing in `components/userHelper.ts` / `services/userService.ts`,
and their `types/models.ts` declarations are all untouched, as is any data
already stored on user documents. The consequence to be aware of: **nothing can
populate them any more**, so they will simply be absent for every new user. Every
render site is already null-guarded, so this degrades silently rather than
breaking. Removing those five display sites is a separate, UI-visible change and
was left for a deliberate decision.

### Not completed, and why

- **Pass 3 of `sweepStaleRides`** (the dead `paymentStatus: "processing"` reset)
  is still in both servers. This plan's own precondition — verify no ride doc is
  stuck in that state — needs live Firestore credentials, which this session did
  not have. `functions-sandbox/scripts/check-stuck-payments.js` was added to run
  that check; when it reports 0 for both databases, delete the pass.
- **`expo-maps` removal needs a native rebuild.** The JS/config change is done and
  location permissions were verified to come from `ios.infoPlist` +
  `android.permissions` (not the plugin), but the ExpoMaps pod is still in
  `ios/Podfile.lock` until pods are reinstalled. Verify maps render on a device
  before shipping.

### Discovered during implementation

- **`readGeoPoint` has a latent coercion bug**, inherited verbatim from all eight
  per-service copies: `Number(null)` is `0`, which is finite, so
  `{ latitude: 46.8, longitude: null }` yields `{ 46.8, 0 }` instead of `null`.
  It **fails safe in billing** (a 0-longitude dropoff is thousands of km from any
  destination, so `evaluateDropoff` refuses to bill) but can misplace a map
  marker. Behaviour was **preserved, not changed** — it is pinned by a test and
  documented in `services/firestore-rest.ts`. Fixing it is a one-line change in
  one place now; it needs a deliberate decision.
- **The fare math drifts at `.5` boundaries** because of IEEE-754:
  `4.1 * 25` is `102.49999999999999`, so a 4.1 km ride costs 102 c, not 103 c.
  This is **correct to leave alone** — the server computes the authoritative
  charge with the identical expression, so both sides drift together and agree.
  Pinned by a test so nobody "fixes" one side into disagreement.
- `docs/terminal-commands.md` documented `/health`; the route is `/hello`. Fixed.

---

## Executive summary

| # | Finding | Size | Severity | Effort |
|---|---|---|---|---|
| 1 | Two servers share **2 430 verbatim-identical lines** | 2 430 L | **High** | M |
| 2 | `/drivers/available` full-scans `users` — polled **every 12 s** | O(N) per poll | **High** | S |
| 3 | Dead npm dependencies | **44.6 MB** | Medium | S |
| 4 | Unreachable legacy-matching branch behind a `false` flag | ~352 L | Medium | S |
| 5 | Expo starter-template subtree never wired in | ~300 L | Low | S |
| 6 | 36 dead exported symbols, incl. 4 fully dead files | ~850 L | Low | S |
| 7 | REST unwrap helpers redefined per file (`isRecord` ×8) | ~200 L | Medium | M |
| 8 | Design tokens copy-pasted into 38 files | 38 blocks | Low | M |
| 9 | Social-connect feature fully built, **zero UI entry point** | ~600 L + 4 routes | Medium | S |
| 10 | `sweepStaleRides` runs the same query twice per tick | 1 query/5 min | Low | S |
| 11 | 71 over-exported internals | — | Low | S |
| 12 | Jest configured but unreachable — no `test` script | — | Medium | S |

**Reclaimable outright: ~1 300 lines of source and 44.6 MB of dependencies,
with zero user-visible behaviour change.** A further ~930 lines (the parked
matching algorithm, the unwired social feature) are pending decisions rather
than deletion.

The two highest-value items are *not* the dead code. They are **#1** (the
duplication is a correctness hazard around money) and **#2** (the only finding
that gets worse as the user base grows — which is the stated goal of the product).

---

## Method, and what I did *not* trust

Every claim below was verified against the source rather than inferred. Three
traps I hit and corrected, listed because they will bite the next person who
runs a similar scan:

1. **BSD `sed` doesn't support `\?`.** My first pass used `sed 's/\.tsx\?$//'`
   to strip extensions; it silently no-opped, so *every file in the repo* looked
   unimported — including `AuthContext` and `rideServices`. Use `sed -E 's/\.tsx?$//'`.
2. **Platform variants are not dead.** `icon-symbol.ios.tsx` and
   `use-color-scheme.web.ts` have no importers by name because Metro resolves
   them from their base name. Never delete a `.ios.`/`.web.`/`.native.` file on
   importer count alone.
3. **Framework peer dependencies have no `import` statement.** `expo`,
   `react-native-reanimated`, `react-native-screens`, `react-native-gesture-handler`,
   `expo-font`, `expo-linking`, `expo-system-ui`, `react-dom`, `react-native-web`
   and `@react-navigation/*` all show zero direct references and are all
   **required**. They are excluded from finding #3.

I also separated **dead** (nothing references it anywhere) from **over-exported**
(used inside its own file — the fix is deleting the `export` keyword, not the
code) and from **built-but-unwired** (a complete, working feature with no entry
point — the fix is a product decision, not a deletion). Conflating these three
is how a "cleanup" removes a feature someone was about to ship.

---

## Finding 1 — The two servers are 2 430 identical lines *(High)*

```
functions/index.js          2 485 lines
functions-sandbox/index.js  3 229 lines
identical lines              2 430   ← 98% of LIVE, 75% of SANDBOX
diff: 802 added, 58 removed
```

Verified byte-identical across both files: `haversineKm`,
`calculatePassengerChargeCents`, `getOrCreateCustomer`, `sendPushNotification`,
`isEligibleRecipient`, `getBroadcastLimit`, `getPricing`, `settleAllUsers`,
`evaluateDropoff`, `chargeablePassengers`, `dropoffReference`,
`matchAvailabilityWindow`, `driverMotivationalBody`, `sweepStaleRidesImpl`, and
six money-critical constants.

### Why this is the top finding

The duplicated code **is the money and safety logic**. `evaluateDropoff` decides
whether a passenger is billed. `chargeablePassengers` decides who pays.
`isEligibleRecipient` decides whether a dev test can ring a real user's phone.
`settleAllUsers` moves actual money. A fix applied to one file and not the other
is a silent divergence in exactly the code where divergence is most expensive —
and it has already happened twice:

- `USE_LEGACY_MATCHING` existed in LIVE while SANDBOX lacked it, breaking dev
  dispatch for a release.
- `/requests/dispatch` and `/notifications/send` **still** differ today: SANDBOX
  reports real push-delivery outcomes, LIVE reports `true` unconditionally.

### The constraint any fix must respect

The duplication is **deliberate and buys a real property**: `functions/` is
frozen at what the shipped App Store binary expects, so sandbox work cannot
break production. A naive "merge into one codebase" throws that away. Do not do
it.

### Proposal — extract only the pure core, vendor it into both

~455 lines of the 2 430 are **pure, side-effect-free** functions with no
`db`, `stripe`, `req` or `express` dependency:

| Region (sandbox lines) | Lines | Contents |
|---|---|---|
| 58–253 | 196 | pricing defaults, push-eligibility predicates, `haversineKm` |
| 458–575 | 118 | push formatters, `sendPushNotification` |
| 1043–1105 | 63 | matching helpers + tunables |
| 1660–1716 | 57 | `dropoffReference`, `evaluateDropoff` |
| 2000–2020 | 21 | `chargeablePassengers` |

These are the highest-risk, easiest-to-extract lines in the repo. Route handlers
stay separate in both codebases — the freeze property is preserved exactly.

**Mechanism.** Firebase uploads each `source` directory independently, so a
shared folder outside both is *not* deployed. Two workable options:

- **(A) Predeploy vendoring — recommended.** Keep `shared/core.js` at the repo
  root; add a `predeploy` step to `firebase.json` that copies it into each
  codebase before upload. Zero runtime risk, no packaging changes, works with
  the existing gen-1/gen-2 mix. The copy is a build artifact and gets
  `.gitignore`d inside the function dirs.
- **(B) `file:` dependency.** `"@unilift/core": "file:../shared"`. Cleaner in
  principle, but `firebase-tools` handling of local file deps is fragile and
  would need validating against both codebases before committing to it.

**Add a drift guard regardless of which option is chosen** — a CI step or lint
rule asserting the route tables still match:

```bash
diff <(grep -E '^app\.(get|post)\(' functions/index.js) \
     <(grep -E '^app\.(get|post)\(' functions-sandbox/index.js)
```

**Also fix the known divergences while you are in there** (see finding #1
evidence above) — decide whether `notified` should count attempts or deliveries,
and make both servers agree. SANDBOX's honest count is the better behaviour.

---

## Finding 2 — `/drivers/available` full-scans `users` every 12 seconds *(High)*

The only finding that degrades as the product succeeds.

```
app/(tabs)/index.tsx:251     setInterval(refresh, 12000)
   └─ services/driverSessionService.ts:221  POST /drivers/available
        └─ functions-sandbox/index.js:1347  await db.collection("users").get()   ← unbounded
```

While the request-a-lift sheet is open, the client polls every 12 s, and **each
poll reads every document in the `users` collection.** The same unbounded scan
sits in `/requests/dispatch` (line 1206) and `/dev/dispatch-report` (line 2545).

Cost is `O(users × concurrent_sheets × 5/min)`. At 500 users with 20 sheets open
that is **50 000 document reads per minute**. This is fine today only because
the user base is small — and growing it is the entire point of the project.

Note this is a **direct consequence of `USE_LEGACY_MATCHING = false`** (finding
#4). The disabled proximity path used indexed queries (`driverSessions` where
`status == "online"`, `users` where `driverDays array-contains-any`); the
broadcast path that replaced it scans everything. The source comment is candid
about this — *"intentionally simple and non-scalable"*.

### Proposal, cheapest first

1. **Cache the eligible-recipient count server-side** (60 s TTL, keyed by env —
   the exact pattern `getPricing` and `getBroadcastLimit` already use in this
   file). Turns 5 scans/minute/client into 1 scan/minute total. **~20 lines, no
   behaviour change, no client change.** Do this first.
2. **Raise the client poll to 30 s** and stop polling when the sheet is not
   visible. One-line change in [app/(tabs)/index.tsx:251](../app/(tabs)/index.tsx#L251).
3. **Maintain a counter document** (`config/driverStats`) updated when a user
   toggles driver mode or refreshes a push token, so the stat is an O(1) read.
   Correct long-term fix; do it when #1 stops being enough.
4. **Add a `where("driverModeEnabled", "!=", false)` filter** to the scans so
   Firestore does the filtering. Requires a single-field index and careful
   handling of the absent-means-true convention that `isEligibleRecipient` relies
   on — so it is a real change, not a free win.

---

## Finding 3 — 44.6 MB of dead dependencies *(Medium)*

Zero references anywhere in `app/`, `components/`, `services/`, `hooks/`,
`utils/`, `constants/`, `context/`, `types/`, `app.config.js` or
`firebaseConfig.js`:

| Package | Size | Note |
|---|---|---|
| `lucide-react-native` | **34 MB** | Icon library; the app uses `@expo/vector-icons`/Ionicons |
| `react-native-paper` | **6.6 MB** | UI component library; CLAUDE.md explicitly states "No UI component library" |
| `leaflet` | **3.8 MB** | A *web* mapping library, in a React Native app |
| `openrouteservice-js` | 184 KB | The app calls the Google Directions API directly ([services/routeService.ts:26](../services/routeService.ts#L26)) |
| `polyline-encoded` | 60 KB | Google polylines are decoded inline |

Plus one that costs more than disk: **`expo-maps` is registered as a config
plugin** in [app.config.js:89](../app.config.js#L89) while every map screen
imports **`react-native-maps`** ([components/mapview.tsx:19](../components/mapview.tsx#L19)).
Two mapping stacks are linked into the native build; one is unused. Removing the
plugin shrinks the binary and removes a class of native-build confusion.

`expo-symbols` (156 KB) becomes dead once finding #5 is applied — its only
consumers are the dead `icon-symbol` files.

> Metro bundles by import graph, so these mostly do **not** inflate the JS
> bundle. The real costs are install time, CI time, lockfile churn, native build
> surface (`expo-maps`), and the ongoing "wait, do we use Paper?" tax on anyone
> reading `package.json`.

---

## Finding 4 — ~352 unreachable lines behind `USE_LEGACY_MATCHING = false` *(Medium)*

Set to `false` in both servers ([functions/index.js:1065](../functions/index.js#L1065),
[functions-sandbox/index.js:1087](../functions-sandbox/index.js#L1087)). Both
`/requests/dispatch` and `/drivers/available` take an early-returning broadcast
branch, leaving everything after it unreachable:

| Server | `/requests/dispatch` | `/drivers/available` | Total |
|---|---|---|---|
| `functions/` | lines 1176–1289 (113) | 1320–1383 (63) | 176 |
| `functions-sandbox/` | lines 1200–1313 (113) | 1346–1409 (63) | 176 |

Plus helpers reachable only from it: `matchAvailabilityWindow`,
`representativeDriverDest`, and the tunables `DRIVER_PROXIMITY_KM`,
`DEFAULT_DEST_RADIUS_KM`, `MIN_DIRECTION_MATCHES`.

**Recommendation: keep it, but make the cost visible.** This is not accidental
dead code — it is a designed algorithm parked behind a flag, and finding #2 is
the argument for turning it back on, not for deleting it. What it should not be
is *invisible*: it currently reads as live code to anyone skimming the dispatch
route.

Concretely: move the legacy path into a clearly-named function
(`dispatchByProximity()`) called from the flag branch, so the dead region is one
obvious block rather than 113 lines of fall-through. Then decide the flag's fate
on a date, not on vibes.

---

## Finding 5 — The Expo starter template was never removed *(Low)*

A self-contained, fully disconnected subtree — nothing outside it imports any of
it, and it imports nothing of yours:

```
app/modal.tsx                     29 L   renders literally "This is a modal"
components/themed-text.tsx        64 L
components/themed-view.tsx        14 L
components/hello-wave.tsx         19 L
components/external-link.tsx      25 L
components/haptic-tab.tsx         18 L
components/parallax-scroll-view.tsx  79 L
components/ui/collapsible.tsx     45 L
components/ui/icon-symbol.tsx     43 L
components/ui/icon-symbol.ios.tsx 32 L
hooks/use-theme-color.ts          21 L
constants/theme.ts                53 L   ← zero importers
                                 ~440 L  (components/ui/ empties entirely)
```

`hooks/use-color-scheme.ts` is **used** by `app/_layout.tsx` — keep it, and keep
its `.web.ts` variant.

Two more template leftovers: `scripts/reset-project.js` (wired to the
`reset-project` npm script) and `scripts/generate-monday-example.mjs` +
`scripts/verify-monday-fixture.mjs`, which reference `docs/monday-compiler/` —
**a directory that does not exist in this repo.** Those two are from an
unrelated project.

Deleting this subtree also removes the last consumer of `expo-symbols`.

---

## Finding 6 — 36 genuinely dead exported symbols *(Low)*

Nothing references these anywhere in the repo, including inside their own files.

**Four whole files are dead** — never imported, under either quote style:

| File | Lines | Note |
|---|---|---|
| `components/event-card.tsx` | **446** | Both exports unused. Easy to miss: a naive grep for `event-card` matches the very-much-alive `hype-event-card` |
| `components/dropdowns-sections.tsx` | 80 | |
| `components/checkout.tsx` | 68 | |
| `utils/detour-cache.ts` | 56 | All 4 exports dead |

> **`constants/auth-theme.ts` is *not* dead** — only its `authStyles` export is.
> `authColors` is imported by five files (`login`, `signup`, `countdown`,
> `countdown-confirmation`, `legal-terms-modal`). Delete the export, keep the file.

<details>
<summary>Full list (36)</summary>

| File | Symbol |
|---|---|
| `services/walletService.ts` | `verifyCanJoin` |
| `services/routeService.ts` | `getDetourKm` |
| `services/authService.ts` | `mapAuthError` |
| `services/userService.ts` | `updateUserLanguage`, `extractDriverSummary` |
| `services/rideServices.ts` | `deleteRide`, `requestToJoinRide`, `enrollInFutureRide` |
| `services/sponsorService.ts` | `fetchSponsorById` |
| `services/driverSessionService.ts` | `countOnlineDrivers` |
| `services/rideRequestService.ts` | `fetchMyRideRequests`, `fetchOpenRideRequests` |
| `hooks/use-social-connect.ts` | `useSocialConnect` — see #9 |
| `hooks/use-facebook-auth.ts` | `useFacebookAuth` — see #9 |
| `hooks/use-ride-recommendations.ts` | `recommendRides` |
| `hooks/use-notification-prompt.ts` | `useNotificationPrompt` |
| `utils/ride-logger.ts` | `getRideLogBuffer` |
| `utils/detour-cache.ts` | `detourCacheGet`, `detourCacheSet`, `routeExtensionCacheGet`, `routeExtensionCacheSet` |
| `utils/ride-lifecycle.ts` | `isRideLive`, `isRideScheduled`, `isRideJoinable` |
| `constants/pricing.ts` | `getRidePricing`, `calculateDriverROI` |
| `constants/auth-theme.ts` | `authStyles` |
| `constants/events.ts` | `PROMOTED_EVENTS` |
| `constants/theme.ts` | `Fonts` |
| `constants/typography.ts` | `FontRole` |
| `types/models.ts` | `QrBoardingToken` |
| `components/ui/collapsible.tsx` | `Collapsible` |
| `components/hello-wave.tsx` | `HelloWave` |
| `components/event-card.tsx` | `FeaturedEventCard` |
| `components/external-link.tsx` | `ExternalLink` |
| `components/haptic-tab.tsx` | `HapticTab` |

</details>

⚠️ **`utils/ride-lifecycle.ts` deserves a decision, not a delete.** Its
`RIDE_LIVE_WINDOW_MS` is a documented three-way mirror with both servers. The
predicates around it being unused suggests the client stopped doing lifecycle
checks locally — confirm that is intended before removing them.

---

## Finding 7 — No shared REST-unwrapping module *(Medium)*

The hybrid Firestore pattern (SDK for listeners, REST for reads/writes) is
documented in CLAUDE.md as the core access convention. There is **228 type-wrapper
unwrapping call sites across 8 service files and no shared helper**:

| Helper | Times independently defined |
|---|---|
| `isRecord` | **8** |
| `readString` | **6** |
| `readNumber` | **6** |
| `readGeoPoint` | 2 |
| `BASE_URL` / `USERS_BASE_URL` | 3 |
| `REQUEST_TIMEOUT_MS` | 2 |

Unwrap sites by file: `rideServices` 120, `driverSessionService` 33,
`rideRequestService` 28, `userService` 15, `sponsorService` 14, `eventService`
13, `notificationService` 3, `pricingService` 2.

**Proposal:** one `services/firestore-rest.ts` exporting `isRecord`,
`readString`, `readNumber`, `readBool`, `readGeoPoint`, `readTimestamp`,
`readArray`, plus the shared `BASE_URL` builders and timeout. Mechanical,
low-risk, and it makes `rideServices.ts` (1 289 lines, 26 exports — the largest
non-screen file) meaningfully smaller as a side effect.

---

## Finding 8 — Design tokens copy-pasted into 38 files *(Low)*

**38 files** each declare their own `const C = { ... }` palette. Raw hex literal
frequency across `app/` + `components/`:

```
#e09af7 ×64    #2d0015 ×57    #9ca3af ×52    #f3f4f6 ×51
#8938D5 ×48    #080810 ×41    #34d399 ×37    #fbbf24 ×34
#4b5563 ×33    #0f0f1e ×29    #13132a ×23    #a78bfa ×21
```

This is a *deliberate* convention per CLAUDE.md ("in-file constant objects rather
than a global theme file"), so this is a proposal to revisit it, not a bug
report. The cost is that a brand tweak is a 38-file change, and drift is already
visible (`#8938D5` is the only capitalised hex — a copy that diverged).

**Suggested middle path** that does not require rewriting 38 screens: create
`constants/palette.ts` with the ~12 recurring tokens, then have each screen's
`const C` *reference* them (`const C = { bg: P.bg, accent: P.accent, ... }`).
Screens keep local naming and per-screen additions; the source of truth moves to
one file. Migrate opportunistically, not in one sweep.

Two untracked files — `constants/typography.ts` and `hooks/use-responsive.ts` —
appear to be the beginning of exactly this consolidation. Worth finishing
deliberately rather than leaving half-adopted.

---

## Finding 9 — The social-connect feature is complete and unreachable *(Medium)*

This is **not dead code — it is finished work with no door into it.** Every layer
exists:

| Layer | Status |
|---|---|
| `components/profile/connect-socials.tsx` (264 L) | built · **rendered nowhere** |
| `hooks/use-social-connect.ts` (177 L) | built · never called |
| `hooks/use-facebook-auth.ts` (138 L) | built · never called |
| Server `/social/link/:provider`, `/social/unlink/:provider`, `/social/link-facebook`, `/social/unlink-facebook` | deployed on **both** servers |
| `SPOTIFY_*`, `TIKTOK_*`, `INSTAGRAM_*` secrets | provisioned in both `.env` files |
| `EXPO_PUBLIC_*_APP_ID` client ids | wired through `runtime-config.ts` |

Given the product goal of a "social-media-like experience", this is likely an
oversight rather than an abandonment. **This needs a product decision, and it is
the cheapest feature launch available** — plausibly a single `<ConnectSocials />`
render in `app/(tabs)/profile.tsx` or `profileSettings.tsx`.

If the answer is "not now", say so in a comment at the top of
`connect-socials.tsx` so the next audit doesn't re-litigate it.

---

## Finding 10 — `sweepStaleRides` queries the same collection twice *(Low)*

Pass 2 ([line 3104](../functions-sandbox/index.js#L3104)) and pass 5
([line 3146](../functions-sandbox/index.js#L3146)) each run
`rides.where("status", "==", "planned").get()` — the identical query, twice per
tick, every 5 minutes, on both servers. Fetch once, iterate twice. ~4 lines.

While there: **pass 3 is confirmed dead.** Nothing writes
`paymentStatus: "processing"` any more — it was the non-atomic lock held by the
removed `/rides/complete`. It already carries a `TODO: delete once no ride doc
has paymentStatus == "processing"`. Run the check, then delete it.

`/dev/reset` also updates documents in a sequential `for` loop
([lines 2923, 2935](../functions-sandbox/index.js#L2923)) — should be a
`batch()`. Dev-only, so low priority.

> `settleAllUsers`'s sequential loop is **intentional** — it makes Stripe calls
> and parallelising it invites rate limiting. Leave it.

---

## Finding 11 — 71 over-exported internals *(Low)*

Symbols exported but only used within their defining file. `export` on these
widens the API surface, defeats dead-code detection, and blocks bundler
tree-shaking. The fix is deleting the keyword. Best done opportunistically while
touching each file, not as a dedicated PR.

*(Example: `REWARDS` in `constants/rewards.ts` is exported but consumed only by
`getRewardGroups` in the same file — the file itself is very much alive.)*

---

## Finding 12 — Tests exist but cannot be run *(Medium)*

```js
// jest.config.js
testMatch: ["**/utils/matching/__tests__/**/*.test.ts"]
```

Jest, ts-jest and `@types/jest` are installed. One test file exists
(`utils/matching/__tests__/geometry.test.ts`, 74 lines). **`package.json` has no
`test` script**, so nothing runs it — CLAUDE.md's "No test runner is configured"
is half-right, and `docs/dev-server.md` inherited that claim from me.

Add `"test": "jest"`. Then note that the `testMatch` glob covers only
`utils/matching/` — the money logic (`evaluateDropoff`, `chargeablePassengers`,
`calculatePassengerChargeCents`, `isEligibleRecipient`) has **zero** coverage.
Those are pure functions with no I/O. They are the easiest things in this
codebase to test and the most expensive to get wrong — and after finding #1 they
would live in one shared module, testable once for both servers.

---

## The plan

Ordered so that each phase is independently shippable and the risky work happens
after the safety net exists.

### Phase 0 — Make it runnable *(½ day, no risk)*

1. Add `"test": "jest"` to `package.json`.
2. Add the route-table drift `diff` as a CI check or npm script.

*Rationale: everything after this is safer with a way to verify it.*

### Phase 1 — Pure deletion *(1 day, near-zero risk)*

3. Delete the Expo template subtree (#5) — 12 files, ~440 L.
4. Delete `app/modal.tsx`, `scripts/generate-monday-example.mjs`,
   `scripts/verify-monday-fixture.mjs`.
5. Delete the four dead files — `components/event-card.tsx` (446 L),
   `components/dropdowns-sections.tsx`, `components/checkout.tsx`,
   `utils/detour-cache.ts` — and the remaining scattered dead symbols (#6).
   **Except**: the `ride-lifecycle` predicates (pending the decision noted
   there), and keep `constants/auth-theme.ts` itself — drop only `authStyles`.
6. Remove `lucide-react-native`, `react-native-paper`, `leaflet`,
   `openrouteservice-js`, `polyline-encoded`, `expo-symbols` (#3).
7. Remove the `expo-maps` plugin from `app.config.js` **and rebuild natively** —
   this one touches the native build, so verify a dev build boots and maps render
   before merging.

*Verify: `expo lint`, both function lints, a dev build on device.*

### Phase 2 — The scaling fix *(1 day, low risk, highest user-visible value)*

8. Add the 60 s TTL cache to the eligible-recipient count (#2.1) in **both**
   servers.
9. Raise the client poll 12 s → 30 s and pause it when the sheet is hidden (#2.2).
10. Fix the `sweepStaleRides` double query and delete dead pass 3 (#10).

*Verify: `/dev/dispatch-report` before and after — the recipient set must be
identical. Watch `firebase functions:log` for read volume.*

### Phase 3 — De-duplicate the servers *(2–3 days, medium risk — the careful one)*

11. Extract the ~455 pure lines into `shared/core.js` (#1).
12. Wire predeploy vendoring in `firebase.json` (option A).
13. **Write tests for the extracted money logic first** — `evaluateDropoff`,
    `chargeablePassengers`, `calculatePassengerChargeCents`,
    `isEligibleRecipient`. This is the whole reason Phase 0 comes first.
14. Reconcile the two known divergences (`notified` counting, `/notifications/send`
    return shape); adopt SANDBOX's honest reporting in both.
15. Deploy **sandbox first**, exercise the `/dev/*` harness end-to-end, then live.

*This is the phase to not rush. Deploy order matters: servers before client.*

### Phase 4 — Structural, opportunistic *(ongoing)*

16. `services/firestore-rest.ts` and migrate services onto it (#7), largest file
    first (`rideServices.ts`).
17. `constants/palette.ts`; migrate screens as they are touched (#8).
18. Drop `export` from the 71 internals as files are edited (#11).
19. Decide the fate of `USE_LEGACY_MATCHING` (#4) and refactor the branch into a
    named function either way.
20. **Product decision on social-connect (#9)** — wire it up or document the
    deferral.

---

## Guardrails — what not to do

- **Do not merge the two server codebases into one.** The duplication is the
  price of the freeze property that keeps sandbox work from breaking the shipped
  App Store build. Extract shared *helpers*; keep the route handlers apart.
- **Do not delete `.ios.` / `.web.` / `.native.` files on importer count.**
- **Do not remove a dependency because nothing imports it** — check the framework
  peer list in *Method* first.
- **Do not parallelise `settleAllUsers`.** Stripe rate limits.
- **Do not touch the three-way mirrored constants** (`DROPOFF_CONFIRM_RADIUS_KM`,
  `RIDE_LIVE_WINDOW_MS`, pricing defaults, `CONFIRM_WINDOW_MS`) without changing
  all copies together. Phase 3 is what finally makes that a single edit.
- **Do not delete `use-color-scheme.ts`** — it is used by `app/_layout.tsx`, even
  though its template siblings are dead.

---

## What is already in good shape

Worth recording, so a future cleanup doesn't go looking here:

- **Translations are clean.** 39 top-level key groups, every one referenced,
  `en.ts` and `fr.ts` in **perfect key parity** (empty diff) across 2 169 lines.
- **Logging discipline is good.** Zero un-gated `console.log` in shipped paths —
  everything goes through the `devLog`/`devWarn` no-ops from `runtime-config`.
- **No orphan helper functions in either server.** Every declared function is
  referenced.
- **Route-level auth is uniform.** Every route except the five intentionally
  public ones is wrapped in `authenticate`, and no route trusts a client-supplied
  user id.
- **Security rules genuinely back the server-authoritative design** — `rides` is
  client-writable only for the `driverLocation` telemetry field.
