#!/usr/bin/env node
/**
 * One-off backfill: seed `users/{uid}/public/profile` for every existing account.
 *
 * The mirrorPublicProfile trigger only fires when a user document is WRITTEN, so
 * accounts that never change again would have no public profile and would render
 * as a blank card on every ride screen. This walks the collection once.
 *
 * It also migrates reputation to the sum/count shape: the old code stored a
 * rounded average (`ratings`) plus a count (`ratingWeigth`), so the sum is
 * reconstructed as average x count. Ratings stay approximately right, and every
 * rating from here on is exact.
 *
 * Usage:
 *   node functions/scripts/backfill-public-profiles.js [--db uniliftdefault] [--dry]
 *
 * Requires GOOGLE_APPLICATION_CREDENTIALS, or run it in an authenticated shell
 * (`gcloud auth application-default login`).
 *
 * Safe to re-run: every write is a merge, and nothing is deleted.
 */
const admin = require("firebase-admin");
const { getFirestore } = require("firebase-admin/firestore");

const args = process.argv.slice(2);
const dbId = (() => {
  const i = args.indexOf("--db");
  return i >= 0 && args[i + 1] ? args[i + 1] : "uniliftdefault";
})();
const dryRun = args.includes("--dry");
const BATCH = 400;

admin.initializeApp();
const db = getFirestore(dbId);

function ageFromBirthDate(birthDate) {
  const birth = new Date(String(birthDate || ""));
  if (isNaN(birth.getTime())) return null;
  const today = new Date();
  let age = today.getFullYear() - birth.getFullYear();
  const m = today.getMonth() - birth.getMonth();
  if (m < 0 || (m === 0 && today.getDate() < birth.getDate())) age -= 1;
  return age > 0 && age < 130 ? age : null;
}

/** MUST stay identical to publicProfileFrom() in functions/index.js. */
function publicProfileFrom(uid, data) {
  const u = data || {};
  const email = typeof u.email === "string" ? u.email : "";
  const sum = Number(u.ratingSum);
  const count = Number(u.ratingCount);
  const hasNewShape = Number.isFinite(sum) && Number.isFinite(count) && count > 0;
  const legacyAvg = Number(u.ratings);
  const legacyWeight = Number(u.ratingWeigth);
  const hasLegacy = Number.isFinite(legacyAvg) && Number.isFinite(legacyWeight) && legacyWeight > 0;

  const ratingSum = hasNewShape ? sum : (hasLegacy ? legacyAvg * legacyWeight : 0);
  const ratingCount = hasNewShape ? count : (hasLegacy ? legacyWeight : 0);
  const rating = ratingCount > 0 ? Math.round((ratingSum / ratingCount) * 100) / 100 : 0;
  const age = ageFromBirthDate(u.birthDate);

  return {
    uid,
    name: (typeof u.name === "string" && u.name) || (email ? email.split("@")[0] : "") || "",
    avatar: typeof u.avatar === "string" ? u.avatar : "",
    xp: Number(u.xp) || 0,
    ridesCompleted: Number(u.ridesCompleted) || 0,
    ratingSum,
    ratingCount,
    rating,
    certifications: Array.isArray(u.certifications) ? u.certifications : [],
    school: typeof u.school === "string" ? u.school : "",
    instagramHandle: typeof u.instagramHandle === "string" ? u.instagramHandle : "",
    ...(age != null ? { age } : {}),
    updatedAt: new Date().toISOString(),
  };
}

async function main() {
  console.log(`Backfilling public profiles in ${dbId}${dryRun ? " (DRY RUN)" : ""}`);
  let cursor = null;
  let seen = 0;
  let written = 0;

  for (;;) {
    let q = db.collection("users").orderBy("__name__").limit(BATCH);
    if (cursor) q = q.startAfter(cursor);
    const snap = await q.get();
    if (snap.empty) break;

    const batch = db.batch();
    for (const doc of snap.docs) {
      seen += 1;
      const profile = publicProfileFrom(doc.id, doc.data());
      if (!dryRun) {
        batch.set(
          doc.ref.collection("public").doc("profile"),
          profile,
          { merge: true },
        );
      }
      written += 1;
    }
    if (!dryRun) await batch.commit();

    cursor = snap.docs[snap.docs.length - 1];
    console.log(`  ...${seen} users processed`);
    if (snap.size < BATCH) break;
  }

  console.log(`Done. ${seen} users seen, ${written} public profiles ${dryRun ? "would be " : ""}written.`);
}

main().then(() => process.exit(0)).catch((err) => {
  console.error("backfill failed:", err);
  process.exit(1);
});
