# Environment Switching Guide

## Overview

| | App DB | Stripe keys | Backend DB |
|---|---|---|---|
| **Dev** | `uniliftdev` | test keys | `uniliftdev` |
| **Prod** | `uniliftdefault` | live keys | `uniliftdefault` |

Dev builds call the **SANDBOX** function (`apiSandbox`), which is hardwired to `uniliftdev`. Prod builds call the **LIVE** function (`api`), which serves both databases and switches on the `X-App-Env: dev` header the app sends in dev mode. Either way, **no manual backend changes or redeploys are needed when switching environments**.

> ### ⚠️ Push notifications are NOT isolated by environment
>
> The table above covers data. It does **not** cover push delivery. An Expo push
> token identifies a *device installation*, and one EAS project serves every
> environment — so sending to a token found in `uniliftdev` rings that real phone
> even though the phone is running the App Store build. Firebase **Auth is shared**
> too (one project, two databases), so any real account that has ever signed in
> against dev has a `uniliftdev/users/{uid}` doc holding their live token.
>
> A dev ride test therefore *can* page real users. This is why the broadcast is
> gated by the two default-deny config docs below — set those up before testing
> anything that dispatches.

---

## Switching the App (Frontend)

The single switch is `EXPO_PUBLIC_APP_ENV` in your `.env` file.

> **The committed default is now `production`.** A plain `expo start` therefore
> behaves like a shipped build: live database, live Stripe, no DEV badge, no dev
> menu. That is deliberate — the previous default was `dev`, which meant every
> local run showed developer-only surface and it was easy to mistake that for
> what users see. Switch to `dev` when you need the sandbox and the `/dev/*` ride
> harness, and switch back when you are done.

### → Go to DEV

Open `.env` and add this line anywhere:

```
EXPO_PUBLIC_APP_ENV=dev
```

Then restart Expo:

```bash
expo start --clear
```

**You'll know it worked when** the orange **DEV** badge appears in the top header next to "UniLift".

### → Go to PROD

Set the value explicitly — **do not delete the line**:

```
EXPO_PUBLIC_APP_ENV=production
```

Restart Expo:

```bash
expo start --clear
```

The DEV badge disappears. All reads/writes go to `uniliftdefault` and the backend uses live Stripe keys.

> `EXPO_PUBLIC_APP_ENV` must always be declared, and must be exactly `dev` or
> `production`. A missing or misspelled value **throws at startup** instead of
> quietly resolving to production. That is deliberate: the old behaviour was
> "absence means production", so any config slip silently connected the app to the
> live server and real user data.

---

## Building with EAS

For EAS cloud builds, the profile controls the environment — no `.env` changes needed.

| Command | Environment |
|---|---|
| `eas build --profile development` | Dev DB + test Stripe |
| `eas build --profile preview` | Prod DB + live Stripe |
| `eas build --profile production` | Prod DB + live Stripe |

All three profiles declare `EXPO_PUBLIC_APP_ENV` and `EXPO_PUBLIC_FIRESTORE_DATABASE_ID` explicitly in `eas.json`. Nothing depends on a key being omitted — keep it that way when adding a profile.

> **`.env` is not uploaded to EAS** (it is gitignored). Cloud builds read only the
> `env` block of the chosen profile, so a value that exists solely in `.env` will
> be absent in the build — and now fails loudly rather than defaulting to prod.

---

## Who receives a broadcast (automatic — nothing to configure)

`POST /requests/dispatch` fans out to users in whichever database it is handed.
Recipients are chosen from the database itself; there is **no allowlist to maintain**.

A user is notified when all of these hold:

1. `driverModeEnabled !== false` (absent counts as ON)
2. they have an `expoPushToken`
3. their `expoPushTokenEnv` matches the server's environment

That third rule is the one that matters, because the database split alone does not
give you isolation — see the warning at the top. It is asymmetric on purpose:

| | Untagged token | `"dev"` token | `"production"` token | Age check |
|---|---|---|---|---|
| **Dev** (`uniliftdev`) | ✗ excluded | ✓ | ✗ | must be < 14 days old |
| **Prod** (`uniliftdefault`) | ✓ allowed | ✗ excluded | ✓ | none |

