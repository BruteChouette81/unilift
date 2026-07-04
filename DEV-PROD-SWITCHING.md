# Environment Switching Guide

## Overview

| | App DB | Stripe keys | Backend DB |
|---|---|---|---|
| **Dev** | `uniliftdev` | test keys | `uniliftdev` |
| **Prod** | `uniliftdefault` | live keys | `uniliftdefault` |

The app sends an `X-App-Env: dev` header on every backend request when in dev mode. The Cloud Functions read that header per-request and automatically route to the dev Firestore database and test Stripe keys — **no manual backend changes or redeploys needed when switching environments**.

---

## Switching the App (Frontend)

The single switch is `EXPO_PUBLIC_APP_ENV` in your `.env` file.

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

### → Go to PROD (default)

Remove the line (or comment it out):

```
# EXPO_PUBLIC_APP_ENV=dev
```

Restart Expo:

```bash
expo start --clear
```

The DEV badge disappears. All reads/writes go to `uniliftdefault` and the backend uses live Stripe keys.

---

## Building with EAS

For EAS cloud builds, the profile controls the environment — no `.env` changes needed.

| Command | Environment |
|---|---|
| `eas build --profile development` | Dev DB + test Stripe |
| `eas build --profile preview` | Prod DB + live Stripe |
| `eas build --profile production` | Prod DB + live Stripe |

> Replace `<your-stripe-test-key>` in `eas.json` → `development.env.EXPO_PUBLIC_STRIPE_PUBLISHABLE_KEY` with your actual Stripe test publishable key (starts with `pk_test_`).

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

That's it — the same deployed backend serves both dev and prod clients correctly.

---

## Quick Reference

```
DEV  → add    EXPO_PUBLIC_APP_ENV=dev  to .env  →  expo start --clear
PROD → remove EXPO_PUBLIC_APP_ENV=dev  from .env →  expo start --clear

Backend deploy (no env changes needed):
  firebase deploy --only functions
```
