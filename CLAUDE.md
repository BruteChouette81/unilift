# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

# Project Context

## Project Purpose & Vision
**What is this project?**
- UniLift is a ridesharing social app for students in north america
- The goal is to provide an alternative to expensive taxis and uncomfortable bus 
- Students are going to use the app for 2 main reasons: 1: go to school, 2: go to events/parties/bars
- We want to provide many features, such as a social media-like experience, a Hype map for party, a ride planner for groups and for weeks and a payment system so everyone can be profitable.
- Our main source of income is a fee on each transaction and partnership with events to give them visibility on the app.

## Commands

```bash
expo start          # Start dev server (Expo Go or dev build)
expo start --ios    # Launch iOS simulator
expo start --android # Launch Android emulator
expo lint           # Run ESLint
```

No test runner is configured. There is no build or test script beyond `expo lint`.

## Architecture

### Routing
Expo Router (file-based, v6). Root layout (`app/_layout.tsx`) conditionally renders either the `(auth)` stack or the `(tabs)` stack based on `AuthContext.status`. All auth-guarding happens in the root layout — tab screens redirect to login if unauthenticated.

### State Management
- **AuthContext** (`context/AuthContext.tsx`): Global auth state (`user`, `status`, `loading`, `authActionLoading`) and auth methods (`signIn`, `signUp`, `signInWithApple`, `signOutUser`).
- **Custom hooks**: Profile data is split into focused hooks (`use-profile-data`, `use-profile-favorites`, `use-profile-rides`, `use-profile-avatar`). Each hook encapsulates its own Firestore interactions and local state.

### Firebase Access Pattern
The app uses a **hybrid** approach:

- **Real-time listeners** (screens that need live updates): Use the **Firestore SDK** (`onSnapshot` from `firebase/firestore`). Get the Firestore instance via `getFirestore()` (no separate import — the app is already initialized via `firebaseConfig.js`). SDK snapshots return plain JS objects — **no type wrappers**. Access fields directly (e.g. `data.passengers`, `data.status`). GeoPoint fields expose `.latitude` / `.longitude`.
- **One-time reads and all writes**: Use the **Firestore REST API** directly. Every request manually attaches `Authorization: Bearer {idToken}`. REST responses use type wrappers (`stringValue`, `integerValue`, `geoPointValue`, `arrayValue`, etc.) that must be manually extracted via the existing parsing helpers (`parseRideFromFirestoreDocument`, `normalizeUserData`, etc.).

**Rule of thumb**: if the screen polls in a loop or needs instant updates (e.g. driver inbox, passenger waiting, active ride), use `onSnapshot`. For one-off fetches, mutations, and service-layer calls, use the REST API.

Auth uses the Firebase SDK (`firebase/auth`) with `getReactNativePersistence(AsyncStorage)` for session persistence.

Config (`firebaseConfig.js`) reads credentials from `EXPO_PUBLIC_*` env vars via `constants/runtime-config.ts`.

### Services Layer
`services/` contains functions for Firestore REST calls (auth, rides, users). Service functions receive an `idToken` and return parsed data. Parsing helpers (`normalizeUserData`, `parseRideFromFirestoreDocument`, `extractFavoriteRoutes`) handle type-unwrapping.

### Key Conventions
- **Path alias**: `@/` resolves to the project root.
- **TypeScript strict mode** is on. Use explicit return types.
- **Design tokens**: In-file constant objects (e.g., `const C = { bg: "#080810", surface: "#0f0f1e", ... }`) are used per-screen rather than a global theme file.
- **UI**: `LinearGradient`, `Ionicons`, `Pressable`/`TouchableOpacity`. No UI component library.
- **Error feedback**: `Alert.alert()` for user-facing errors; `console.warn`/`console.error` for debugging.
- **Firestore writes**: Build payloads as `{ fields: { fieldName: { typeValue: value } } }`.
- **Auth actions**: Set `authActionLoading = true` before async auth ops; use `finally` to reset. Guard against concurrent calls by checking the flag first.
- **Rides cache**: `invalidateRidesCache()` must be called after mutating ride documents.
- **Apple Sign-In**: iOS only. Uses `expo-apple-authentication` → `OAuthProvider("apple.com")` credential → Firebase `signInWithCredential`. Creates/merges Firestore user doc with `merge: true`.

### Firestore Collections
- `users`: `{ email, xp, rating, avatar, homeAddress, localisation, ridesCompleted, favorite[] }`
- `rides`: `{ driverId, destination, destinationCoords, date, seatsAvailable, passengers[], localisation, status, started }`
