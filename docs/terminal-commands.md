# Terminal Commands Cheat Sheet

Every command assumes you're at the repo root (`~/Desktop/unilift`) unless stated
otherwise. Project constants used below:

| Thing | Value |
|---|---|
| Firebase project | `unilift-6e756` |
| Prod Firestore DB | `uniliftdefault` |
| Dev Firestore DB | `uniliftdev` |
| EAS project id | `4d095cd0-0669-4abb-b793-415183362b03` |
| Bundle id / package | `com.unilift.unilift` |
| App Store Connect app id | `6755918549` |
| Function codebases | `live` (`functions/`), `sandbox` (`functions-sandbox/`) |

---

## 1. Expo — local development

```bash
npx expo start                 # Metro dev server (QR code + menu)
npx expo start --clear         # …wiping the Metro cache — use after .env or config changes
npx expo start --ios           # boot iOS simulator
npx expo start --android       # boot Android emulator
npx expo start --web           # web build (react-native-web)
npx expo start --tunnel        # phone on a different network than the Mac
npx expo start --dev-client    # dev build installed on device (NOT Expo Go)
npx expo start --go            # force Expo Go instead of the dev client
```

npm script aliases that already exist: `npm start`, `npm run ios`,
`npm run android`, `npm run web`.

> This app uses native modules (Stripe, expo-maps, Apple Sign-In). Expo Go
> can't run those — use a dev build (`--dev-client`).

### Switching dev ⇄ prod locally

```bash
echo "EXPO_PUBLIC_APP_ENV=dev" >> .env   # → uniliftdev DB + test Stripe keys
npx expo start --clear                   # orange DEV badge should appear
```
Remove/comment the line and restart with `--clear` to go back to prod. Full
detail in [DEV-PROD-SWITCHING.md](../DEV-PROD-SWITCHING.md).

### Quality / diagnostics

```bash
npm run lint                   # expo lint (ESLint)
npx tsc --noEmit               # TypeScript check — strict mode is on
npx jest                       # matching-engine unit tests (utils/matching/__tests__)
npx jest --watch
npx expo-doctor                # dependency/config sanity check
npx expo install --check       # list deps that don't match the SDK
npx expo install --fix         # auto-align them to SDK 54
npx expo config --type public  # resolved app.config.js (verify env vars landed)
npx expo start --clear && watchman watch-del-all   # nuclear cache reset
```

### Native project / prebuild

```bash
npx expo prebuild              # generate ios/ + android/ (this repo is CNG, no native dirs committed)
npx expo prebuild --clean      # regenerate from scratch
npx expo run:ios               # local native iOS build + run
npx expo run:android
cd ios && pod install && cd .. # after adding a native dep, if ios/ exists
```

---

## 2. EAS — builds, updates, submissions

```bash
npm i -g eas-cli               # or use npx eas-cli@latest
eas login
eas whoami
eas init                       # links a project (already linked here)
```

### Builds

```bash
eas build --profile development --platform ios      # dev client, dev DB + test Stripe
eas build --profile preview     --platform ios      # prod DB + live Stripe, APK on Android
eas build --profile production  --platform ios      # store build (Android → .aab)
eas build --profile production  --platform all
eas build --profile development --platform ios --local   # build on your Mac instead of the cloud
eas build:list                                       # recent builds + IDs
eas build:view <build-id>
eas build:cancel
```

Env vars per profile live in [eas.json](../eas.json) — no `.env` needed for cloud builds.

### OTA updates (JS-only, no rebuild)

`runtimeVersion` follows `appVersion`, so an update only reaches builds with the
**same** `version` in [app.config.js](../app.config.js). Bumping the version means a
new store build, not an OTA.

```bash
eas update --branch production --message "fix ride sheet crash"
eas update --branch preview --message "…"
eas update --branch development --message "…"
eas update --auto                          # branch = current git branch
eas branch:list
eas channel:list
eas update:list --branch production
eas update:view <update-id>
eas update:republish --group <id>          # roll back to a previous update
eas channel:edit production --branch <branch>   # repoint a channel
```

### Secrets & credentials

```bash
eas secret:list
eas secret:create --scope project --name GOOGLE_MAPS_API_KEY --value "…"
eas secret:delete --id <id>
eas env:list production                     # EAS-hosted env vars (newer flow)
eas credentials                             # interactive: certs, provisioning profiles, keystores
eas credentials --platform ios
eas device:create                           # register an iPhone for internal/dev builds
eas device:list
```

---

## 3. Apple / iOS / TestFlight

