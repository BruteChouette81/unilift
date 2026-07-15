/**
 * Seed the Firestore `sponsors` collection with sample sponsor businesses.
 *
 * ⚠️  Targets the DEV database (uniliftdev) ONLY. Test data only for now.
 *
 * Run from the functions/ directory (firebase-admin is installed there):
 *
 *   # 1. Point at a service-account key with Firestore write access:
 *   export GOOGLE_APPLICATION_CREDENTIALS=/path/to/serviceAccount.json
 *   export GOOGLE_CLOUD_PROJECT=<your-firebase-project-id>   # if not in the key
 *
 *   # 2. Seed:
 *   cd functions && node scripts/seed-sponsors.js
 *
 * Re-running is safe — it upserts by id (set), so existing docs are overwritten.
 *
 * `tier` (gold/silver/bronze) controls the marker size, glow ring, z-order and a
 * "Featured" badge on the map (gold = biggest & always on top).
 */
const admin = require("firebase-admin");

admin.initializeApp();
const db = admin.firestore();
db.settings({ databaseId: "uniliftdev" });
const GeoPoint = admin.firestore.GeoPoint;

// Sample sponsors around Québec City. Edit freely or add your own.
const SPONSORS = [
  {
    id: "mcdonalds-laurier",
    name: "McDonald's Place Laurier",
    category: "fast-food",
    lat: 46.7808,
    lng: -71.2825,
    tier: "gold",
    // Raster (PNG) logo — RN <Image> does not render SVG. Clearbit serves PNGs.
    logoUrl: "https://logo.clearbit.com/mcdonalds.com",
    brandColor: "#FFC72C",
    address: "2700 Bd Laurier, Québec, QC",
    tagline: "Open till 3 AM",
    offers: [
      { title: "Student combo", discount: "20% off", description: "Show your UniLift ride to redeem." },
      { title: "Free coffee", discount: "Free", description: "Any McCafé coffee with a Big Mac meal." },
    ],
    active: true,
  },
  {
    id: "cafe-campus",
    name: "Café Campus",
    category: "cafe",
    lat: 46.7825,
    lng: -71.2745,
    tier: "silver",
    logoUrl: "https://logo.clearbit.com/starbucks.com",
    brandColor: "#a16207",
    address: "1055 Av. du Séminaire, Québec, QC",
    tagline: "Late-night study fuel",
    offers: [
      { title: "Buy one get one", discount: "BOGO", description: "On all espresso drinks after 8 PM." },
    ],
    active: true,
  },
  {
    id: "shaker-ste-foy",
    name: "Shaker Ste-Foy",
    category: "bar",
    lat: 46.7869,
    lng: -71.2823,
    tier: "bronze",
    // No logoUrl → exercises the category-icon fallback (bar → beer glyph).
    brandColor: "#7c3aed",
    address: "2360 Ch. Ste-Foy, Québec, QC",
    tagline: "Cocktails & bites",
    offers: [
      { title: "No cover before 11 PM", discount: "Free entry", description: "Arrive by UniLift, skip the cover." },
    ],
    active: true,
  },
  {
    // No logoUrl → exercises the category-icon fallback (store/storefront glyph).
    id: "campus-depanneur",
    name: "Dépanneur Campus",
    category: "store",
    lat: 46.7791,
    lng: -71.2688,
    tier: "bronze",
    brandColor: "#34d399",
    address: "1200 Av. de la Médecine, Québec, QC",
    tagline: "Snacks & essentials 24/7",
    offers: [],
    active: true,
  },
];

(async () => {
  const batch = db.batch();
  for (const sp of SPONSORS) {
    const { id, lat, lng, ...rest } = sp;
    const ref = db.collection("sponsors").doc(id);
    const doc = { ...rest, location: new GeoPoint(lat, lng) };
    batch.set(ref, doc);
  }
  await batch.commit();
  console.log(`✅ Seeded ${SPONSORS.length} sponsors into "sponsors" (db: uniliftdev).`);
  process.exit(0);
})().catch((err) => {
  console.error("Seed failed:", err);
  process.exit(1);
});