- **Dev is strict.** An untagged token predates tagging and cannot be shown to
  belong to a dev build, so it is excluded. The 14-day recency check catches a
  device that ran a dev build once and has since gone back to the store build —
  its stale `"dev"` tag would otherwise ring the production app.
- **Prod is permissive.** Untagged tokens must keep working, because every user
  already on the App Store predates tagging. Recency deliberately does *not* apply:
  someone who hasn't opened the app in a month is still a valid recipient.

The client rewrites `expoPushTokenEnv` and `expoPushTokenUpdatedAt` on **every**
authenticated launch, so this self-populates. To make a test device eligible, just
open the app on a dev build while signed in.

**Debugging "my phone doesn't buzz":** long-press the **DEV** badge → *Dispatch
diagnostics* → **Run dispatch report**. `I'd be notified` is the headline answer,
and every other account is listed with the exact reason it was skipped. Read-only —
it sends no pushes. Remember you never receive your *own* request, so an end-to-end
push test needs a second account on a second device.

**Debugging the same thing on a PRODUCTION build.** There is no DEV badge and no
console there, so use the admin report instead — same eligibility rule, aggregate
counts only (production user rows are not something to enumerate):

```bash
npm run report:dispatch              # LIVE server / uniliftdefault
npm run report:dispatch -- --sandbox # SANDBOX server / uniliftdev
```

It signs in as a founder account and calls `POST /admin/dispatch-report`, which is
gated on the `admin` custom claim (`functions/scripts/set-admin-claims.js`) — a
403 means the claim is missing, or the account has not signed out and back in
since it was granted. Read-only: it sends no pushes and writes nothing.

The line to read first is `cap`: if it says **BLOCKED**, `config/broadcast` in
`uniliftdefault` has `prodEnabled: false` and production is notifying nobody.

### Optional prod rail — `uniliftdefault` → `config/broadcast`

```
{ prodEnabled: false }        // kill switch: production notifies nobody
{ maxRecipients: 1000 }       // custom cap (default 500)
```

Entirely optional — with no doc, production works and is capped at 500 recipients.
Re-read every ~60s, so flipping `prodEnabled` from the Firebase Console takes effect
without a redeploy, including for builds already installed on phones.

Both docs are read with a ~60s TTL, so edits from the Firebase Console take effect
without a redeploy. That also makes this the only kill switch that reaches builds
already installed on phones.

---

## Deploying the Backend (Cloud Functions)

The backend **automatically handles both environments** per-request. No `APP_ENV` toggle needed.

The only checklist before `firebase deploy --only functions`:

- [ ] `functions/.env` has all four Stripe keys set:
  - `STRIPE_SECRET_KEY_LIVE`
  - `STRIPE_PUBLISHABLE_KEY_LIVE`
  - `STRIPE_SECRET_KEY_TEST`
  - `STRIPE_PUBLISHABLE_KEY_TEST`
- [ ] `functions/.env` has `BILLING_SECRET` set
- [ ] Run `firebase deploy --only functions`

No broadcast config is required — recipient filtering is automatic (see above).

Deploy the **servers before the client**, so the guards are live before any build that
can trigger a dispatch:

```bash
firebase deploy --only functions:sandbox
firebase deploy --only functions:live
```

The same deployed backend serves both dev and prod clients correctly.

---

## Quick Reference

```
DEV  → EXPO_PUBLIC_APP_ENV=dev         in .env  →  expo start --clear
PROD → EXPO_PUBLIC_APP_ENV=production  in .env  →  expo start --clear
       (never delete the line — a missing value throws at startup)

Broadcast recipients are filtered automatically by expoPushTokenEnv —
nothing to configure. To make a test device eligible, just open the app
on a dev build while signed in. Check with:
  DEV badge (long-press) → Dispatch diagnostics → Run dispatch report

Backend deploy (no env changes needed):
  firebase deploy --only functions
```
