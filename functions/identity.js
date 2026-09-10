/**
 * Firebase Auth blocking functions — the account-creation chokepoint.
 *
 * ## Why this exists
 *
 * Until now nothing in this project ever saw an account being created. The app
 * calls `createUserWithEmailAndPassword` client-side, so "one account per
 * mailbox" rested entirely on the client canonicalising the address before
 * handing it to Firebase. That is advisory, not enforced: the Firebase API key
 * ships in the JS bundle (app.config.js says so in as many words), and anyone
 * can POST an un-canonicalised alias straight to
 * `identitytoolkit.googleapis.com/v1/accounts:signUp`.
 *
 * `beforeUserCreated` is the only hook that sees the password path, the Apple
 * path and the raw REST endpoint alike, before the auth record is committed.
 * Reject here and the account never exists — there is no orphan to clean up.
 *
 * ## Three things that will surprise the next person
 *
 * 1. **This is registered from `functions/` only, never `functions-sandbox/`.**
 *    A project has exactly one `beforeCreate` URI, and both codebases deploy to
 *    the same project (`unilift-6e756`). Exporting it from both would make the
 *    two deploys fight over the same registration. `check-server-drift.sh` only
 *    reads `app.<verb>(` lines, so it will not flag the asymmetry either way.
 *
 * 2. **Firebase Auth is one pool per project — dev and prod already share it.**
 *    `uniliftdefault` and `uniliftdev` are two Firestore *databases*, but there
 *    is a single Auth instance, so a dev signup and a prod signup already
 *    collide on email today. A blocking function has no request and therefore
 *    no `X-App-Env` to read. The index consequently lives in ONE database,
 *    `uniliftdefault`, which is the only choice consistent with the namespace
 *    it is protecting.
 *
 * 3. **The Admin SDK does not trigger these.** `admin.auth().createUser()`
 *    bypasses blocking functions entirely, which is what keeps `/account/delete`
 *    and any future server-side account creation from deadlocking against their
 *    own guard.
 */
const { getFirestore, FieldValue } = require("firebase-admin/firestore");
const admin = require("firebase-admin");
const {
  beforeUserCreated,
  beforeUserSignedIn,
  HttpsError,
} = require("firebase-functions/v2/identity");

const { normalizeEmail, emailIndexKey } = require("./email-identity");

/**
 * The mailbox claim lives here, in the production database, because Firebase
 * Auth — the namespace it mirrors — is itself project-wide. See note 2 above.
 */
const indexDb = () => getFirestore("uniliftdefault");

const EMAIL_INDEX = "emailIndex";
const SIGNUP_THROTTLE = "signupThrottle";

/**
 * Per-IP signup ceiling, in signups per hour.
 *
 * **Off unless `config/security.maxSignupsPerIpPerHour` is set to a positive
 * number.** Deliberately opt-in rather than defaulted: this app's users are
 * students, and a residence hall, a campus library or a cégep's whole guest
 * network sits behind one NAT address. A default IP cap would read as "the app
 * is broken" to a floor of first-years signing up during orientation week,
 * which is precisely the traffic we want. Turn it on if you see scripted abuse,
 * with a number well above a plausible dorm.
 */
const SIGNUP_IP_WINDOW_MS = 60 * 60 * 1000;

/** Cached `config/security`, same 60s-TTL shape as `getPricing`/`getBroadcastLimit`. */
const SECURITY_CONFIG_TTL_MS = 60 * 1000;
let securityConfigCache = null;

async function getSecurityConfig() {
  if (securityConfigCache && securityConfigCache.expires > Date.now()) {
    return securityConfigCache.value;
  }
  let value = { maxSignupsPerIpPerHour: 0 };
  try {
    const snap = await indexDb().collection("config").doc("security").get();
    const data = snap.exists ? snap.data() || {} : {};
    const n = Number(data.maxSignupsPerIpPerHour);
    value = { maxSignupsPerIpPerHour: Number.isFinite(n) && n > 0 ? n : 0 };
  } catch (err) {
    // Config is an optional tuning knob, not the guarantee. Failing to read it
    // must not decide whether somebody may create an account.
    console.warn("identity: config/security read failed, using defaults", err.message);
  }
  securityConfigCache = { value, expires: Date.now() + SECURITY_CONFIG_TTL_MS };
  return value;
}

/** Stable, non-reversible key for an IP. We count them; we do not store them. */
function ipKey(ip) {
  return require("crypto").createHash("sha256").update(String(ip || "unknown")).digest("hex");
}

/**
 * Claim `canonical` for `uid`, or report who already holds it.
 *
 * The stale-entry check on the conflict path is what makes this self-healing.
 * An index row can outlive its account two ways: Firebase can fail to create
 * the user after this function has already returned OK, and an account can be
 * removed outside `/account/delete`. Rather than let either wedge a mailbox
 * forever, a conflict verifies the holder still exists and takes the entry over
 * if it does not. That lookup only runs on collision, so the happy path stays a
 * single point-read.
 */
