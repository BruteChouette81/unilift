# Pre-launch security & correctness audit

Findings from the adversarial review of `functions/index.js`, both rule files,
`storage.rules`, `app.config.js` and the client services that call them — and what
was done about each. Severity: **C** critical (exploitable now), **H** high (money
silently lost, or a process that does not work), **M** medium, **L** low.

Everything below is **fixed in the working tree** unless the status says otherwise.

---

## 1 · Accounts, Firestore, Firebase

| # | Sev | Finding | Status |
|---|---|---|---|
| 1.1 | C | `users/{uid}` was `allow read: if isSignedIn()`, which governs `list` too — any account could enumerate the collection and read every user's email, home address, birth date, card last4, Stripe ids, push token and balances | **Fixed.** Owner-only. Display fields projected into `users/{uid}/public/profile` by the `mirrorPublicProfile` trigger |
| 1.2 | C | `ratings`, `ratingWeigth`, `xp`, `ridesCompleted` were client-writable — a user could PATCH themselves a 5-star, 500-ride profile | **Fixed.** Added to the rules' server-only set, and the fields now live on a document clients cannot write |
| 1.3 | H | `rides/{id}` is world-readable to signed-in users and carried `qrToken` — a passenger could read the boarding nonce and self-board without meeting the driver | **Fixed.** Nonce moved to `rides/{id}/private/qr`, `read, write: if false` |
| 1.4 | H | `storage.rules` `profiles/{fileName}` was `allow write: if isSignedIn()` — any user could overwrite any avatar, any size, any content type | **Fixed.** Path keyed on uid, owner-only, 5 MB and `image/*` limits |
| 1.5 | H | `/account/delete` left the Connect account (bank details + SIN), unsettled balances, queued payout rows and the Storage avatar; a queued payout for a deleted user wedged the sweeper forever | **Fixed.** Refuses while money or a ride is in flight; deletes Connect account, avatar, public profile, payout rows |
| 1.6 | M | `rideRequests` update rule guarded only `passengerId` — the owner could flip a matched request back to `open` | **Fixed.** `status`, `matchedDriverId`, `matchedRideId`, `matchedAt`, `rejectedDrivers`, `quotedFareCents`, `lastDispatchAt` are server-only |
| 1.7 | M | No Firebase App Check | **Open — console work.** See below |
| 1.8 | M | No email verification; password policy is client-side only | **Open — console work.** See below |
| 1.9 | L | Stripe customers created with no email or name | **Fixed** |

## 2 · Stripe, Connect and the money path

| # | Sev | Finding | Status |
|---|---|---|---|
| 2.1 | C | **Fare was unvalidated on both ends.** `/rides/finish` priced `passengerPickups[pid] → ride.destinationCoords`, and in a Flow A accept that destination is whatever the **driver** put in the request body — a point 1 000 km away billed the passenger hundreds of dollars. The dropoff radius gate did not catch it: it measures against `passengerDropoffs`, a different field. Symmetrically the **passenger** writes `rideRequests.origin`, so setting it beside the destination made any ride cost the $1 minimum, defrauding the driver | **Fixed.** `legDistanceKm()` prices the passenger's own pickup → their own dropoff — the same pair the radius gate uses. `/requests/dispatch` writes a server-computed `quotedFareCents`; `/rides/finish` clamps to `quote × 1.5` with a $150 absolute ceiling and records `clampedBy` on the ledger row |
| 2.2 | C | `POST /notifications/send` took an arbitrary `uid`, `title`, `body` from any authenticated caller with no relationship check — and had no client callers. With 1.1 making uids enumerable, a push-phishing cannon | **Fixed.** Route and `getUserPushToken` deleted |
| 2.3 | H | `settleAllUsers` read counters outside the transaction then blind-zeroed them inside — a ride finishing mid-settlement was wiped, never charged, never paid | **Fixed.** `FieldValue.increment(-charges)` / `increment(-earnings)` |
| 2.4 | H | Cancellation fees write `pendingChargeCents` from the client, which the hardened rules deny | **Latent, not active.** `CANCELLATION_FEES` are all `0` today, so `applyCancellationChargeToUser` returns before writing. It becomes a live bug the moment a non-zero fee is set. **Left as-is and documented** — see Open items |
| 2.5 | H | Payouts could exceed collected funds — `availableEarningsCents` is credited regardless of whether counterparty charges succeeded | **Bounded, not eliminated.** The sweeper transfers only against the real Stripe balance and stops short when insufficient, so no money can leave. An `earnings_available` ledger row now makes the gap auditable |
| 2.6 | M | QR boarding was not proof of presence | **Fixed** with 1.3 |
| 2.7 | M | The dropoff fix is self-reported by the driver, with no cross-check | **Fixed.** Compared against `ride.driverLocation`; a disagreement beyond 10 km falls back to telemetry and records `dropoffDisputed` |
| 2.8 | M | Failed settlements were silent | **Fixed.** Push on `no_payment_method`, `not_succeeded` and `requires_action` |
| 2.9 | M | `/rides/cancel` worked on a started ride with boarded passengers, erasing delivered legs | **Fixed.** 428 once anyone has boarded — finish the ride instead |
| 2.10 | L | `seats` on accept was unvalidated | **Fixed.** Clamped to 1–8 |
| 2.11 | L | `/rides/finish` `tx.update` on a deleted passenger threw and failed the whole ride | **Fixed.** `set(..., { merge: true })` |

