/**
 * One-time script: grant the founder accounts the `admin` custom claim.
 *
 * The founder-only admin dashboard (separate `unilift-rides` website) and the
 * Firestore security rules both gate on this claim:
 *   - rules:   request.auth.token.admin == true   (see firestore.rules isAdmin())
 *   - website: getIdTokenResult().claims.admin === true
 *
 * Custom claims are project-wide (Firebase Auth is shared across the named
 * Firestore databases uniliftdev / uniliftdefault), so running this once is
 * enough for both environments.
 *
 * ── Run (from the functions/ directory, firebase-admin is installed there) ──
 *
 *   # Point at a service-account key with the "Firebase Authentication Admin"
 *   # role on project unilift-6e756:
 *   export GOOGLE_APPLICATION_CREDENTIALS=/path/to/serviceAccount.json
 *   export GOOGLE_CLOUD_PROJECT=unilift-6e756   # if not embedded in the key
 *
 *   cd functions && node scripts/set-admin-claims.js
 *
 * Idempotent — re-running just re-asserts the claim. After running, each founder
 * must sign out / sign back in (or force a token refresh) for the new claim to
 * appear in their ID token.
 *
 * To REVOKE: node scripts/set-admin-claims.js --revoke
 */
const admin = require("firebase-admin");

admin.initializeApp();

// Founder emails to allowlist. Keep this list in sync with any future admins.
const ADMIN_EMAILS = [
  "thomasberthiaume183@gmail.com",
  "vachonbegin@gmail.com",
];

const REVOKE = process.argv.includes("--revoke");

(async () => {
  let failures = 0;

  for (const email of ADMIN_EMAILS) {
    try {
      const user = await admin.auth().getUserByEmail(email);

      // Preserve any other existing claims; only flip `admin`.
      const existing = user.customClaims || {};
      const nextClaims = { ...existing };
      if (REVOKE) {
        delete nextClaims.admin;
      } else {
        nextClaims.admin = true;
      }

      await admin.auth().setCustomUserClaims(user.uid, nextClaims);
      console.log(
        `${REVOKE ? "🔻 revoked admin from" : "✅ admin granted to"} ${email} ` +
          `(uid: ${user.uid})`,
      );
    } catch (err) {
      failures += 1;
      if (err && err.code === "auth/user-not-found") {
        console.error(
          `❌ ${email}: no Firebase Auth user with that email. ` +
            `Create/sign in the account first, then re-run.`,
        );
      } else {
        console.error(`❌ ${email}: ${err && err.message ? err.message : err}`);
      }
    }
  }

  console.log(
    `\nDone. ${ADMIN_EMAILS.length - failures}/${ADMIN_EMAILS.length} processed. ` +
      `Founders must re-login (token refresh) for the claim to take effect.`,
  );
  process.exit(failures > 0 ? 1 : 0);
})().catch((err) => {
  console.error("set-admin-claims failed:", err);
  process.exit(1);
});