async function claimEmail(canonical, uid) {
  const db = indexDb();
  const ref = db.collection(EMAIL_INDEX).doc(emailIndexKey(canonical));

  const holder = await db.runTransaction(async (tx) => {
    const snap = await tx.get(ref);
    if (snap.exists) {
      const existing = snap.data() || {};
      if (existing.uid && existing.uid !== uid) return { conflictWith: existing.uid };
      // Same uid re-claiming (a retry) — refresh and fall through.
    }
    tx.set(ref, {
      uid,
      canonical,
      claimedAt: FieldValue.serverTimestamp(),
    });
    return { claimed: true };
  });

  if (holder.claimed) return { ok: true };

  // Conflict. Is the holder real?
  let holderExists = true;
  try {
    await admin.auth().getUser(holder.conflictWith);
  } catch (err) {
    if (err && err.code === "auth/user-not-found") holderExists = false;
    else throw err; // A lookup failure is not evidence of absence — fail closed.
  }

  if (holderExists) return { ok: false, conflictWith: holder.conflictWith };

  // Stale row: the account it pointed at is gone. Take it over.
  await ref.set({ uid, canonical, claimedAt: FieldValue.serverTimestamp() });
  console.log("identity: reclaimed stale emailIndex row", { canonical, from: holder.conflictWith, to: uid });
  return { ok: true };
}

/**
 * Gate every account creation on the mailbox being free.
 *
 * **Fails closed.** If the index cannot be read, the signup is refused. A hard
 * guarantee that degrades to "allow" under load is not a guarantee — and the
 * failure is loud and temporary, whereas a duplicate account is silent and
 * permanent.
 */
exports.beforeUserCreated = beforeUserCreated(async (event) => {
  const user = event.data;
  const rawEmail = user && user.email ? String(user.email) : "";

  // Apple without the email scope, and phone-only accounts, have no address.
  // There is no mailbox to claim and nothing to collide with.
  if (!rawEmail) return;

  const canonical = normalizeEmail(rawEmail);

  // Optional, off by default — see SIGNUP_IP_WINDOW_MS.
  const { maxSignupsPerIpPerHour } = await getSecurityConfig();
  if (maxSignupsPerIpPerHour > 0 && event.ipAddress) {
    const ref = indexDb().collection(SIGNUP_THROTTLE).doc(ipKey(event.ipAddress));
    const now = Date.now();
    const over = await indexDb().runTransaction(async (tx) => {
      const snap = await tx.get(ref);
      const data = snap.exists ? snap.data() || {} : {};
      const windowStart = Number(data.windowStart) || 0;
      const count = Number(data.count) || 0;
      if (now - windowStart > SIGNUP_IP_WINDOW_MS) {
        tx.set(ref, { windowStart: now, count: 1 });
        return false;
      }
      if (count >= maxSignupsPerIpPerHour) return true;
      tx.set(ref, { windowStart, count: count + 1 }, { merge: true });
      return false;
    });
    if (over) {
      console.warn("identity: signup refused, IP hourly cap reached");
      throw new HttpsError("resource-exhausted", "too-many-signups-from-this-network");
    }
  }

  let result;
  try {
    result = await claimEmail(canonical, user.uid);
  } catch (err) {
    console.error("identity: emailIndex claim failed, refusing signup", err);
    throw new HttpsError("internal", "signup-unavailable");
  }

  if (!result.ok) {
    console.log("identity: signup refused, mailbox already claimed", { canonical });
    // The client maps this onto the same inline "email already in use" state as
    // Firebase's own `auth/email-already-in-use`, so the two paths are
    // indistinguishable to the user — which is correct, because they mean the
    // same thing.
    throw new HttpsError("already-exists", "email-already-in-use");
  }

  return;
});

/**
 * Backfill the index for accounts that predate it.
 *
 * The app has always had a two-candidate sign-in loop (`emailSignInCandidates`)
 * because accounts created before canonicalisation shipped are stored under
 * whatever the user typed. Those mailboxes are not in the index, so nothing
 * protects them until something writes the entry. Doing it here means coverage
 * grows on its own as people log in — no migration, no script, no downtime.
 *
 * **Fails open, and never blocks a login.** The asymmetry with
 * `beforeUserCreated` is deliberate: refusing to create an account is a minor
 * inconvenience, refusing to let an existing user into their own account is an
 * outage for them. A collision here means two accounts already share a mailbox
 * — a pre-existing condition this function did not cause and must not resolve
 * by locking somebody out. It is logged for a human instead.
 */
exports.beforeUserSignedIn = beforeUserSignedIn(async (event) => {
  const user = event.data;
  const rawEmail = user && user.email ? String(user.email) : "";
  if (!rawEmail) return;

  try {
    const canonical = normalizeEmail(rawEmail);
    const result = await claimEmail(canonical, user.uid);
    if (!result.ok) {
      console.warn("identity: DUPLICATE MAILBOX — two accounts share one canonical address", {
        canonical,
        signingIn: user.uid,
        indexHolder: result.conflictWith,
      });
    }
  } catch (err) {
    console.warn("identity: sign-in backfill failed (login allowed)", err.message);
  }

  return;
});
