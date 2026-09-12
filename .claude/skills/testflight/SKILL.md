---
name: testflight
description: Ship the current working-tree state of the UniLift app to the user's iPhone via TestFlight, or push a fast OTA update to an already-installed TestFlight build. Use when asked to "push to TestFlight", "put this on my phone", "ship what I'm testing", "build for my device", "OTA this", or to sync env vars into the Expo/EAS build.
---

# Ship the current app state to TestFlight

Gets whatever is in the working tree onto the user's physical iPhone without Expo Go
(which cannot run this app's native modules anyway — Stripe, expo-maps, Apple Sign-In).

Two delivery paths. Pick the cheap one whenever it is correct:

| Path | Command | Time | Delivers |
|---|---|---|---|
| **OTA** | `eas update --branch testflight` | ~60s | JS, TS, assets, translations |
| **Native build** | `eas build --profile testflight --platform ios` | 20-40 min + 5-15 min ASC processing | everything, incl. native config |

## Arguments

- *(none)* — auto-detect OTA vs native build
- `--build` — force a full native build
- `--ota` — force an OTA update
- `--prod` — use the `production` profile instead (LIVE backend + **live Stripe**); for
  genuine pre-release checks only. Always warn the user this touches real money and
  real user data before running it.
- `--sync-env` — reconcile env vars only, ship nothing

## The `testflight` profile

Defined in [eas.json](../../../eas.json). It deliberately mirrors the user's local
`.env` dev setup so TestFlight behaves like what they run in the terminal:

- `EXPO_PUBLIC_APP_ENV=dev` → `uniliftdev` Firestore DB, `apiSandbox` Cloud Function,
  **TEST** Stripe keys (`constants/runtime-config.ts` derives all three from this one flag)
- `environment: "development"` → pulls the EAS-hosted vars, including the **secret**
  `GOOGLE_MAPS_API_KEY`. Do not change this to `preview` — the `preview` environment on
  EAS is empty, and `GOOGLE_MAPS_API_KEY` is `required()` at runtime, so the app would
  throw on launch.
- `channel: "testflight"` → OTA updates stay off the `production` and `preview` channels
- `ios.autoIncrement: true` + `cli.appVersionSource: "remote"` → EAS owns the build number

The live Stripe key and `EXPO_PUBLIC_FIRESTORE_DATABASE_ID` are intentionally **absent**
from this profile. Never add them.

## Procedure

### 1. Preflight

```bash
eas whoami                      # expect brutechouette81-2, with brutechouette81 in Accounts
git status --short              # report uncommitted files, but do NOT block on them
```

EAS uploads the **working tree**, not HEAD, so uncommitted changes do ship. Say so
explicitly rather than silently building dirty state.

### 2. Decide OTA vs native build

Read `.claude/testflight-state.json` (`lastBuildSha`, `lastBuildVersion`, `profile`).
Force a **native build** if the file is missing, or if any of these changed since
`lastBuildSha`:

`app.config.js` · `package.json` · `eas.json` · `GoogleService-Info.plist` ·
`google-services.json` · icon/splash assets under `assets/images/` · the `version` field

Otherwise take the **OTA** path.

```bash
git diff --name-only <lastBuildSha> HEAD; git status --porcelain   # union of both
```

### 3a. OTA path

`runtimeVersion` policy is `appVersion`, so an update only reaches installed builds whose
version **equals** the current `version` in `app.config.js`. Verify before publishing:

```bash
node -e "console.log(require('./app.config.js')({config:{}}).version)"
eas update --branch testflight --message "<one-line summary of the change>"
```

If the installed TestFlight build is on a different version, the OTA silently reaches
nobody — fall through to a native build instead.

Tell the user to **force-quit and reopen** the app; `fallbackToCacheTimeout: 0` means the
update is applied on the next cold start.

### 3b. Native build path

```bash
eas build --profile testflight --platform ios --non-interactive --auto-submit
```

Run it with `run_in_background: true` and report the build URL immediately — do not block
for 30 minutes. Poll with `eas build:list --platform ios --limit 1 --non-interactive`.

`--auto-submit` requires both of these exported in the user's shell (see Setup below).
If they are unset, drop `--auto-submit`, build anyway, and hand the user:

```bash
eas submit --profile testflight --platform ios --latest
```

On success, write `.claude/testflight-state.json`:

```json
{ "lastBuildSha": "<git rev-parse HEAD>", "lastBuildVersion": "1.3.4",
  "lastBuildNumber": "<from build:list>", "profile": "testflight",
  "builtAt": "<ISO timestamp>" }
```

### 4. `--sync-env`

Two stores, and they are **not** interchangeable:

| Store | Command | Use for |
|---|---|---|
| `eas.json` `env` block (committed, plaintext) | edit the file | publishable values: Firebase config, `pk_test_`, Facebook app id, API base URL |
| EAS-hosted env vars | `eas env:create/update --environment development` | real secrets: `GOOGLE_MAPS_API_KEY` |

```bash
eas env:list development        # note: this command rejects --non-interactive
eas env:create --environment development --name NAME --value "…" --visibility secret
```

**Precedence, verified:** when a name exists in both, the eas.json `env` block wins.
Confirm any resolution question with `eas config --profile testflight --platform ios`,
which prints exactly which vars came from where.

Always show the user a diff and get confirmation before writing. Never copy a `pk_live_`
key into the `testflight` profile.

## Build numbers

`cli.appVersionSource` is `remote`, so EAS owns the iOS build number — `app.config.js`
has no `ios.buildNumber` and should not get one. The counter was initialized to **78**
(App Store Connect already had builds up to 77; every pre-existing EAS build was
number 1, which would have been rejected as a duplicate). `autoIncrement` bumps it per
build. Inspect or correct with:

```bash
eas build:version:get -p ios -e testflight
eas build:version:set -p ios -e testflight    # interactive — needs a real TTY
```

## Setup the user must do once

For non-interactive `--auto-submit`, add to `~/.zshrc`:

```bash
export EXPO_APPLE_ID="<their Apple ID email>"
export EXPO_APPLE_APP_SPECIFIC_PASSWORD="xxxx-xxxx-xxxx-xxxx"
```

The app-specific password comes from appleid.apple.com → Sign-In and Security →
App-Specific Passwords. Keeping both in the shell rather than in `eas.json` means no
personal credential is committed. `ascAppId` (`6755918549`) is already in the repo.

## Warn the user about

- **Push notifications are not environment-isolated.** Per
  [DEV-PROD-SWITCHING.md](../../../DEV-PROD-SWITCHING.md), one EAS project and one shared
  Firebase Auth back both envs. A dev-env TestFlight build registers tokens tagged
  `expoPushTokenEnv: dev`; only server-side filtering and the `config/broadcast` kill
  switch keep test broadcasts away from real users. Do not send a broadcast from this
  build without checking that switch.
- **The orange DEV badge will be visible.** That is correct — it confirms the build hit
  the sandbox env. If it is missing, the build is pointed at production; stop and
  investigate before testing payments.