```bash
eas submit --profile production --platform ios          # uploads latest build to App Store Connect
eas submit --platform ios --latest
eas submit --platform ios --id <build-id>
eas build --profile production --platform ios --auto-submit   # build + submit in one shot
```

`ascAppId` (`6755918549`) is already in [eas.json](../eas.json), so submission
only asks for your Apple ID + an app-specific password (or an ASC API key).

### Simulator control

```bash
xcrun simctl list devices                        # available simulators + UDIDs
xcrun simctl boot "iPhone 16 Pro"
open -a Simulator
xcrun simctl openurl booted "unilift://"          # test the deep-link scheme
xcrun simctl io booted screenshot shot.png
xcrun simctl io booted recordVideo demo.mov
xcrun simctl erase all                            # reset all simulators
```

### Device logs & tooling

```bash
npx react-native log-ios                          # JS logs from the running app
xcrun simctl spawn booted log stream --predicate 'process == "UniLift"'
xcrun devicectl list devices                      # physical devices (Xcode 15+)
xcode-select --install                            # CLI tools
sudo xcode-select -s /Applications/Xcode.app      # point at the right Xcode
security find-identity -v -p codesigning          # signing identities in the keychain
open -a Xcode ios/unilift.xcworkspace             # only after `expo prebuild`
```

### Sign in with Apple checklist (already configured)

`usesAppleSignIn: true` + the `expo-apple-authentication` plugin are set in
app.config.js. If auth breaks, verify in the Apple Developer portal that the
**Sign In with Apple** capability is on for `com.unilift.unilift` and that the
Service ID / key is registered in Firebase Auth → Sign-in method → Apple.

---

## 4. Firebase

```bash
npm i -g firebase-tools
firebase login
firebase login --reauth
firebase projects:list
firebase use default            # → unilift-6e756 (from .firebaserc)
```

### Cloud Functions

Two codebases share one project: `live` (`functions/`) and `sandbox`
(`functions-sandbox/`). **Always scope the deploy** — a bare
`firebase deploy --only functions` touches both.

```bash
firebase deploy --only functions:live              # api, getAdminMetrics, monthlyBilling, sweepStaleRides
firebase deploy --only functions:sandbox           # apiSandbox, getAdminMetricsSandbox, …
firebase deploy --only functions:live:api          # one function
firebase deploy --only functions:sandbox:apiSandbox
firebase functions:list
firebase functions:log
firebase functions:log --only api
firebase functions:delete <name> --region us-central1
```

Both codebases run `npm run lint` as a predeploy hook — a lint error blocks the deploy.

```bash
npm --prefix functions run lint
npm --prefix functions-sandbox run lint
npm --prefix functions install <pkg>               # deps must be installed in the codebase dir
```

### Firestore rules & storage

```bash
firebase deploy --only firestore                   # BOTH databases' rules
firebase deploy --only firestore:uniliftdefault    # prod rules  (firestore.rules)
firebase deploy --only firestore:uniliftdev        # dev rules   (firestore.dev.rules)
firebase deploy --only storage                     # storage.rules
```

### Emulators

```bash
firebase emulators:start
firebase emulators:start --only functions
firebase emulators:start --only functions,firestore
firebase emulators:start --import ./seed --export-on-exit
firebase functions:shell                           # call functions interactively
```

### Secrets (Functions v2)

```bash
firebase functions:secrets:set STRIPE_SECRET_KEY
firebase functions:secrets:access STRIPE_SECRET_KEY
firebase functions:secrets:list
firebase functions:secrets:prune
```

### Live endpoints (curl smoke tests)

```bash
curl -s https://api-qsxtpust2a-uc.a.run.app/health
curl -s https://us-central1-unilift-6e756.cloudfunctions.net/apiSandbox/health
curl -s -H "X-App-Env: dev" -H "Authorization: Bearer $ID_TOKEN" \
  https://api-qsxtpust2a-uc.a.run.app/<route>
```

The `X-App-Env: dev` header is what routes a request to `uniliftdev` + test
Stripe keys on the LIVE backend.

---

## 5. Typical flows

**Ship a JS-only fix to existing TestFlight builds**
```bash
npm run lint && npx tsc --noEmit
eas update --branch production --message "fix: …"
```

**Ship a new TestFlight build**
```bash
# bump `version` in app.config.js first
eas build --profile production --platform ios --auto-submit
```

**Deploy a backend change to sandbox only**
```bash
npm --prefix functions-sandbox run lint
firebase deploy --only functions:sandbox
firebase functions:log --only apiSandbox
```

**Fresh machine setup**
```bash
npm install
npm --prefix functions install
npm --prefix functions-sandbox install
cp .env.example .env    # if present; otherwise copy env values from eas.json
npx expo start --clear
```
