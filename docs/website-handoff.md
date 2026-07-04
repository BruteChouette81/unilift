# UniLift — Website Hand-off (admin dashboard)

> For the **`unilift-rides`** website repo (founder-only admin dashboard).
> Copy this file + `unilift-admin-inventory.md` into that repo before building.
>
> **Backend:** Firebase project `unilift-6e756`, **named Firestore DB
> `uniliftdefault` (production)**, Cloud Functions region **us-central1**.

---

## 1. Firebase web config (for the website's env)

These are the public client keys (same project as the app). **Do not hardcode —
read from env.** Copy the values from **Firebase Console → Project Settings →
General → Your apps → Web app** (or from the app's `.env`, which holds the same
`EXPO_PUBLIC_FIREBASE_*` values). Known constants are filled in below.

| Website env var (suggested) | Source / value |
|-----------------------------|----------------|
| `VITE_FIREBASE_API_KEY` | = app's `EXPO_PUBLIC_FIREBASE_API_KEY` |
| `VITE_FIREBASE_AUTH_DOMAIN` | = `EXPO_PUBLIC_FIREBASE_AUTH_DOMAIN` (e.g. `unilift-6e756.firebaseapp.com`) |
| `VITE_FIREBASE_PROJECT_ID` | **`unilift-6e756`** |
| `VITE_FIREBASE_STORAGE_BUCKET` | = `EXPO_PUBLIC_FIREBASE_STORAGE_BUCKET` |
| `VITE_FIREBASE_MESSAGING_SENDER_ID` | = `EXPO_PUBLIC_FIREBASE_MESSAGING_SENDER_ID` |
| `VITE_FIREBASE_APP_ID` | = `EXPO_PUBLIC_FIREBASE_APP_ID` |
| `VITE_FIREBASE_MEASUREMENT_ID` | = `EXPO_PUBLIC_FIREBASE_MEASUREMENT_ID` |
| **Firestore database id** | **`uniliftdefault`** (named DB — not `(default)`) |

> Use whatever env prefix your bundler needs (`VITE_`, `NEXT_PUBLIC_`, etc.).

### Initializing the SDK (critical: named database)
```js
import { initializeApp } from "firebase/app";
import { getAuth } from "firebase/auth";
import { getFirestore } from "firebase/firestore";
import { getFunctions } from "firebase/functions";

const app = initializeApp({
  apiKey: import.meta.env.VITE_FIREBASE_API_KEY,
  authDomain: import.meta.env.VITE_FIREBASE_AUTH_DOMAIN,
  projectId: "unilift-6e756",
  storageBucket: import.meta.env.VITE_FIREBASE_STORAGE_BUCKET,
  messagingSenderId: import.meta.env.VITE_FIREBASE_MESSAGING_SENDER_ID,
  appId: import.meta.env.VITE_FIREBASE_APP_ID,
});

export const auth = getAuth(app);
// MUST pass the named DB id — the app does not use "(default)".
export const db = getFirestore(app, "uniliftdefault");
export const functions = getFunctions(app, "us-central1");
```

---

## 2. Admin gating (the website must enforce this)

Access is gated by a **Firebase Auth custom claim `{ admin: true }`** on the two
founder accounts (`thomasberthiaume183@gmail.com`, `vachonbegin@gmail.com`),
set server-side via `functions/scripts/set-admin-claims.js`.

After a founder signs in, verify the claim before showing the dashboard:
```js
import { getIdTokenResult } from "firebase/auth";

const { claims } = await getIdTokenResult(auth.currentUser, /* forceRefresh */ true);
if (claims.admin !== true) {
  // Not an admin → sign out / show "access denied".
}
```
The same claim is enforced by Firestore rules (`isAdmin()`) and by the
`getAdminMetrics` callable, so the UI gate is convenience, not the security
boundary.

---

## 3. Editable constants — `events` collection (the editor)

**Path:** `events/{eventId}` in DB `uniliftdefault`. Document id is a slug you
choose (e.g. `neon-rave`). Admins can **create / update / delete** (rules allow
writes only for `admin` claim holders).

### Document shape (write with the JS SDK)
```js
import { doc, setDoc, GeoPoint } from "firebase/firestore";

await setDoc(doc(db, "events", "neon-rave"), {
  name: "Neon Rave",              // string  (required)
  nameFr: "Néon Rave",            // string  (optional → falls back to name)
  venue: "Place Laurier",         // string  (required)
  location: new GeoPoint(46.7714, -71.2831), // GeoPoint (required) → map marker
  score: 10,                      // integer 1–10 (required) → flame size (10 = biggest)
  description: "...",             // string  (optional)
  descriptionFr: "...",           // string  (optional)
  date: "Sat Apr 5",              // string  (optional, display text)
  time: "11 PM",                  // string  (optional, display text)
  tag: "Party",                   // string  (optional)
  tagFr: "Fête",                  // string  (optional)
  ticketPriceCents: 1500,         // integer (optional; omit ⇒ free entry)
  // attendeeCount: DO NOT SET — server-managed by the /events/interest function.
}, { merge: true });
```

