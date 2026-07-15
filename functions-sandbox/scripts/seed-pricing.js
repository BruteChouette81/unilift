/**
 * Seed the Firestore `config/pricing` document with the default ride per-km
 * rates, in BOTH named databases (uniliftdev + uniliftdefault).
 *
 * Optional — the app and Cloud Function fall back to the same hardcoded defaults
 * when the doc is missing, and the admin dashboard's first save creates it. Run
 * this to make the values visible/editable in the dashboard immediately.
 *
 * Run from the functions/ directory (firebase-admin is installed there):
 *
 *   export GOOGLE_APPLICATION_CREDENTIALS=/path/to/serviceAccount.json
 *   export GOOGLE_CLOUD_PROJECT=unilift-6e756   # if not embedded in the key
 *
 *   cd functions && node scripts/seed-pricing.js
 *
 * Re-running is safe — it upserts with merge, so an existing edited value is
 * preserved for any field already present. Pass --overwrite to force defaults.
 */
const admin = require("firebase-admin");
const { getFirestore } = require("firebase-admin/firestore");

admin.initializeApp();

const OVERWRITE = process.argv.includes("--overwrite");

// Keep in sync with DEFAULT_PRICING (functions/index.js) and
// DEFAULT_RIDE_PRICING (constants/pricing.ts).
const DEFAULT_PRICING = {
  passengerRateCentsPerKm: 25,
  driverRateCentsPerKm: 20,
  minimumChargeCents: 100,
  minimumDistanceKm: 0.5,
};

(async () => {
  const dbs = [getFirestore("uniliftdefault"), getFirestore("uniliftdev")];
  for (const db of dbs) {
    const ref = db.collection("config").doc("pricing");
    await ref.set(DEFAULT_PRICING, { merge: !OVERWRITE });
    console.log(`✅ seeded config/pricing on ${db.databaseId || "database"}`);
  }
  console.log("\nDone.");
  process.exit(0);
})().catch((err) => {
  console.error("seed-pricing failed:", err);
  process.exit(1);
});
