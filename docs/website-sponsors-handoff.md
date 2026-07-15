# Admin Dashboard — Sponsors CRUD Hand-off

> **Paste the “PROMPT” block below into the coding agent working in the separate
> `unilift-rides` website repo.** It contains everything needed to add a Sponsors
> management screen that writes to the **production** Firestore database.
>
> This doc lives in the mobile-app repo because the mobile app defines the
> read contract (`services/sponsorService.ts` → `fetchSponsors()`). Keep the two
> in sync: if you change the sponsor schema here, update the parser there.

---

## Key facts (already true in the mobile-app repo — no further changes needed)

- **Firebase project:** `unilift-6e756` (single project, see `.firebaserc`).
- **Target database:** the **named** database **`uniliftdefault`** (production).
  Dev data lives in `uniliftdev`; the dashboard must **not** touch it.
- **Collection:** `sponsors/{sponsorId}` — document id is a slug (e.g. `mcdonalds-laurier`).
- **Security rules** (`firestore.rules`, deployed to `uniliftdefault` **and**
  `uniliftdev` via `firebase.json`):
  ```
  match /sponsors/{sponsorId} {
    allow read: if isSignedIn();
    allow create, update, delete: if isAdmin();   // request.auth.token.admin == true
  }
  ```
  So writes require a signed-in founder admin (custom claim `{ admin: true }`,
  already granted via `functions/scripts/set-admin-claims.js`). No Cloud Function
  is involved — the dashboard writes **directly via the Firebase JS SDK**, gated
  by these rules.
- **Read path (the contract to honour):** the app reads sponsors with the REST
  `:runQuery` and expects the exact field shapes below. Missing `name` or a
  missing/invalid `location` GeoPoint → the app silently drops that sponsor.

---

## PROMPT (copy everything below into the website-repo agent)

You are working in the `unilift-rides` admin-dashboard website repo (Firebase Web
SDK). Add a **Sponsors** management section (list + create + edit + delete) that
reads and writes the `sponsors` Firestore collection. Sponsors are paying partner
businesses shown on the UniLift mobile map.

### 1. Connect to the correct (named) production database

There is ONE Firebase project (`unilift-6e756`) with TWO named Firestore
databases. Production is the **named** database `uniliftdefault` — **not**
`(default)`. You MUST pass the database id explicitly:

```ts
import { initializeApp } from "firebase/app";
import { getFirestore } from "firebase/firestore";
import { getAuth } from "firebase/auth";

const app = initializeApp(firebaseConfig);           // project unilift-6e756
export const auth = getAuth(app);
export const db = getFirestore(app, "uniliftdefault"); // ⚠️ named DB, second arg
```

If you call `getFirestore(app)` without the second argument you will read/write
the wrong (`(default)`) database and nothing will appear in the app. Never use
`uniliftdev` from the dashboard — that is the mobile team’s test database.

### 2. Admin auth

Writes are gated by the Firestore rule `request.auth.token.admin == true`. The
signed-in dashboard user must be a founder admin. After sign-in, force-refresh
the token so the claim is present, and optionally guard the UI:

```ts
const token = await auth.currentUser!.getIdTokenResult(true);
if (token.claims.admin !== true) throw new Error("Not an admin");
```

If a write returns `permission-denied`, the account lacks the claim (or the token
wasn’t refreshed) — do not work around it; the account must be granted admin.

### 3. Document schema (`sponsors/{slug}`) — the write contract

The mobile app parses these exact fields. Write them via the SDK using native
types (`GeoPoint`, arrays, maps) — NOT the REST `{stringValue: …}` wrappers.

