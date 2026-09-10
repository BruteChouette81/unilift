/**
 * Precondition check for deleting pass 3 of `sweepStaleRidesImpl`.
 *
 * Pass 3 resets rides stuck at `paymentStatus: "processing"` back to "pending".
 * Nothing writes "processing" any more — it was the non-atomic lock held by the
 * removed `/rides/complete` route; `/rides/finish` now does the whole charge in
 * one transaction. The pass is therefore dead code, BUT deleting it while a doc
 * is still stuck in that state would strand that ride forever, so the code
 * carries a `TODO: delete once no ride doc has paymentStatus == "processing"`.
 *
 * This script is that check. Run it against BOTH databases; when both report 0,
 * pass 3 can be deleted from `functions/index.js` and `functions-sandbox/index.js`
 * (the block under the comment "// 3. Payment stuck in \"processing\"." plus the
 * `PROC_TTL_MS` constant and the `processingReset` summary field).
 *
 * ── Run ──────────────────────────────────────────────────────────────────────
 *
 *   export GOOGLE_APPLICATION_CREDENTIALS=/path/to/serviceAccount.json
 *   export GOOGLE_CLOUD_PROJECT=unilift-6e756
 *
 *   cd functions-sandbox && node scripts/check-stuck-payments.js
 *
 * Read-only — it never writes. Exit 0 = safe to delete pass 3, 1 = not yet.
 */
const admin = require("firebase-admin");
const { getFirestore } = require("firebase-admin/firestore");

admin.initializeApp();

const DATABASES = ["uniliftdev", "uniliftdefault"];

async function main() {
  let stuckTotal = 0;

  for (const dbName of DATABASES) {
    const db = getFirestore(dbName);
    let snap;
    try {
      snap = await db
        .collection("rides")
        .where("paymentStatus", "==", "processing")
        .get();
    } catch (err) {
      console.error(`  ${dbName}: query FAILED — ${err.message}`);
      process.exitCode = 1;
      continue;
    }

    stuckTotal += snap.size;
    if (snap.empty) {
      console.log(`  ${dbName}: 0 stuck rides ✓`);
      continue;
    }

    console.log(`  ${dbName}: ${snap.size} stuck ride(s) ✗`);
    snap.docs.forEach((doc) => {
      const r = doc.data();
      console.log(
        `      ${doc.id}  status=${r.status}  driver=${r.driverId}  processingAt=${r.processingAt ?? "(none)"}`,
      );
    });
  }

  console.log("");
  if (stuckTotal === 0) {
    console.log("PASS — no ride is stuck in paymentStatus \"processing\".");
    console.log("Pass 3 of sweepStaleRidesImpl can now be deleted from both servers.");
  } else {
    console.log(`FAIL — ${stuckTotal} ride(s) still stuck. Keep pass 3.`);
    console.log("Let the sweep run (it resets them to \"pending\"), then re-check.");
    process.exitCode = 1;
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