## 3 · Scheduled jobs, matching, Google Maps

| # | Sev | Finding | Status |
|---|---|---|---|
| 3.1 | C | The Google Maps key shipped in the JS bundle and was used for Directions, Geocoding, Place Autocomplete and Place Details. Google's Android/iOS app restrictions **do not apply to Web Service APIs** — only IP restriction does, which a phone cannot satisfy. Extractable and billable by anyone | **Fixed.** Four authenticated `/maps/*` proxy routes hold an IP-restricted `GOOGLE_MAPS_SERVER_KEY`; the key is out of `extra`. Native SDK keeps its own bundle-restricted key |
| 3.2 | H | `monthlyBilling` and `sweepStaleRides` had no `timeoutSeconds` → killed at the 60 s default mid-run | **Fixed.** 540 s / 512 MiB on all three jobs |
| 3.3 | H | `sweepStaleRidesImpl` ran four unbounded queries and `Promise.all`ed a write plus a push over every result | **Fixed.** `.limit(SWEEP_BATCH)` and sequential batches |
| 3.4 | H | Sweep passes were not transactional — overlapping runs double-expired and double-pushed | **Fixed.** `claimStale()` re-checks inside a transaction; exactly one run wins |
| 3.5 | H | **Driver-session seat leak.** `/requests/accept` decremented `driverSessions.seatsAvailable` and nothing ever restored it — drivers silently went offline | **Fixed.** `releaseSessionSeats()` wired into reject-driver, leave, cancel and sweep passes 2 and 5 |
| 3.6 | H | `/requests/dispatch` was unthrottled — one account could scan `users` and push 500 devices in a loop | **Fixed.** 60 s cooldown, max 5 dispatches per request, open-status check |
| 3.7 | H | Broadcast dispatch sent the requester's full name and exact pickup/destination labels to up to 500 strangers | **Fixed.** First name and coarse locality in the push; the accept screen reads precise labels from the request document |
| 3.8 | M | `/rides/rate` rounded the average to an integer and fed it back in, so ratings drifted upward. **Separately: the client read `rating` while the server wrote `ratings`, so star ratings never rendered anywhere** | **Fixed.** `ratingSum` / `ratingCount` with a derived float, legacy values migrated; field name unified in the public profile |
| 3.9 | M | `/drivers/available` full-collection scan | **Accepted.** Already cached 60 s per instance |
| 3.10 | L | Sweep pass 3 was dead code | **Removed** |
| 3.11 | L | No CORS, security headers or rate limiting | **Fixed.** Baseline headers plus a per-caller limiter (240/min), dependency-free |

---

---

## 4 · Account creation (added 2026-09-10)

Not part of the pre-launch audit — a later pass, prompted by asking whether two
accounts could share an email.