| Field | Type | Required | Notes |
|-------|------|----------|-------|
| `name` | string | ✅ | Business name shown on the pin + modal. |
| `category` | string | ✅ | One of `"fast-food" \| "cafe" \| "bar" \| "store"` (others allowed but fall back to a generic icon). Drives the fallback map icon. |
| `location` | **GeoPoint** | ✅ | `new GeoPoint(lat, lng)`. lat ∈ [-90,90], lng ∈ [-180,180]. Missing/invalid → app drops the sponsor. |
| `tier` | string | ✅ | Exactly one of `"gold" \| "silver" \| "bronze"`. Controls marker size, glow ring, z-order, and a “Featured” badge (gold = biggest & always on top). |
| `logoUrl` | string | — | Public **raster** image URL (**PNG/JPG/WebP only — NOT SVG**; React Native cannot render SVG). Prefer a Firebase Storage download URL. Omit → app shows the category icon. |
| `brandColor` | string | — | Hex, e.g. `"#FFC72C"` — used for ring/accents. |
| `address` | string | — | Display line in the modal. |
| `tagline` | string | — | Short eyebrow, e.g. `"Open till 3 AM"`. |
| `offers` | array of maps | — | Each map: `{ title: string (required), description?: string, discount?: string }`. `discount` is shown as a chip, e.g. `"20% off"`. Store as a real array of objects. |
| `active` | boolean | — | Defaults to true. Set `false` to hide from the map without deleting. |

Use a **slug** as the document id (lowercase, hyphenated, from the name) so
create is an idempotent upsert and edit/delete address it directly.

### 4. Write examples (Firebase Web SDK)

```ts
import { doc, setDoc, deleteDoc, collection, getDocs, GeoPoint } from "firebase/firestore";

// Create / edit (upsert by slug id)
await setDoc(doc(db, "sponsors", slug), {
  name,
  category,                       // "fast-food" | "cafe" | "bar" | "store"
  location: new GeoPoint(lat, lng),
  tier,                           // "gold" | "silver" | "bronze"
  logoUrl,                        // optional, raster URL
  brandColor,                     // optional hex
  address, tagline,               // optional
  offers: offers.map(o => ({      // optional array of maps
    title: o.title,
    ...(o.description ? { description: o.description } : {}),
    ...(o.discount ? { discount: o.discount } : {}),
  })),
  active,                         // boolean
});

// Delete
await deleteDoc(doc(db, "sponsors", slug));

// List (for the admin table)
const snap = await getDocs(collection(db, "sponsors"));
const sponsors = snap.docs.map(d => ({ id: d.id, ...d.data() }));
```

### 5. Dashboard validation (enforce before writing)

- `name` non-empty; `tier ∈ {gold,silver,bronze}`; `category` non-empty.
- `lat`/`lng` numeric and in range; write as a `GeoPoint`.
- `logoUrl` (if set) ends in a raster extension / is a Storage URL — reject `.svg`.
- `offers[].title` required; drop empty offer rows.
- Provide an `active` toggle (default on).

### 6. Do / Don’t

- ✅ Write to `getFirestore(app, "uniliftdefault")`.
- ✅ Keep writes client-side via the SDK (rules enforce admin) — no Cloud Function.
- ❌ Don’t write to `uniliftdev` or `(default)`.
- ❌ Don’t use SVG logos.
- ❌ Don’t add fields the app doesn’t read expecting them to show — extend the
  mobile `Sponsor` type + `parseSponsor` first (`constants/sponsors.ts`,
  `services/sponsorService.ts`).

_End of prompt._

---

## Verifying the round-trip

1. In the dashboard, create a sponsor (e.g. `test-sponsor`, tier `gold`, a valid
   PNG `logoUrl`, a GeoPoint near a test city).
2. Confirm the doc appears in Firebase console under database **`uniliftdefault`**,
   collection `sponsors`.
3. Run the mobile app in **production** mode (no `EXPO_PUBLIC_APP_ENV=dev`, so it
   points at `uniliftdefault`). The gold pin should appear on the home map with
   its logo; tapping it opens the sponsor card with the offers you entered;
   “Head there” starts a lift to it.
4. Toggle `active: false` in the dashboard → the pin disappears from the app.
5. Delete the test sponsor when done.