### Editor validation rules
- `name`, `venue`, `location`, `score` are **required**; the app drops events
  missing any of `name` / valid `location`.
- `score` must be an **integer in [1, 10]** (clamped on read, but validate in UI).
- `location` must be a real **GeoPoint** (`new GeoPoint(lat, lng)`), not a plain
  object — the app reads `location.latitude` / `location.longitude`.
- **Never write `attendeeCount`** — it is a race-safe counter maintained by the
  `/events/interest` Cloud Function. Editing it from the dashboard would corrupt
  the "people going" tally.
- To delete an event: `deleteDoc(doc(db, "events", id))`.

The app reads events ordered by `score` DESC (top 50) for the Hype map.

---

## 4. Metrics

### 4a. Privileged aggregates — callable `getAdminMetrics`
Admin-only (verifies the `admin` claim). Aggregate-only, **no PII**.

```js
import { httpsCallable } from "firebase/functions";

const getAdminMetrics = httpsCallable(functions, "getAdminMetrics");
const { data } = await getAdminMetrics();           // prod (uniliftdefault)
// const { data } = await getAdminMetrics({ env: "dev" }); // → uniliftdev
```

**Request:** `{}` (optional `{ env: "dev" }` to read the dev DB; default prod).

**Response** (any individual field may be `null` if that query failed, e.g.
missing index — handle gracefully):
```ts
{
  users: number | null;            // total user docs
  rides: number | null;            // total ride docs
  events: number | null;           // total event docs
  rideRequests: number | null;     // total ride-request docs
  onlineDrivers: number | null;    // driverSessions with status == "online"
  ridesLast7d: number | null;      // rides with date >= now-7d
  ridesLast30d: number | null;     // rides with date >= now-30d
  completedRides: number | null;   // rides with status == "completed"
  driveModeDrivers: number | null; // users with any driver availability day
  gmvCents: number | null;         // Σ ride_charge transaction amounts (cents)
  totalAuthUsers: number | null;   // Firebase Auth account count (Admin SDK)
  env: "prod" | "dev";
  generatedAt: string;             // ISO timestamp
}
```
> Errors: `unauthenticated` (not signed in) or `permission-denied` (no admin
> claim) are thrown as `HttpsError` — surface as an access-denied state.

> Possible index: the `ridesLast7d/30d` queries filter `rides` on `date`
> (single-field range — usually no composite index needed). If they return
> `null`, check the Functions logs for an index link.

### 4b. Cheap client-side counts (optional, instant)
For a snappier UI you can also run these directly from the website with the
admin's signed-in session (one aggregation read each, no docs transferred):
```js
import { collection, query, where, getCountFromServer } from "firebase/firestore";

const usersCount       = (await getCountFromServer(collection(db, "users"))).data().count;
const ridesCount       = (await getCountFromServer(collection(db, "rides"))).data().count;
const eventsCount      = (await getCountFromServer(collection(db, "events"))).data().count;
const requestsCount    = (await getCountFromServer(collection(db, "rideRequests"))).data().count;
const onlineDrivers    = (await getCountFromServer(
  query(collection(db, "driverSessions"), where("status", "==", "online"))
)).data().count;
```
These work because every collection is already `read: if isSignedIn()`. Anything
involving cross-user transactions or Auth totals must go through the callable.

---

## 5. Loi 25 reminder
Keep everything the dashboard displays **aggregate**. Do **not** render user
emails, names, `homeAddress`, `localisation`, ride pickup/dropoff coordinates,
driver live GPS, or transaction-level rows. The collections hold this PII, but
the dashboard's metrics surface only counts and the summed GMV.

---

## 6. Deploy checklist (run by the founder, in the `unilift` app repo)
1. **Set admin claims:** `cd functions && node scripts/set-admin-claims.js`
   (with a service-account key, role *Firebase Authentication Admin*). Founders
   re-login afterward.
2. **Deploy rules:** `firebase deploy --only firestore:rules` — confirm the
   `firebase.json` `firestore` array targets `uniliftdefault` (and `uniliftdev`).
3. **Deploy the callable:** `firebase deploy --only functions:getAdminMetrics`.
4. Verify: admin can edit an event from the dashboard; non-admin cannot;
   `getAdminMetrics` returns aggregates for an admin and `permission-denied`
   otherwise.