| # | Sev | Finding | Status |
|---|---|---|---|
| 4.1 | H | **`users/{uid}.email` was client-written free text.** The owner rules blocked money, certifications and reputation but not `email`, so any user could PATCH their own profile to hold somebody else's address — two profiles carrying one email, trivially | **Fixed.** `emailMatchesToken()` in both rules files: a client may only write the address in its own ID token, compared case-insensitively. Gated on `touchesEmail()` so legacy users whose stored address drifted are not locked out of editing anything else |
| 4.2 | H | **Account creation never reached the servers.** `createUserWithEmailAndPassword` runs client-side, so "one account per mailbox" rested entirely on the client canonicalising first — advisory only, since the API key ships in the bundle and `accounts:signUp` is a public endpoint | **Fixed.** `beforeUserCreated` (`functions/identity.js`) canonicalises server-side and claims `emailIndex/{canonical}` in a transaction. Sees the password path, the Apple path and the raw REST endpoint alike, before the auth record exists. Fails **closed** |
| 4.3 | M | **The Apple path never canonicalised.** `signInToFirebaseWithApple` passes only an ID token, so whatever address Apple asserts became the auth email verbatim — `John.Doe@Gmail.com` via Apple and `johndoe@gmail.com` via password were two accounts | **Fixed** by 4.2, which sees Apple too. The profile write now stores the token-backed address so it satisfies 4.1; the canonical form lives in the index |
| 4.4 | M | **`+tag` was stripped on every domain.** On a domain without sub-addressing `john+doe@ulaval.ca` is undeliverable, and stripping the tag minted an account under `john@ulaval.ca` — a real mailbox belonging to someone else, proving control of nothing, with password-reset mail going to that person. On a school domain it also squats an address Student certification treats as proof of enrolment | **Fixed.** Stripping is gated to providers known to implement it. Restores an alias hole on unlisted domains, which is the lesser problem: those addresses cannot receive mail, so the accounts cannot receive a reset either, and email verification (1.8) closes it properly |
| 4.5 | M | No limit on accounts per device | **Fixed, with a stated ceiling.** `POST /device/register` claims a slot in a transaction against a Keychain/SSAID-backed install id and deletes the just-created account over the cap. `POST /device/check` is an advisory pre-check. **The id is client-supplied**, so a modified build can forge it and the REST endpoint sends none — this stops real users and casual abuse, not a determined attacker. App Check (1.7) is what would close it |
| 4.6 | L | Every Apple login blanked the user's saved name — the upsert masked `name` unconditionally, an updateMask path with an empty value is a write, and Apple accounts never get a `displayName` | **Fixed.** Only fields that actually have a value are masked |

**Deliberately not done, and why:** existing duplicate-mailbox accounts were not
audited or migrated. The index therefore starts empty, so a legacy account's
mailbox is unprotected until something claims it — `beforeUserSignedIn` writes
the entry on next login, fail-open and log-only on collision, so coverage grows
without a migration. **The guarantee is airtight for accounts created after this
ships, and for legacy accounts from their next login onward.** Dormant legacy
duplicates stay dormant.

**Also deliberate:** deleting an account releases both the email claim and the
device slot, which makes create-delete-repeat a bypass of the cap. That was a
product decision. `deviceAccounts.everCreated` is never decremented, so the
bypass is visible if it starts being used, and `/account/delete` already refuses
while money or a ride is in flight, so the loop is not free.

**Prerequisite:** 4.2 needs Firebase Auth upgraded to Identity Platform. Until
that is done in the console the blocking functions are inert — unregistered
blocking functions never fire — and 4.1, 4.4, 4.5 and 4.6 stand on their own.

---

## Open items

Three things could not be closed in code.

1. **Firebase App Check** (1.7) — console configuration plus a client SDK addition.
   The rules now limit what a stolen API key gets you, but App Check is what makes
   "only the real app" enforceable. Enable App Attest and Play Integrity, enforce on
   Firestore, Storage and the callable, then send the header from `apiFetch` and
   verify it in `authenticate`.

2. **Email verification and a server-side password policy** (1.8) — Identity
   Platform console. `utils/passwordPolicy.ts` is advisory only; Firebase's server
   minimum is 6 characters and the REST signup endpoint bypasses the UI.

3. **Cancellation fees** (2.4) — the fees are `0`, so nothing is broken today. Before
   setting a non-zero value in `constants/cancellation.ts`, move the charge to a
   server route: the client write to `pendingChargeCents` is denied by the rules and
   would throw *after* the ride mutation, leaving a half-completed cancel.

---

## Regression tests

`functions/__tests__/fare-guardrails.test.ts`, `audit-regressions.test.ts`,
`account-firewall.test.ts` and `email-identity.test.ts` — covering the actual
attacks: the inflated-destination fare, the quote clamp,
the public-profile allowlist (asserting each PII field is absent), rating drift,
broadcast de-identification, and dropoff corroboration. `npm test` runs them.

`account-firewall.test.ts` pins the device-id guard (a `deviceId` becomes a
Firestore document id, so a path separator has to be refused before it gets
there), the slot decision including its idempotency, and the mailbox claim.
`email-identity.test.ts` exists because the canonicaliser is duplicated —
`functions/` is CommonJS and cannot import the TypeScript module — and asserts
the two copies agree over a shared fixture list, so a change to one fails until
the other follows.

`scripts/check-server-drift.sh` now also pins every new safety constant across both
servers, so a value that drifts means one of them is still exposed.
