const functions = require("firebase-functions");
const { onSchedule } = require("firebase-functions/v2/scheduler");
const { onDocumentWritten } = require("firebase-functions/v2/firestore");
const express = require("express");
const admin = require("firebase-admin");
const { getFirestore, FieldValue, Timestamp, GeoPoint } = require("firebase-admin/firestore");
const { Buffer } = require("node:buffer");
require("dotenv").config();

// Both test and live key pairs must always be present in functions/.env.
// The active set is chosen per-request from the X-App-Env header sent by the
// app — no manual APP_ENV toggle or redeploy needed when switching environments.
if (!process.env.STRIPE_SECRET_KEY_LIVE || !process.env.STRIPE_PUBLISHABLE_KEY_LIVE) {
  throw new Error("Missing STRIPE_SECRET_KEY_LIVE / STRIPE_PUBLISHABLE_KEY_LIVE in functions/.env");
}
if (!process.env.STRIPE_SECRET_KEY_TEST || !process.env.STRIPE_PUBLISHABLE_KEY_TEST) {
  throw new Error("Missing STRIPE_SECRET_KEY_TEST / STRIPE_PUBLISHABLE_KEY_TEST in functions/.env");
}

admin.initializeApp();

// Two named Firestore databases. Requests from the dev app (X-App-Env: dev)
// are routed to uniliftdev so test data never touches production.
const prodDb = getFirestore("uniliftdefault");
const devDb  = getFirestore("uniliftdev");

// Two Stripe instances — live keys for production, test keys for dev.
const stripeLive = require("stripe")(process.env.STRIPE_SECRET_KEY_LIVE);
const stripeTest = require("stripe")(process.env.STRIPE_SECRET_KEY_TEST);

// Scheduled jobs (sweepStaleRides, monthlyBilling, monthlyDriverPayouts,
// payoutPendingEarnings) have no per-request env header, so they must name a
// fixed database in code.
//
// CUTOVER DONE. These were pinned to devDb through the ride-path hardening
// rollout so a scheduled run could never touch production. The new production
// app is now the floor, so they run against real data and real money.
// functions-sandbox/ stays pinned to dev/test forever — that is what keeps the
// two codebases from ever racing each other against one database.
const TARGET_DB = prodDb;
const TARGET_STRIPE = stripeLive;

// ── Scheduled jobs: LIVE ─────────────────────────────────────────────────────
// These were paused because BOTH servers pinned TARGET_DB to devDb and scheduled
// the same jobs at the same times, so LIVE and SANDBOX raced each other against
// one database:
//   • monthlyBilling — Stripe's idempotency key stops a double charge, but
//     Firestore has no such guard, so both passes wrote a ledger row and both
//     zeroed the counters.
//   • sweepStaleRides — reads, checks age, updates, then pushes, with no
//     transaction. Two concurrent sweeps both notify.
// That collision is gone: LIVE now runs against uniliftdefault and SANDBOX
// against uniliftdev, so the two never see the same document. Keep it that way —
// if this codebase is ever re-pinned to devDb, pause it again first.
const SCHEDULED_JOBS_PAUSED = false;

const getDb     = (req) => req.headers["x-app-env"] === "dev" ? devDb  : prodDb;
const getStripe = (req) => req.headers["x-app-env"] === "dev" ? stripeTest : stripeLive;
const getStripePublishableKey = (req) =>
  req.headers["x-app-env"] === "dev"
    ? process.env.STRIPE_PUBLISHABLE_KEY_TEST
    : process.env.STRIPE_PUBLISHABLE_KEY_LIVE;

// Public https base URL of this function. Stripe's hosted Connect onboarding
// rejects custom app schemes as return URLs, so it bounces through an https
// endpoint here that 302s back into the app.
//
// This is a gen-2 (Cloud Run) URL with a hash assigned on first deploy — unlike
// the sandbox's deterministic gen-1 address. It mirrors LIVE_API_BASE_URL in
// constants/runtime-config.ts; if that ever changes, change it here too.
const PUBLIC_BASE_URL = "https://api-qsxtpust2a-uc.a.run.app";

// Public marketing site. Used as the business website on drivers' Connect
// accounts — they have no site of their own, and this is what Stripe reviews.
const PLATFORM_URL = "https://unilift.ca";

const app = express();
// Capture the raw request body alongside JSON parsing so Stripe webhook routes
// (POST /stripe/connect-webhook) can verify the signature against the exact
// bytes Stripe signed. Every other route keeps using the parsed req.body.
app.use(express.json({ verify: (req, _res, buf) => { req.rawBody = buf; } }));

// ── Baseline response hardening ──────────────────────────────────────────────
// Deliberately hand-rolled rather than pulling in helmet: this API serves JSON to
// a native client, so only a few of helmet's headers apply, and adding a
// dependency to both function codebases days before a release is its own risk.
app.use((req, res, next) => {
  res.setHeader("X-Content-Type-Options", "nosniff");
  res.setHeader("Referrer-Policy", "no-referrer");
  // Nothing here is meant to be framed or embedded.
  res.setHeader("X-Frame-Options", "DENY");
  // No browser origin should be calling this API — the client is native. Not
  // setting Access-Control-Allow-Origin at all is what keeps a hostile web page
  // from reading responses with a user's token.
  next();
});

// ── Global per-caller rate limit ─────────────────────────────────────────────
//
// Nothing bounded request volume before. Several routes are expensive — a
// dispatch is a full `users` scan, /rides/finish opens a transaction across
// several documents — and a single authenticated account could run any of them
// in a loop. The per-request throttles on /requests/dispatch and /maps/* are the
// precise limits; this is the blunt backstop underneath them.
//
// In-memory, so the budget is per warm instance rather than global. That is fine
// for its purpose: it is a brake on runaway loops, not a security boundary, and
// the abuse it stops comes from one client hammering one instance.
const RATE_LIMIT_WINDOW_MS = 60 * 1000;
const RATE_LIMIT_MAX = 240;
const rateBuckets = new Map(); // key -> { count, resetAt }

function rateLimit(req, res, next) {
  // Keyed on the caller once known, IP before that. Webhooks are exempt: Stripe
  // retries in bursts and is authenticated by signature, not by token.
  if (req.path === "/stripe/connect-webhook") return next();
  const key = req.uid || req.ip || "anonymous";
  const now = Date.now();
  const bucket = rateBuckets.get(key);
  if (!bucket || bucket.resetAt <= now) {
    rateBuckets.set(key, { count: 1, resetAt: now + RATE_LIMIT_WINDOW_MS });
    if (rateBuckets.size > 10000) {
      // Bounded memory. Dropping the map costs at most one window of accounting.
      for (const [k, v] of rateBuckets) if (v.resetAt <= now) rateBuckets.delete(k);
    }
    return next();
  }
  bucket.count += 1;
  if (bucket.count > RATE_LIMIT_MAX) {
    res.setHeader("Retry-After", Math.ceil((bucket.resetAt - now) / 1000));
    return res.status(429).json({ error: "rate_limited" });
  }
  return next();
}

// Standalone IP throttle for the ONE unauthenticated route, /device/check.
//
// The global `rateLimit` above is invoked from inside `authenticate`, so it
// never sees a caller who has no token yet — which is exactly what an
// account-creation pre-check is. This is deliberately generous: students share
// campus and residence NAT addresses, so a tight per-IP cap here would read as
// "the app is broken" to a floor of first-years signing up at once.
const DEVICE_CHECK_WINDOW_MS = 60 * 1000;
const DEVICE_CHECK_MAX = 30;
const deviceCheckBuckets = new Map(); // ip -> { count, resetAt }

function deviceCheckThrottled(ip) {
  const key = ip || "anonymous";
  const now = Date.now();
  const bucket = deviceCheckBuckets.get(key);
  if (!bucket || bucket.resetAt <= now) {
    deviceCheckBuckets.set(key, { count: 1, resetAt: now + DEVICE_CHECK_WINDOW_MS });
    if (deviceCheckBuckets.size > 10000) {
      for (const [k, v] of deviceCheckBuckets) if (v.resetAt <= now) deviceCheckBuckets.delete(k);
    }
    return false;
  }
  bucket.count += 1;
  return bucket.count > DEVICE_CHECK_MAX;
}

// ── Account-creation claims ─────────────────────────────────────────────────
//
// The emailIndex mailbox claim written by the beforeUserCreated blocking
// function (functions/identity.js). Referenced here so /account/delete can
// release it. Firebase Auth is ONE pool per project — `uniliftdefault` and
// `uniliftdev` are two Firestore databases but there is a single Auth instance
// — so the index that mirrors that namespace lives in one database regardless
// of which environment the request came from. Do not switch this on getDb(req).
const {
  normalizeEmail: normalizeEmailForIndex,
  emailIndexKey: emailIndexKeyForClaims,
} = require("./email-identity");
const indexDbForClaims = () => getFirestore("uniliftdefault");

// ── Auth Middleware ──────────────────────────────────────────────────────────
const authenticate = async (req, res, next) => {
  const header = req.headers.authorization ?? "";
  if (!header.startsWith("Bearer ")) {
    return res.status(401).json({ error: "Unauthorized" });
  }
  try {
    const decoded = await admin.auth().verifyIdToken(header.split("Bearer ")[1]);
    req.uid = decoded.uid;
    rateLimit(req, res, next);
  } catch {
    res.status(401).json({ error: "Invalid token" });
  }
};

// ── Payment Utilities (mirrors constants/pricing.ts) ────────────────────────
// Fallback defaults. The live values are read from the Firestore doc
// `config/pricing` (editable via the founder admin dashboard). These are used
// only when that doc is missing or a field is invalid, so charges never break.
// ── No platform cut ─────────────────────────────────────────────────────────
// There is ONE fare rate: the passenger is charged it and the driver is
// credited it, so a $5.00 fare earns the driver $5.00. This used to be two
// numbers (25 charged / 20 credited) applied as a ratio in /rides/finish — a
// silent 20% cut. The second field was DELETED rather than set equal to the
// first, so a stray edit to `config/pricing` cannot quietly reintroduce a
// spread.
//
// Stripe's fee is not taken out of the fare. It is added on top once per
// monthly settlement by grossUpChargeCents(), so the passenger covers it and
// UniLift nets exactly what it owes drivers.
//
// Mirrors DEFAULT_RIDE_PRICING in constants/pricing.ts and the twin server.
const DEFAULT_PRICING = {
  passengerRateCentsPerKm: 25,   // charged AND credited
  minimumChargeCents: 100,
  minimumDistanceKm: 0.5,
  stripePercentBps: 290,         // 2.90% — Stripe CA standard
  stripeFixedCents: 30,          // $0.30 per successful charge
  // RETIRED, kept at 0 as a rollback lever. This charged the passenger 4% of
  // every fare to fund Connect payout fees. The cost it funds is $2.00/month per
  // account that receives a payout, plus 0.25% + $0.25 per payout — almost
  // entirely fixed per DRIVER PER MONTH, while this was collected per RIDE. The
  // two shapes never matched:
  //
  //     driver earns  $30 → real cost $2.33, 4% collected $1.20  (short $1.13)
  //     driver earns  $50 → real cost $2.38, 4% collected $2.00  (short $0.38)
  //     driver earns $200 → real cost $2.75, 4% collected $8.00  (over $5.25)
  //
  // Replaced by payoutFeeFlatCents + payoutFeeBps below, deducted from the
  // payout itself, which tracks the cost exactly at any size. Setting this back
  // above 0 in `config/pricing` (~60s TTL) is a no-redeploy rollback.
  payoutReserveBps: 0,
  // What one monthly payout actually costs, deducted from that payout rather
  // than collected from passengers per ride. $2.00 Connect Express
  // active-account fee + $0.25 per payout, plus Stripe's 0.25% of the amount.
  //
  // Charged ONCE per payout. The flat part is billed per driver per month no
  // matter how many rides produced the balance, which is exactly why spreading
  // it across rides was wrong.
  payoutFeeFlatCents: 225,
  payoutFeeBps: 25,
  minSettlementCents: 100,       // below this the balance rolls forward
  // The smallest amount Stripe will actually take (CAD minimum ~$0.50). Distinct
  // from minSettlementCents: that decides what is worth charging this month,
  // this decides what is collectable at all. Account deletion gates on THIS, so
  // raising the settlement floor can never quietly write off a real debt.
  minChargeableCents: 50,
  // Driver earnings below this roll to next month. Connect Express bills a flat
  // $2/month per account that receives ANY payout, so a $3 payout costs nearly
  // what a $300 one does. No payout in a month = no active-account fee.
  minPayoutCents: 2500,          // $25.00
  // Ceiling on unsettled ride debt before a passenger is blocked from booking.
  //
  // A card is not touched until settlement, so without this a passenger rides on
  // credit for up to 31 days with no limit — and because a failed settlement
  // leaves both counters untouched, a DECLINED card did not stop them either.
  // They kept riding, the debt kept growing, and the drivers who carried them
  // were credited in full at /rides/finish.
  //
  // $75 is roughly 30 typical rides. High enough that an ordinary month never
  // touches it, low enough that a bad debt is a bad debt and not a disaster.
  maxOutstandingChargeCents: 7500,
  /** ISO currency for every charge and transfer. Not a number, so it is excluded
   *  from the numeric validation below and read straight through. */
  currency: "cad",
  /** Held back from what the payout sweeper will spend. Stripe fees, refunds and
   *  chargebacks draw on the same balance, so paying it down to zero leaves
   *  nothing to absorb them. 0 until you decide the number. */
  operatingFloatCents: 0,
};

// Fields where 0 is a legitimate configured value rather than "unset".
// Everything else must be > 0. Without this split a `payoutReserveBps: 0` or
// `stripeFixedCents: 0` in config/pricing would be discarded by a bare `> 0`
// guard and fall back to the default — the field would stop working exactly
// when someone tried to switch it off.
const PRICING_ZERO_ALLOWED = new Set([
  "stripePercentBps",
  "stripeFixedCents",
  "payoutReserveBps",
  "payoutFeeFlatCents",
  "payoutFeeBps",
]);

function isValidPricingValue(key, value) {
  // `currency` is the one non-numeric field. Accept a plain 3-letter code only —
  // anything else falls back to the default rather than reaching Stripe.
  if (key === "currency") {
    return typeof value === "string" && /^[a-z]{3}$/i.test(value);
  }
  const n = Number(value);
  if (!Number.isFinite(n)) return false;
  return PRICING_ZERO_ALLOWED.has(key) ? n >= 0 : n > 0;
}

/**
 * Gross up a settlement so that, after Stripe's cut, UniLift receives exactly
 * `netCents` — the amount it owes drivers.
 *
 *     gross = ceil( (net + fixed) / (1 - percent) )
 *
 * `ceil`, not `round`: rounding down leaves the platform a cent short on every
 * settlement, which is the exact debt this prevents. The sub-cent surplus is
 * the intended direction of error.
 *
 * Applied ONCE per monthly settlement, never per ride — billing is netted, so
 * Stripe's fixed fee is incurred once a month. Per-ride application would
 * collect ten fixed fees against Stripe's one, and over-collection is a
 * platform cut by another name.
 *
 * MIRRORED in constants/pricing.ts and the twin server — change all three.
 */
function grossUpChargeCents(netCents, pricing) {
  if (!Number.isFinite(netCents) || netCents <= 0) return 0;
  const pct = pricing.stripePercentBps / 10000;
  // A rate at or above 100% makes the division diverge or flip sign.
  if (!(pct >= 0 && pct < 1)) {
    return Math.ceil(netCents + pricing.stripeFixedCents);
  }
  return Math.ceil((netCents + pricing.stripeFixedCents) / (1 - pct));
}

// ── Fare guardrails ─────────────────────────────────────────────────────────
//
// The fare used to be derived from coordinates BOTH parties could set freely, and
// nothing bounded the result:
//
//   • the destination came from `ride.destinationCoords`, which in a Flow A accept
//     is whatever `destinationLat/Lng` the DRIVER put in the request body. A driver
//     could name a point 1 000 km away and bill the passenger hundreds of dollars
//     for a trip across town. The dropoff radius gate did not catch it, because
//     that gate measures against `passengerDropoffs` — a different field.
//   • the origin came from `rideRequests.origin`, written by the PASSENGER. Setting
//     it next to the destination made any ride cost the $1 minimum, which defrauds
//     the driver rather than the platform.
//
// Two things fix it, and both are needed. `legFare()` below prices the passenger's
// OWN pickup → their OWN dropoff, the same pair the radius gate already uses, so
// the charge and the gate finally agree. And the charge is capped against the
// quote the passenger was shown when they made the request.

/** How far above the quoted fare a charge may land before it is clamped. Real
 *  rides do drift — a detour, a corrected dropoff — so this is not 1.0, but it is
 *  tight enough that a fabricated destination cannot become a fabricated bill. */
const FARE_TOLERANCE = 1.5;

/** Absolute ceiling per passenger per ride, independent of any quote. A backstop
 *  for rides that carry no quote at all (planned rides, legacy docs). $150. */
const MAX_FARE_CENTS = 15000;

/** Upper bound on a driver-declared vehicle capacity. */
const MAX_VEHICLE_SEATS = 8;

/** The billable distance for one passenger: their own pickup → their own dropoff.
 *  Falls back to the ride's destination only when the passenger has no recorded
 *  dropoff, and to the ride's origin only when they have no recorded pickup. */
function legDistanceKm(ride, passengerId) {
  const pickups = ride.passengerPickups || {};
  const from = gpLL(pickups[passengerId]) || gpLL(ride.localisation);
  const to = dropoffReference(ride, passengerId);
  if (!from || !to) return null;
  return haversineKm(from.lat, from.lng, to.lat, to.lng);
}

/** Clamp a computed fare to what the passenger actually agreed to. Returns the
 *  fare plus the reason it was clamped, so /rides/finish can record it. */
function clampFare(fareCents, quotedFareCents) {
  let capped = Math.min(fareCents, MAX_FARE_CENTS);
  let reason = capped < fareCents ? "max_fare" : null;
  const quote = Number(quotedFareCents);
  if (Number.isFinite(quote) && quote > 0) {
    const ceiling = Math.ceil(quote * FARE_TOLERANCE);
    if (capped > ceiling) {
      capped = ceiling;
      reason = "quote_tolerance";
    }
  }
  return { fareCents: capped, clampedBy: reason };
}

/** Legacy per-ride reserve. 0 by default — superseded by payoutFeeCents(). */
function payoutReserveCents(fareCents, pricing) {
  if (!Number.isFinite(fareCents) || fareCents <= 0) return 0;
  return Math.round(fareCents * (pricing.payoutReserveBps / 10000));
}

/** What Stripe Connect costs to move ONE monthly payout, deducted from it.
 *
 *  Flat part + a share of the amount, matching Stripe's own shape ($2.00/month
 *  active account + $0.25 per payout, plus 0.25%). Charged once per payout,
 *  never per ride.
 *
 *  Clamped to the payout: a fee may reduce a payout to zero but must never make
 *  it negative — that would turn a payout into a debt the driver never agreed to.
 *
 *  MIRRORED in constants/pricing.ts as calculatePayoutFeeCents and in the twin
 *  server. */
function payoutFeeCents(payoutCents, pricing) {
  if (!Number.isFinite(payoutCents) || payoutCents <= 0) return 0;
  const fee = pricing.payoutFeeFlatCents
    + Math.round(payoutCents * (pricing.payoutFeeBps / 10000));
  return Math.min(Math.max(0, fee), payoutCents);
}

// Per-env cache of the pricing doc. Cloud Function instances are reused, so this
// avoids a Firestore read on every ride completion. `db` is the per-request
// dev/prod handle, so we key by env to keep uniliftdev and uniliftdefault
// separate. TTL keeps dashboard edits taking effect within ~60s.
const PRICING_TTL_MS = 60 * 1000;
const pricingCache = new Map(); // env -> { value, expires }

async function getPricing(db) {
  const env = db === devDb ? "dev" : "prod";
  const cached = pricingCache.get(env);
  if (cached && cached.expires > Date.now()) return cached.value;

  const value = { ...DEFAULT_PRICING };
  try {
    const snap = await db.collection("config").doc("pricing").get();
    if (snap.exists) {
      const data = snap.data() || {};
      for (const key of Object.keys(DEFAULT_PRICING)) {
        if (!isValidPricingValue(key, data[key])) continue;
        value[key] = key === "currency" ? String(data[key]).toLowerCase() : Number(data[key]);
      }
    }
  } catch (err) {
    console.warn("getPricing failed, using defaults:", err.message);
  }

  pricingCache.set(env, { value, expires: Date.now() + PRICING_TTL_MS });
  return value;
}

// ── Push recipient eligibility ───────────────────────────────────────────────
// `/requests/dispatch` fans out to every user in whichever database it is handed.
// The database split (uniliftdev vs uniliftdefault) separates the ACCOUNTS but not
// the DEVICES: an Expo push token identifies a device installation, one EAS
// project serves every environment, and both builds share the bundle id — so a
// token stored in `uniliftdev` rings whatever UniLift build is on that phone,
// possibly the App Store one. Firebase Auth is shared too (one project, two named
// databases), so a real person who once signed in against dev still has a
// `uniliftdev/users/{uid}` doc holding a live token. That is how a dev ride test
// ended up paging real users.
//
// Recipients are therefore filtered on which environment last registered their
// token — a field the client refreshes on every authenticated launch, so this
// needs no allowlist and no migration. The rule is deliberately asymmetric:
//
//   • dev  → STRICT. The token must be tagged "dev" AND have been re-registered
//     within DEV_TOKEN_MAX_AGE_DAYS. Untagged is excluded (it cannot be shown to
//     belong to a dev build), and the recency check catches a device that ran a
//     dev build once and has since gone back to the store build — its stale "dev"
//     tag would otherwise ring the production app.
//   • prod → PERMISSIVE. Only an explicit "dev" tag is excluded. Untagged tokens
//     must keep working, because every user already on the App Store predates
//     tagging. Recency must NOT apply here: someone who has not opened the app in
//     a month is still a perfectly valid production recipient.
const DEV_TOKEN_MAX_AGE_DAYS = 14;
const DEV_TOKEN_MAX_AGE_MS = DEV_TOKEN_MAX_AGE_DAYS * 24 * 60 * 60 * 1000;

/** "dev" | "production" — matches the client's EXPO_PUBLIC_APP_ENV values. */
const envLabel = (db) => (db === devDb ? "dev" : "production");

/** Age of the token registration in ms, or null when missing/unparseable. */
function tokenAgeMs(userData, now) {
  const raw = userData.expoPushTokenUpdatedAt;
  if (!raw) return null;
  // Firestore Timestamp when written server-side; ISO string when written by the
  // client through the REST API (which is the path savePushTokenToFirestore uses).
  const ms = typeof raw.toMillis === "function" ? raw.toMillis() : Date.parse(raw);
  return Number.isFinite(ms) ? now - ms : null;
}

/**
 * May this user doc receive a BROADCAST push in `db`'s environment?
 * Returns { ok, reason }; `reason` is a human-readable explanation reused verbatim
 * by /dev/dispatch-report, so the rule is defined in exactly one place.
 *
 * Broadcast only. Targeted sends (driver_accepted, ride_cancelled, …) use the
 * looser `pushEnvMatches` instead — they answer an action the user just took in
 * this same environment, so they must not be filtered on driver mode or on token
 * age, which would silently drop a legitimate reply to an active tester.
 */
function isEligibleRecipient(userData, db, now = Date.now()) {
  const u = userData || {};
  const no = (reason) => ({ ok: false, reason });

  if (u.driverModeEnabled === false) return no("driverModeEnabled is false");
  if (!u.expoPushToken) return no("no expoPushToken on the user doc");

  const tokenEnv = typeof u.expoPushTokenEnv === "string" ? u.expoPushTokenEnv : null;

  if (envLabel(db) !== "dev") {
    // Production: exclude only tokens known to belong to a dev client.
    return tokenEnv === "dev"
      ? no("push token was registered by a dev client")
      : { ok: true, reason: null };
  }

  if (tokenEnv !== "dev") {
    return no(
      tokenEnv
        ? `push token was registered by a "${tokenEnv}" client`
        : "push token predates env tagging — open the app on a dev build to refresh it",
    );
  }
  const age = tokenAgeMs(u, now);
  if (age === null) {
    return no("push token has no registration date — open the app on a dev build to refresh it");
  }
  if (age > DEV_TOKEN_MAX_AGE_MS) {
    return no(
      `dev push token is stale (${Math.floor(age / 86400000)}d old, max ${DEV_TOKEN_MAX_AGE_DAYS}d)` +
        " — open the app on a dev build to refresh it",
    );
  }
  return { ok: true, reason: null };
}

// Production fan-out cap. `config/broadcast` is optional and DEFAULT-ALLOW, so
// production works with no doc to remember:
//   • absent / empty          → allowed, capped at DEFAULT_MAX_RECIPIENTS
//   • { prodEnabled: false }  → kill switch, notifies nobody
//   • { maxRecipients: N }    → custom cap
// Editable from the Firebase Console and re-read every ~60s, so it reaches
// binaries already installed on phones without a redeploy. Containment comes from
// isEligibleRecipient above; this is only a blast-radius rail.
const DEFAULT_MAX_RECIPIENTS = 500;

/** Minimum gap between two dispatches of the same request. */
const DISPATCH_COOLDOWN_MS = 60 * 1000;
/** Hard cap on how many times one request may be fanned out. */
const MAX_DISPATCHES_PER_REQUEST = 5;
const BROADCAST_CONFIG_TTL_MS = 60 * 1000;
const broadcastConfigCache = new Map(); // env -> { value, expires }

async function getBroadcastLimit(db) {
  const env = envLabel(db);
  // Dev is already bounded by the strict eligibility rule and by how few accounts
  // exist in uniliftdev, so no cap is applied there.
  if (env === "dev") return { limit: Infinity, denyReason: null };

  const cached = broadcastConfigCache.get(env);
  if (cached && cached.expires > Date.now()) return cached.value;

  let value;
  try {
    const snap = await db.collection("config").doc("broadcast").get();
    const data = snap.exists ? snap.data() || {} : {};
    if (data.prodEnabled === false) {
      value = {
        limit: 0,
        denyReason: "config/broadcast.prodEnabled is false — production broadcast is disabled",
      };
    } else {
      const cap = Number(data.maxRecipients);
      value = {
        limit: Number.isFinite(cap) && cap > 0 ? Math.floor(cap) : DEFAULT_MAX_RECIPIENTS,
        denyReason: null,
      };
    }
  } catch (err) {
    // Fall back to the default cap rather than dropping the dispatch — the
    // eligibility filter is what provides containment, not this number.
    console.warn("getBroadcastLimit failed, using default cap:", err.message);
    return { limit: DEFAULT_MAX_RECIPIENTS, denyReason: null };
  }

  broadcastConfigCache.set(env, { value, expires: Date.now() + BROADCAST_CONFIG_TTL_MS });
  return value;
}

// ── Eligible-recipient cache (the "drivers available" stat) ──────────────────
// `/drivers/available` is polled by every client that has the request-a-lift
// sheet open, and under broadcast dispatch its answer is simply "how many users
// are eligible push recipients" — which meant an unbounded scan of `users` on
// EVERY poll. Cost was O(users x concurrent sheets x polls/min).
//
// The eligible set only changes when someone toggles driver mode or re-registers
// a push token, so a short TTL makes the stat cost one scan per minute per
// warm instance instead of one scan per poll per client. Same shape and TTL as
// getPricing / getBroadcastLimit above.
//
// Deliberately NOT used by /requests/dispatch: that runs once per ride request
// rather than on a poll loop, and it must fan out to the live set — never a set
// that could be up to a minute stale.
const ELIGIBLE_COUNT_TTL_MS = 60 * 1000;
const eligibleCountCache = new Map(); // env -> { value: Set<uid>, expires }

async function getEligibleRecipientIds(db) {
  const env = envLabel(db);
  const cached = eligibleCountCache.get(env);
  if (cached && cached.expires > Date.now()) return cached.value;

  const usersSnap = await db.collection("users").get();
  const now = Date.now();
  const value = new Set();
  usersSnap.docs.forEach((doc) => {
    if (isEligibleRecipient(doc.data(), db, now).ok) value.add(doc.id);
  });

  eligibleCountCache.set(env, { value, expires: Date.now() + ELIGIBLE_COUNT_TTL_MS });
  return value;
}
function haversineKm(lat1, lon1, lat2, lon2) {
  if ([lat1, lon1, lat2, lon2].some((v) => v == null || isNaN(v))) return 0;
  const R = 6371;
  const dLat = ((lat2 - lat1) * Math.PI) / 180;
  const dLon = ((lon2 - lon1) * Math.PI) / 180;
  const a =
    Math.sin(dLat / 2) ** 2 +
    Math.cos((lat1 * Math.PI) / 180) *
      Math.cos((lat2 * Math.PI) / 180) *
      Math.sin(dLon / 2) ** 2;
  return R * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
}

function calculatePassengerChargeCents(distKm, pricing = DEFAULT_PRICING) {
  const d = Math.max(distKm, pricing.minimumDistanceKm);
  return Math.max(
    Math.round(d * pricing.passengerRateCentsPerKm),
    pricing.minimumChargeCents,
  );
}

// ── Public profile projection ────────────────────────────────────────────────
//
// `users/{uid}` holds email, home address, birth date, push token, Stripe ids and
// money counters. It used to be readable by any signed-in user, which meant one
// throwaway signup could enumerate the collection and dump the whole user base.
// It is now owner-only, and the handful of fields other people legitimately see
// on a ride card or profile modal live in `users/{uid}/public/profile`.
//
// That doc is written ONLY here, by the admin SDK. Clients cannot write it (see
// firestore.rules), which is also what stops a user handing themselves a 5-star,
// 500-ride reputation — the reputation fields are no longer on a doc they own.
//
// Note what is deliberately NOT projected: email, birthDate (only the derived
// age), homeAddress, localisation, phone, push token, Stripe ids, every money
// counter, and driverModeEnabled (the server reads that with the admin SDK).

/** Whole years between `birthDate` and today, or null if unparseable. Mirrors
 *  ageFromBirthDate in services/userService.ts. */
function ageFromBirthDate(birthDate) {
  const birth = new Date(String(birthDate || ""));
  if (isNaN(birth.getTime())) return null;
  const today = new Date();
  let age = today.getFullYear() - birth.getFullYear();
  const m = today.getMonth() - birth.getMonth();
  if (m < 0 || (m === 0 && today.getDate() < birth.getDate())) age -= 1;
  return age > 0 && age < 130 ? age : null;
}

/** The exact subset of a user doc that other users may see. Anything not listed
 *  here stays private by construction — this is an allowlist, never a blocklist,
 *  so a new PII field added to the user doc is private by default. */
function publicProfileFrom(uid, data) {
  const u = data || {};
  const email = typeof u.email === "string" ? u.email : "";
  const sum = Number(u.ratingSum);
  const count = Number(u.ratingCount);
  const hasNewShape = Number.isFinite(sum) && Number.isFinite(count) && count > 0;
  // Legacy rides carry `ratings` (the rounded average) + `ratingWeigth`. Derive
  // a sum from them so an existing driver's reputation survives the migration.
  const legacyAvg = Number(u.ratings);
  const legacyWeight = Number(u.ratingWeigth);
  const hasLegacy = Number.isFinite(legacyAvg) && Number.isFinite(legacyWeight) && legacyWeight > 0;

  const ratingSum = hasNewShape ? sum : (hasLegacy ? legacyAvg * legacyWeight : 0);
  const ratingCount = hasNewShape ? count : (hasLegacy ? legacyWeight : 0);
  // Stored as a float and rounded only for display, so a 4.6 average stops being
  // shown — and stops being fed back into the next average — as a 5.
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

const publicProfileRef = (db, uid) =>
  db.collection("users").doc(uid).collection("public").doc("profile");

/** Re-project a user doc into its public profile. Best-effort: a failed mirror
 *  must never fail the operation that triggered it — the trigger below repairs
 *  it on the next write to the user doc. */
async function writePublicProfile(db, uid, data) {
  try {
    await publicProfileRef(db, uid).set(publicProfileFrom(uid, data), { merge: true });
  } catch (err) {
    console.warn("writePublicProfile failed for", uid, err.message);
  }
}

// ── Helper: get or create Stripe customer ────────────────────────────────────
// If the stored customer ID no longer exists in Stripe (e.g. deleted via
// dashboard), wipes the stale ID + payment method and creates a fresh customer.
async function getOrCreateCustomer(uid, db, stripe) {
  const userRef = db.collection("users").doc(uid);
  const snap = await userRef.get();
  const data = snap.data() ?? {};

  if (data.stripeCustomerId) {
    try {
      const existing = await stripe.customers.retrieve(data.stripeCustomerId);
      if (!existing.deleted) return data.stripeCustomerId;
    } catch {
      // Customer not found in Stripe — fall through to recreate
    }
    // Stale record: clear it so the user starts fresh
    await userRef.set(
      {
        stripeCustomerId: null,
        stripePaymentMethodId: null,
        stripePaymentMethodLast4: FieldValue.delete(),
        stripePaymentMethodBrand: FieldValue.delete(),
      },
      { merge: true },
    );
  }

  // Email and name make a customer identifiable in the Stripe dashboard, which
  // is where refunds and chargebacks get handled. Without them every customer is
  // an opaque cus_ id.
  const customer = await stripe.customers.create({
    ...(typeof data.email === "string" && data.email ? { email: data.email } : {}),
    ...(typeof data.name === "string" && data.name ? { name: data.name } : {}),
    metadata: { firebaseUid: uid },
  });
  await userRef.set({ stripeCustomerId: customer.id }, { merge: true });
  return customer.id;
}

// ── Health check ─────────────────────────────────────────────────────────────
app.get("/hello", (req, res) => {
  res.json({ status: "ok" });
});

// ── Config ───────────────────────────────────────────────────────────────────
// Returns the Stripe publishable key that matches the server's secret key.
// The client fetches this on startup so both sides always use the same key pair.
// No auth required — publishable keys are intentionally public.
app.get("/config", (req, res) => {
  const isDev = req.headers["x-app-env"] === "dev";
  res.json({
    stripePublishableKey: getStripePublishableKey(req),
    env: isDev ? "development" : "production",
  });
});

// ── Wallet: Setup ────────────────────────────────────────────────────────────
app.post("/wallet/setup", authenticate, async (req, res) => {
  const db = getDb(req); const stripe = getStripe(req);
  try {
    const customerId = await getOrCreateCustomer(req.uid, db, stripe);
    const ephemeralKey = await stripe.ephemeralKeys.create(
      { customer: customerId },
      { apiVersion: "2024-06-20" },
    );
    const snap = await db.collection("users").doc(req.uid).get();
    const data = snap.data() ?? {};

    const paymentMethods = await stripe.paymentMethods.list({
      customer: customerId,
      type: "card",
    });
    const pm = paymentMethods.data[0] ?? null;

    res.json({
      customerId,
      ephemeralKey: ephemeralKey.secret,
      pendingChargeCents: data.pendingChargeCents ?? 0,
      pendingEarningsCents: data.pendingEarningsCents ?? 0,
      paymentMethod: pm
        ? { id: pm.id, last4: pm.card.last4, brand: pm.card.brand }
        : null,
      // Driver payout state, served from the user doc rather than a Stripe call:
      // WalletContext already hits this route on every load, so piggybacking
      // costs no extra round trip and no extra Stripe latency. The values are
      // kept fresh by the account.updated webhook and /connect/status.
      connect: {
        status: data.stripeConnectStatus ?? "none",
        payoutsEnabled: data.stripeConnectPayoutsEnabled === true,
        requirementsDue: Array.isArray(data.stripeConnectRequirementsDue)
          ? data.stripeConnectRequirementsDue
          : [],
        bankLast4: data.stripeConnectBankLast4 ?? null,
      },
    });
  } catch (err) {
    console.error("/wallet/setup:", err);
    res.status(500).json({ error: err.message });
  }
});

// ── Wallet: Setup Payment Method (save card via SetupIntent) ─────────────────
app.post("/wallet/setup-payment-method", authenticate, async (req, res) => {
  const db = getDb(req); const stripe = getStripe(req);
  try {
    const customerId = await getOrCreateCustomer(req.uid, db, stripe);
    // Explicitly require `card`. Cards are always available and are the only
    // payment type that supports off-session reuse (needed for monthly
    // billing). Using automatic_payment_methods here makes the SetupIntent
    // depend on per-mode Dashboard payment-method toggles, which is the source
    // of "this payment method isn't enabled in your settings" errors.
    const setupIntent = await stripe.setupIntents.create({
      customer: customerId,
      payment_method_types: ["card"],
      usage: "off_session",
    });
    const ephemeralKey = await stripe.ephemeralKeys.create(
      { customer: customerId },
      { apiVersion: "2024-06-20" },
    );
    res.json({
      clientSecret: setupIntent.client_secret,
      customerId,
      ephemeralKey: ephemeralKey.secret,
    });
  } catch (err) {
    console.error("/wallet/setup-payment-method:", err);
    res.status(500).json({ error: err.message });
  }
});

// ── Wallet: Confirm Payment Method ───────────────────────────────────────────
app.post("/wallet/confirm-payment-method", authenticate, async (req, res) => {
  const db = getDb(req); const stripe = getStripe(req);
  try {
    const { setupIntentId } = req.body;
    if (!setupIntentId) {
      return res.status(400).json({ error: "setupIntentId is required" });
    }
    const setupIntent = await stripe.setupIntents.retrieve(setupIntentId);
    if (setupIntent.status !== "succeeded") {
      return res.status(400).json({ error: "SetupIntent has not succeeded" });
    }
    const pm = await stripe.paymentMethods.retrieve(setupIntent.payment_method);
    const customerId = await getOrCreateCustomer(req.uid, db, stripe);
    await stripe.customers.update(customerId, {
      invoice_settings: { default_payment_method: pm.id },
    });
    await db.collection("users").doc(req.uid).update({
      stripePaymentMethodId: pm.id,
      stripePaymentMethodLast4: pm.card.last4,
      stripePaymentMethodBrand: pm.card.brand,
    });
    res.json({ paymentMethod: { id: pm.id, last4: pm.card.last4, brand: pm.card.brand } });
  } catch (err) {
    console.error("/wallet/confirm-payment-method:", err);
    res.status(500).json({ error: err.message });
  }
});

// ── Wallet: Remove Payment Method ────────────────────────────────────────────
app.post("/wallet/remove-payment-method", authenticate, async (req, res) => {
  const db = getDb(req); const stripe = getStripe(req);
  try {
    const snap = await db.collection("users").doc(req.uid).get();
    const pmId = (snap.data() ?? {}).stripePaymentMethodId;
    if (pmId) {
      await stripe.paymentMethods.detach(pmId);
    }
    await db.collection("users").doc(req.uid).update({
      stripePaymentMethodId: FieldValue.delete(),
      stripePaymentMethodLast4: FieldValue.delete(),
      stripePaymentMethodBrand: FieldValue.delete(),
    });
    res.json({ success: true });
  } catch (err) {
    console.error("/wallet/remove-payment-method:", err);
    res.status(500).json({ error: err.message });
  }
});

// ── Wallet: Transactions ─────────────────────────────────────────────────────
app.get("/wallet/transactions", authenticate, async (req, res) => {
  const db = getDb(req);
  try {
    const snap = await db
      .collection("users")
      .doc(req.uid)
      .collection("transactions")
      .orderBy("createdAt", "desc")
      .limit(50)
      .get();

    const transactions = snap.docs.map((doc) => ({ id: doc.id, ...doc.data() }));
    res.json({ transactions });
  } catch (err) {
    console.error("/wallet/transactions:", err);
    res.status(500).json({ error: err.message });
  }
});

// ── Stripe Connect (driver payouts) ─────────────────────────────────────────
//
// How a driver gets PAID. Deliberately separate from the /wallet/* routes above,
// which are how a passenger PAYS: a saved card (`pm_...`) is a pull-only
// credential and can never be a payout destination, so a driver registers a
// Stripe Express account of their own.
//
// The charge half of the system is untouched by any of this. UniLift uses
// SEPARATE CHARGES AND TRANSFERS: passengers are charged on the platform account
// exactly as before (same customer, same saved card, same off-session
// PaymentIntent in settleAllUsers), and Connect only adds a second, independent
// leg that moves already-collected funds out to drivers. Do NOT refactor toward
// destination charges or transfer_data — those bind one charge to one connected
// account, which is wrong here because a single monthly netted charge funds many
// different drivers.
//
// Shape mirrors /cert/adult/* : mint a Stripe-hosted link, bounce back into the
// app through an https endpoint, then reconcile. The account.updated webhook is
// the primary path for status; /connect/status is the client-driven fallback so
// onboarding still lands if the webhook is delayed or unconfigured.

/** Map a Stripe account object onto the six user-doc fields. One place, used by
 *  both the webhook and /connect/status so they can never disagree. */
function connectFieldsFromAccount(acct) {
  const payoutsEnabled = acct.payouts_enabled === true;
  const requirements = acct.requirements || {};
  const currentlyDue = Array.isArray(requirements.currently_due) ? requirements.currently_due : [];
  let status;
  if (payoutsEnabled) {
    status = "ready";
  } else if (requirements.disabled_reason) {
    // Stripe actively disabled it (failed verification, rejected, etc.) — this
    // needs the driver to go fix something, not just wait.
    status = "restricted";
  } else {
    // Either onboarding was never finished, or Stripe is still verifying.
    status = "pending";
  }
  const bank = (acct.external_accounts && Array.isArray(acct.external_accounts.data)
    ? acct.external_accounts.data[0]
    : null);
  const fields = {
    stripeConnectAccountId: acct.id,
    stripeConnectStatus: status,
    stripeConnectPayoutsEnabled: payoutsEnabled,
    stripeConnectRequirementsDue: currentlyDue,
    stripeConnectUpdatedAt: new Date().toISOString(),
  };
  if (bank && bank.last4) fields.stripeConnectBankLast4 = bank.last4;
  return fields;
}

/** Split a stored display name into the first/last pair Stripe wants. Anything
 *  we can prefill is a question the driver is never asked, so even a rough split
 *  is worth it — the hosted form shows the values and they can correct them. */
function splitName(full) {
  const parts = String(full || "").trim().split(/\s+/).filter(Boolean);
  if (parts.length === 0) return null;
  if (parts.length === 1) return { first_name: parts[0] };
  return { first_name: parts[0], last_name: parts.slice(1).join(" ") };
}

/** "1998-04-23" -> Stripe's {day, month, year}. Returns null on anything we
 *  cannot parse confidently, because a wrong DOB in a KYC form fails
 *  verification in a way the driver cannot easily diagnose. */
function stripeDobFromBirthDate(birthDate) {
  const m = /^(\d{4})-(\d{2})-(\d{2})/.exec(String(birthDate || ""));
  if (!m) return null;
  const [, y, mo, d] = m;
  const year = Number(y), month = Number(mo), day = Number(d);
  if (!year || !month || !day || month > 12 || day > 31) return null;
  return { day, month, year };
}

/** Patch prefill fields onto an account that predates them, so a driver who
 *  started onboarding earlier is not still asked for a job title and a website
 *  we can answer for them. Best-effort by design: Stripe restricts updating some
 *  fields once onboarding is under way, and a failed backfill must never block
 *  someone from finishing their setup. Only fills what is actually blank, so a
 *  value the driver deliberately changed is left alone. */
async function backfillPrefill(account, data, stripe) {
  const profile = account.business_profile || {};
  const individual = account.individual || {};
  const patch = {};

  const businessProfile = {};
  if (!profile.url) businessProfile.url = PLATFORM_URL;
  if (!profile.mcc) businessProfile.mcc = "4121";
  if (!profile.product_description) {
    businessProfile.product_description = "Peer-to-peer ridesharing between students";
  }
  if (Object.keys(businessProfile).length) patch.business_profile = businessProfile;

  if (account.business_type === "individual" &&
      !(individual.relationship && individual.relationship.title)) {
    patch.individual = { relationship: { title: "Rideshare driver" } };
  }

  if (!Object.keys(patch).length) return account;
  try {
    return await stripe.accounts.update(account.id, patch);
  } catch (err) {
    console.warn("connect prefill backfill skipped:", err.message);
    return account;
  }
}

// ── Stripe failure classification ────────────────────────────────────────────
// Every /connect/* route used to collapse each distinct failure — Connect not
// enabled on the platform, a rejected prefill field, a revoked key, a Stripe
// outage — into one opaque `500 {error:"internal"}`. On a production build that
// is undiagnosable end to end: the app's own logging is a no-op outside dev
// (devWarn in constants/runtime-config.ts), and `firebase functions:log` does not
// surface a gen-2 function's console output, so "Couldn't open Stripe" was the
// entire signal anyone had.
//
// This turns a Stripe throw into a stable app-level code plus a detail object
// safe to hand a client. `requestId` is the valuable half — it pastes straight
// into Stripe dashboard search or a support ticket.
//
// Why the message is matched at all: when Connect is not enabled on a live
// platform, accounts.create throws a StripeInvalidRequestError with no `code`, so
// `type` alone cannot tell it apart from a bad prefill field. The matching stays
// server-side; the message itself never leaves the process unless the caller is
// an admin.
function classifyStripeError(err, step = null) {
  const e = err || {};
  const raw = e.raw || {};
  const message = String(e.message || "");
  const detail = {
    type: e.type || null,
    code: e.code || raw.code || null,
    param: e.param || raw.param || null,
    requestId: e.requestId || raw.request_id || null,
    ...(step ? { step } : {}),
  };
  const as = (code, status) => ({ code, status, detail, message });

  if (/only stripe connect platforms|signed? up for connect|connect.*not.*enabled/i.test(message)) {
    return as("connect_not_enabled", 409);
  }
  if (/platform profile|complete your platform|under review|platform.*restricted/i.test(message)) {
    return as("platform_profile_incomplete", 409);
  }
  switch (e.type) {
    case "StripeAuthenticationError": return as("stripe_auth", 500);
    // A restricted key (rk_live_…) without Connect write scope lands here, and
    // looks exactly like "Connect not enabled" from the app if left unnamed.
    case "StripePermissionError":     return as("stripe_permission", 500);
    case "StripeConnectionError":
    case "StripeAPIError":            return as("stripe_unavailable", 503);
    case "StripeRateLimitError":      return as("stripe_rate_limited", 503);
    case "StripeInvalidRequestError":
      if (detail.param) return as("stripe_invalid_param", 400);
      return as("internal", 500);
    default:                          return as("internal", 500);
  }
}

/** Does this caller hold the `admin` custom claim? Same gate as
 *  /admin/dispatch-report. A failed lookup is never fatal — it only costs the
 *  verbatim message. */
async function callerIsAdmin(uid) {
  try {
    const user = await admin.auth().getUser(uid);
    return Boolean(user.customClaims && user.customClaims.admin === true);
  } catch {
    return false;
  }
}

/** The single funnel every /connect/* catch goes through, so the log line and
 *  the response body can never disagree about a diagnosis.
 *
 *  The verbatim Stripe message always reaches Cloud Logging, and reaches the
 *  CALLER only when they are an admin: it can embed the connected account id and
 *  the name/email we prefilled, it is unbounded, and it is English-only in a
 *  bilingual app — wrong for a driver's alert, right for whoever is debugging on
 *  their own phone with no rebuild. */
async function respondStripeError(route, err, req, res, step = null) {
  const { code, status, detail, message } = classifyStripeError(err, step);
  console.error(`${route} error:`, JSON.stringify({ ...detail, error: code, message }));
  const body = { error: code, detail };
  if (await callerIsAdmin(req.uid)) body.message = message.slice(0, 300);
  return res.status(status).json(body);
}

/** Get-or-create the driver's Express account. Sibling of getOrCreateCustomer,
 *  including its self-healing: an id that no longer resolves in Stripe is
 *  cleared and recreated rather than wedging the driver forever. */
async function getOrCreateConnectAccount(uid, db, stripe) {
  const userRef = db.collection("users").doc(uid);
  const snap = await userRef.get();
  const data = snap.data() ?? {};

  if (data.stripeConnectAccountId) {
    try {
      const existing = await stripe.accounts.retrieve(data.stripeConnectAccountId);
      if (existing && !existing.deleted) return backfillPrefill(existing, data, stripe);
    } catch (err) {
      // ONLY a genuinely missing account may be recreated. The bare catch this
      // replaces treated a Stripe outage, a revoked key or a permission error as
      // "not found" as well — and then the clear below wiped
      // stripeConnectAccountId, losing the only handle to a driver's completed,
      // verified account and sending them through full KYC again.
      if (!(err && (err.statusCode === 404 || (err.raw && err.raw.code === "resource_missing")))) {
        throw err;
      }
    }
    await userRef.set({
      stripeConnectAccountId: null,
      stripeConnectStatus: "none",
      stripeConnectPayoutsEnabled: false,
      stripeConnectBankLast4: FieldValue.delete(),
    }, { merge: true });
  }

  // Everything prefilled here is a question the driver never sees: per Stripe,
  // "Connect Onboarding won't ask for the prefilled information." Drivers are
  // individuals, not businesses, so the goal is to leave only genuine identity
  // verification — phone, address, SIN, bank — and strip every business-shaped
  // question out of the flow.
  const name = splitName(data.name);
  const dob = stripeDobFromBirthDate(data.birthDate);
  const account = await stripe.accounts.create({
    type: "express",
    country: "CA",
    ...(data.email ? { email: data.email } : {}),
    // Removes every company/entity question (directors, owners, tax ID...).
    business_type: "individual",
    business_profile: {
      // 4121 = Taxicabs & Limousines, the MCC Stripe itself uses for rideshare.
      // Setting it removes the "what industry are you in?" picker.
      mcc: "4121",
      // A driver has no website of their own, so the platform's stands in — it
      // is the site that actually describes the activity Stripe is underwriting,
      // and it is what a reviewer would want to look at. Fills the "business
      // website" question so the driver never sees it.
      url: PLATFORM_URL,
      // Fills the "describe your business" free-text step.
      product_description: "Peer-to-peer ridesharing between students",
      name: "UniLift driver",
    },
    individual: {
      ...(data.email ? { email: data.email } : {}),
      ...(name || {}),
      ...(dob ? { dob } : {}),
      relationship: {
        // Fills the "job title" question. Individual accounts have no company to
        // hold a role in, so Stripe just wants a plain occupation string.
        title: "Rideshare driver",
      },
      // NOT prefilled: address. UserProfile.homeAddress is free text and Stripe
      // needs structured line1/city/postal_code. A silently wrong address in a
      // KYC form fails verification later in a way the driver can't diagnose,
      // which is worse than asking them to type it.
    },
    // transfers ONLY. This is the minimum capability needed to receive money,
    // and Connect Onboarding collects requirements just for what you request —
    // asking for card_payments too would make the driver fill in more screens
    // for a capability UniLift never uses.
    capabilities: { transfers: { requested: true } },
    metadata: { firebaseUid: uid },
  });
  await userRef.set({
    stripeConnectAccountId: account.id,
    stripeConnectStatus: "pending",
    stripeConnectPayoutsEnabled: false,
    stripeConnectUpdatedAt: new Date().toISOString(),
  }, { merge: true });
  return account;
}

// POST /connect/onboard { returnUrl } — mint a fresh Stripe-hosted onboarding
// link. Never store or reuse the URL: AccountLinks are single-use and expire
// minutes after creation, so it is generated on each tap.
app.post("/connect/onboard", authenticate, async (req, res) => {
  const db = getDb(req); const stripe = getStripe(req);
  const appReturn = (req.body && req.body.returnUrl) || "";
  // Which of the two Stripe calls failed. They have different causes — the
  // account is where a platform-level refusal surfaces, the link is where a bad
  // return URL does — and one word in the log saves guessing between them.
  let step = "account";
  try {
    const account = await getOrCreateConnectAccount(req.uid, db, stripe);
    const bounce = appReturn
      ? `${PUBLIC_BASE_URL}/connect/return?app=${encodeURIComponent(appReturn)}`
      : `${PUBLIC_BASE_URL}/connect/return`;
    step = "link";
    const link = await stripe.accountLinks.create({
      account: account.id,
      // refresh_url is what Stripe sends the user to if the link expired before
      // they opened it; pointing it back at the app makes the retry one tap.
      refresh_url: bounce,
      return_url: bounce,
      type: "account_onboarding",
      // Ask only for what Stripe needs right now, rather than everything that
      // will eventually be due. Shortest possible first run; anything else is
      // collected later only if it actually becomes required.
      collection_options: { fields: "currently_due" },
    });
    res.json({ url: link.url });
  } catch (err) {
    return respondStripeError("/connect/onboard", err, req, res, step);
  }
});

// GET /connect/return?app=<deeplink> — https bounce. Stripe rejects custom app
// schemes as return URLs, so it lands here and we 302 into the app, which closes
// the in-app browser and resolves openAuthSessionAsync.
app.get("/connect/return", (req, res) => {
  const app = (req.query && req.query.app) || "";
  // Only scheme://… targets — never an open redirect to an arbitrary path.
  if (!app || !/^[a-z][a-z0-9+.-]*:\/\//i.test(String(app))) {
    return res.status(400).send("Missing or invalid return target");
  }
  res.redirect(302, String(app));
});

// POST /connect/status — re-read the account from Stripe and persist the six
// fields. The reconcile twin of the webhook: the app calls this when it returns
// from onboarding, so the state lands even if the webhook is slow or unset.
app.post("/connect/status", authenticate, async (req, res) => {
  const db = getDb(req); const stripe = getStripe(req);
  try {
    const snap = await db.collection("users").doc(req.uid).get();
    const accountId = (snap.data() ?? {}).stripeConnectAccountId;
    if (!accountId) {
      return res.json({ status: "none", payoutsEnabled: false, requirementsDue: [] });
    }
    const acct = await stripe.accounts.retrieve(accountId);
    const fields = connectFieldsFromAccount(acct);
    await db.collection("users").doc(req.uid).set(fields, { merge: true });
    res.json({
      status: fields.stripeConnectStatus,
      payoutsEnabled: fields.stripeConnectPayoutsEnabled,
      requirementsDue: fields.stripeConnectRequirementsDue,
      bankLast4: fields.stripeConnectBankLast4 ?? null,
    });
  } catch (err) {
    return respondStripeError("/connect/status", err, req, res);
  }
});

// POST /connect/dashboard — one-time Express dashboard link so a driver can
// change their bank details or see their payout history after onboarding.
app.post("/connect/dashboard", authenticate, async (req, res) => {
  const db = getDb(req); const stripe = getStripe(req);
  try {
    const snap = await db.collection("users").doc(req.uid).get();
    const accountId = (snap.data() ?? {}).stripeConnectAccountId;
    if (!accountId) return res.status(404).json({ error: "no_connect_account" });
    const link = await stripe.accounts.createLoginLink(accountId);
    res.json({ url: link.url });
  } catch (err) {
    return respondStripeError("/connect/dashboard", err, req, res);
  }
});

// POST /connect/disconnect — remove the driver's connected account so their bank
// details are no longer held at Stripe.
//
// Deliberately NOT a local-only unlink: clearing our fields while leaving the
// Stripe account alive would orphan it and lose the only handle we have on it.
// So Stripe is the source of truth here — local fields are cleared only after
// Stripe confirms the deletion.
//
// The driver's availableEarningsCents is untouched. That balance lives in
// Firestore, not in the Connect account, and it still offsets their own ride
// charges every month — disconnecting only means they cannot move it to a bank
// until they reconnect. The client says so in the confirmation dialog.
app.post("/connect/disconnect", authenticate, async (req, res) => {
  const db = getDb(req); const stripe = getStripe(req);
  try {
    const userRef = db.collection("users").doc(req.uid);
    const snap = await userRef.get();
    const accountId = (snap.data() ?? {}).stripeConnectAccountId;

    const clearFields = {
      stripeConnectAccountId: FieldValue.delete(),
      stripeConnectStatus: "none",
      stripeConnectPayoutsEnabled: false,
      stripeConnectRequirementsDue: [],
      stripeConnectBankLast4: FieldValue.delete(),
      stripeConnectUpdatedAt: new Date().toISOString(),
    };

    // Nothing connected — treat as already done rather than an error, so a
    // double tap is harmless.
    if (!accountId) {
      await userRef.set(clearFields, { merge: true });
      return res.json({ success: true, alreadyDisconnected: true });
    }

    // A transfer is already queued against this account. Deleting it now would
    // make the sweeper fail five times before refunding — block instead, and
    // tell the driver to wait for the money to land.
    const pending = await findPendingCashout(db, req.uid);
    if (pending) {
      return res.status(409).json({ error: "cashout_pending", amountCents: pending.amountCents });
    }

    try {
      await stripe.accounts.del(accountId);
    } catch (err) {
      // Stripe refuses to delete an account holding money — a transfer that has
      // landed but not yet paid out to their bank. Surface that specifically:
      // "try again later" is useless advice when the fix is "wait for Stripe's
      // payout to reach your bank".
      const code = err && err.raw && err.raw.code;
      const msg = String((err && err.message) || "");
      const isBalance = code === "balance_insufficient" || /balance/i.test(msg);
      if (err && err.statusCode === 404) {
        // Already gone on Stripe's side — clear ours and call it done.
        await userRef.set(clearFields, { merge: true });
        return res.json({ success: true, alreadyDisconnected: true });
      }
      console.error("/connect/disconnect stripe error:", msg);
      return res.status(409).json({ error: isBalance ? "balance_not_zero" : "stripe_refused" });
    }

    await userRef.set(clearFields, { merge: true });
    return res.json({ success: true });
  } catch (err) {
    console.error("/connect/disconnect error:", err);
    return res.status(500).json({ error: "internal" });
  }
});

/** A driver's bank rejected the transfer Stripe had paid out to them.
 *
 *  Lives in its own function because it must be reachable from BOTH webhook
 *  endpoints. The lookup needs `event.account` — the connected account the
 *  payout belonged to — and Stripe only populates that on connected-account
 *  events, so this only ever finds a driver when called from the Connect
 *  endpoint. It stays wired to the platform endpoint too, where it logs the
 *  platform's own failed bank payouts and matches no user. */
async function handlePayoutFailed(event, db) {
  const payout = event.data.object;
  console.error("PAYOUT FAILED at the bank", {
    payoutId: payout.id, amount: payout.amount,
    failureCode: payout.failure_code, account: event.account || "platform",
  });
  if (!event.account) return;
  const q = await db.collection("users")
    .where("stripeConnectAccountId", "==", event.account).limit(1).get();
  if (q.empty) return;
  await pushTo(
    q.docs[0].id, db,
    "Virement refusé", "Payout returned",
    "Ta banque a refusé le virement. Vérifie tes infos bancaires.",
    "Your bank rejected the payout. Check your bank details.",
    { type: "payout_bounced", payoutId: payout.id },
  ).catch(() => {});
}

// POST /stripe/connect-webhook — account.updated is what tells us a driver
// finished onboarding or had their account restricted. Signature-verified
// against the raw body (see the express.json({ verify }) hook at the top).
app.post("/stripe/connect-webhook", async (req, res) => {
  // Stripe sends no X-App-Env header, so getDb/getStripe resolve to prod + the
  // live keys. That is correct: this endpoint is registered against the
  // LIVE-mode Stripe webhook. A stray TEST-mode event fails signature
  // verification against the live secret (400) rather than writing to the
  // wrong database — test-mode Connect webhooks belong on the sandbox function.
  const db = getDb(req); const stripe = getStripe(req);
  const secret = process.env.STRIPE_CONNECT_WEBHOOK_SECRET;
  if (!secret) {
    console.error("connect-webhook: STRIPE_CONNECT_WEBHOOK_SECRET not set");
    return res.status(500).json({ error: "not_configured" });
  }

  let event;
  try {
    event = stripe.webhooks.constructEvent(req.rawBody, req.headers["stripe-signature"], secret);
  } catch (err) {
    console.error("connect-webhook signature error:", err.message);
    return res.status(400).json({ error: "invalid_signature" });
  }

  try {
    if (event.type === "account.updated") {
      const acct = event.data.object;
      const uid = acct.metadata && acct.metadata.firebaseUid;
      if (!uid) {
        // Not one of ours (or created outside this flow) — nothing to write.
        console.warn("connect-webhook: account.updated with no firebaseUid", acct.id);
        return res.json({ received: true });
      }
      const fields = connectFieldsFromAccount(acct);
      await db.collection("users").doc(uid).set(fields, { merge: true });
      if (fields.stripeConnectPayoutsEnabled) {
        await pushTo(
          uid, db,
          "Paiements activés", "Payouts enabled",
          "Ton compte est prêt. Tes gains seront versés automatiquement.",
          "Your account is ready. Your earnings will be paid out automatically.",
          { type: "connect_ready" },
        ).catch(() => {});
      }
    }

    // A driver's bank rejecting the payout. This MUST be handled here and not on
    // the platform endpoint: the handler needs `event.account` to know whose
    // payout bounced, and Stripe only populates that on connected-account
    // events. Subscribed on the platform endpoint it silently matched nobody, so
    // a driver whose payout was returned was never told.
    if (event.type === "payout.failed") {
      await handlePayoutFailed(event, db);
    }
    return res.json({ received: true });
  } catch (err) {
    console.error("connect-webhook handler error:", err.message);
    return res.status(500).json({ error: "internal" });
  }
});


// POST /stripe/webhook — PLATFORM events.
//
// Separate endpoint and separate secret from /stripe/connect-webhook, because
// Stripe configures platform events and Connect events as two different
// endpoints and signs them with two different secrets. Sharing one would mean
// every Connect event failed signature verification, or vice versa.
//
// Until this existed the only event handled anywhere was `account.updated`. A
// chargeback took money straight out of the platform balance with nothing
// recorded, nobody notified, and the driver already paid.
app.post("/stripe/webhook", async (req, res) => {
  const db = getDb(req); const stripe = getStripe(req);
  const secret = process.env.STRIPE_WEBHOOK_SECRET;
  if (!secret) {
    console.error("stripe/webhook: STRIPE_WEBHOOK_SECRET not set");
    return res.status(500).json({ error: "not_configured" });
  }

  let event;
  try {
    event = stripe.webhooks.constructEvent(req.rawBody, req.headers["stripe-signature"], secret);
  } catch (err) {
    console.error("stripe/webhook signature error:", err.message);
    return res.status(400).json({ error: "invalid_signature" });
  }

  /** Resolve the UniLift user behind a Stripe object. Prefers our own metadata,
   *  falls back to the customer id we mirrored onto the user doc. */
  const uidFor = async (obj) => {
    const meta = obj && obj.metadata;
    if (meta && meta.firebaseUid) return meta.firebaseUid;
    const customerId = obj && obj.customer;
    if (!customerId) return null;
    const q = await db.collection("users").where("stripeCustomerId", "==", customerId).limit(1).get();
    return q.empty ? null : q.docs[0].id;
  };

  try {
    switch (event.type) {
      // ── A passenger disputed a settled charge ──────────────────────────────
      case "charge.dispute.created": {
        const dispute = event.data.object;
        const uid = await uidFor(dispute);
        console.error("CHARGEBACK", {
          disputeId: dispute.id, amount: dispute.amount,
          reason: dispute.reason, uid: uid || "unknown",
        });
        if (uid) {
          // Freeze cashouts for this person while it is open. The money has
          // already left the platform balance and may have to be clawed back;
          // letting them withdraw in the meantime makes that unrecoverable.
          await db.collection("users").doc(uid).set({
            disputeOpen: true,
            disputeOpenedAt: new Date().toISOString(),
            lastSettlementFailedAt: new Date().toISOString(),
            lastSettlementFailureReason: "dispute",
          }, { merge: true });
          await db.collection("users").doc(uid).collection("transactions").doc().set({
            type: "dispute", amount: dispute.amount, status: "open",
            description: `Chargeback — ${dispute.reason || "disputed"}`,
            createdAt: new Date().toISOString(), stripeDisputeId: dispute.id,
          });
        }
        break;
      }

      case "charge.dispute.closed": {
        const dispute = event.data.object;
        const uid = await uidFor(dispute);
        const won = dispute.status === "won";
        console.warn("dispute closed", { disputeId: dispute.id, status: dispute.status, uid });
        if (uid && won) {
          // We kept the money — lift the freeze.
          await db.collection("users").doc(uid).set({
            disputeOpen: FieldValue.delete(),
            lastSettlementFailedAt: FieldValue.delete(),
            lastSettlementFailureReason: FieldValue.delete(),
          }, { merge: true });
        }
        break;
      }

      // ── A refund issued from the Stripe dashboard rather than /billing/refund
      case "charge.refunded": {
        const charge = event.data.object;
        const uid = await uidFor(charge);
        if (uid) {
          // Recorded so the wallet and the dashboard agree. The counters are NOT
          // adjusted here: a dashboard refund carries no ride id, so there is no
          // way to know whose earnings to reverse. Use /billing/refund for that.
          await db.collection("users").doc(uid).collection("transactions").doc().set({
            type: "refund", amount: charge.amount_refunded, status: "completed",
            description: "Refund issued from Stripe",
            createdAt: new Date().toISOString(),
            stripeChargeId: charge.id, mode: "dashboard",
          });
          console.warn("dashboard refund recorded; driver earnings NOT reversed", {
            uid, chargeId: charge.id, amount: charge.amount_refunded,
          });
        }
        break;
      }

      // ── An off-session settlement charge failed asynchronously ─────────────
      case "payment_intent.payment_failed": {
        const pi = event.data.object;
        const uid = await uidFor(pi);
        if (uid) {
          const failure = (pi.last_payment_error && pi.last_payment_error.code) || "payment_failed";
          // This is what /rides/can-join reads to stop them accruing more.
          await db.collection("users").doc(uid).set({
            lastSettlementFailedAt: new Date().toISOString(),
            lastSettlementFailureReason: failure,
          }, { merge: true });
          await pushTo(
            uid, db,
            "Paiement refusé", "Payment declined",
            "Ton paiement a été refusé. Mets ta carte à jour pour continuer à réserver.",
            "Your payment was declined. Update your card to keep booking rides.",
            { type: "settlement_failed", status: failure },
          ).catch(() => {});
        }
        break;
      }

      // ── A payout to a driver's bank bounced ────────────────────────────────
      case "payout.failed":
        // Only ever the PLATFORM's own bank payouts here — a driver's bounced
        // payout arrives on the Connect endpoint, which carries event.account.
        await handlePayoutFailed(event, db);
        break;

      default:
        // Everything else is subscribed-but-unhandled; acknowledge so Stripe
        // stops retrying rather than treating it as an outage.
        break;
    }
    return res.json({ received: true });
  } catch (err) {
    console.error("stripe/webhook handler error:", err.message);
    return res.status(500).json({ error: "internal" });
  }
});

// ── Driver payouts (automatic, once a month) ────────────────────────────────
//
// Payouts are PUSH, not pull. A driver does not ask for their money: on the
// PAYOUT_DAY_OF_MONTH the `monthlyDriverPayouts` job queues every eligible
// balance, and the daily sweeper transfers it out. What can be queued is
// `availableEarningsCents` — earnings that a settlement has already converted
// into collected funds — never `pendingEarningsCents`, which is this cycle's
// accrual that no passenger has been charged for yet.
//
// THE CASH-FLOW INVARIANT, in one line: `availableEarningsCents` is written by
// settleAllUsers and by nothing else, so no dollar can be queued for payout
// unless the passenger charge behind it already succeeded. The date below is
// about Stripe's T+2..7 clearing delay; this is what actually makes "never paid
// before collected" true. Do not add a second writer to that field.

/** Day of the month the payout queue is filled, four days after monthlyBilling
 *  charges on the 1st. Card money lands in Stripe's `pending` balance and only
 *  becomes `available` at T+2..7 (CAD), and a transfer can spend nothing but
 *  `available` funds — so enqueuing on the 1st would just fail
 *  `balance_insufficient` all day. Mirrored in the twin server. */
const PAYOUT_DAY_OF_MONTH = 5;

/** ISO date (YYYY-MM-DD) of the next payout run, for the wallet's "next payout
 *  on…" line. Today counts as the next run right up until the job fires. */
function nextPayoutDate(from = new Date()) {
  const d = new Date(Date.UTC(from.getUTCFullYear(), from.getUTCMonth(), PAYOUT_DAY_OF_MONTH));
  if (from.getUTCDate() > PAYOUT_DAY_OF_MONTH) d.setUTCMonth(d.getUTCMonth() + 1);
  return d.toISOString().slice(0, 10);
}

/** Is this balance payable right now?
 *
 *  One shared read so /payouts/summary and the monthly enqueue can never
 *  disagree about what the wallet promised. `canCashout` keeps its name — it is
 *  what the enqueue job asks before queuing a row, and what the summary reports
 *  — it just no longer corresponds to a button anyone taps. */
function cashoutEligibility(user, pricing, hasPending) {
  const balance = Number(user.availableEarningsCents) || 0;
  // Ride debt this driver has run up as a PASSENGER, not yet settled.
  //
  // Netting is the promise the whole wallet is built on — drive enough and your
  // own ride charges are cancelled out. But netting only happens at settlement,
  // and a payout moves money out of the pool before then, so a driver paid $50
  // on the 5th could let the card decline on the 1st of the next month. Holding
  // back what they already owe keeps the offset honest, and the excess is still
  // paid out.
  const owed = Number(user.pendingChargeCents) || 0;
  const available = Math.max(0, balance - owed);
  const min = pricing.minPayoutCents;

  const base = { available, min, balance, owed };
  if (hasPending) return { canCashout: false, reason: "already_pending", ...base };
  // An open chargeback means money may have to come back out of this account.
  // Paying out while it is unresolved makes that unrecoverable.
  if (user.disputeOpen === true) {
    return { canCashout: false, reason: "dispute_open", ...base };
  }
  if (user.stripeConnectPayoutsEnabled !== true) {
    return { canCashout: false, reason: "payouts_not_enabled", ...base };
  }
  if (available < min) {
    // Distinguish "you have not earned enough" from "your earnings are spoken
    // for" — the two need completely different advice.
    return {
      canCashout: false,
      reason: owed > 0 && balance >= min ? "offsetting_charges" : "below_minimum",
      ...base,
    };
  }
  return { canCashout: true, reason: null, ...base };
}

/** The driver's one outstanding payout, if any. Two are never allowed at once —
 *  it keeps the wallet's state simple and stops a queue of tiny transfers each
 *  incurring Stripe's per-payout fee. It is also what makes the monthly enqueue
 *  safe to re-run: a row already in flight means this driver is done. */
async function findPendingCashout(db, uid, tx = null) {
  const q = db
    .collection("payouts")
    .where("uid", "==", uid)
    .where("status", "in", ["pending", "awaiting_setup"])
    .limit(1);
  // Inside a transaction the read must go through it, or the check is against a
  // snapshot the transaction never saw and the retry-on-conflict guarantee does
  // not apply to it.
  const snap = tx ? await tx.get(q) : await q.get();
  return snap.empty ? null : { id: snap.docs[0].id, ...snap.docs[0].data() };
}

// GET /payouts/summary — one authoritative view for the wallet, so the client
// never re-derives eligibility and then disagrees with the server.
app.get("/payouts/summary", authenticate, async (req, res) => {
  const db = getDb(req);
  try {
    const [snap, pricing] = await Promise.all([
      db.collection("users").doc(req.uid).get(),
      getPricing(db),
    ]);
    const user = snap.data() ?? {};
    const pending = await findPendingCashout(db, req.uid);
    const e = cashoutEligibility(user, pricing, !!pending);
    const pendingEarnings = Number(user.pendingEarningsCents) || 0;
    res.json({
      /** Payable at the next run — the balance minus what this driver owes. */
      availableCents: e.available,
      /** The full settled balance, before the offset is held back. */
      balanceCents: e.balance,
      /** Unsettled ride charges held back from the balance above. */
      outstandingChargeCents: e.owed,
      /** This cycle's accrual, not money yet. */
      pendingCents: pendingEarnings,
      /** What that accrual is actually worth after their own charges — the
       *  number that will land at settlement. Reporting the raw earnings alone
       *  showed a driver who owes more than they earned a positive figure that
       *  settles to zero. */
      pendingNetCents: pendingEarnings - e.owed,
      minPayoutCents: e.min,
      /** Stripe's Connect cost for this payout, deducted when it is queued, and
       *  what actually reaches the bank after it. Sent so the driver sees the
       *  fee BEFORE it happens rather than discovering it in the ledger. */
      payoutFeeCents: payoutFeeCents(e.available, pricing),
      netPayoutCents: e.available - payoutFeeCents(e.available, pricing),
      /** When the next automatic run will queue this balance. */
      nextPayoutDate: nextPayoutDate(),
      // TEST-ONLY — delete with the test-cashout block below. Gating the
      // button's VISIBILITY here, per-uid, is what makes it safe to OTA the
      // client to a shared release channel: nobody else's app renders it.
      testCashoutEnabled: testCashoutAllowed(req.uid),
      /** Retained for builds shipped before payouts became automatic; those
       *  clients still render a button off it. Current builds ignore it and
       *  show `nextPayoutDate` instead. */
      canCashout: e.canCashout,
      reason: e.reason,
      pendingRequest: pending
        ? { id: pending.id, amountCents: pending.amountCents, status: pending.status }
        : null,
    });
  } catch (err) {
    console.error("/payouts/summary error:", err);
    res.status(500).json({ error: "internal" });
  }
});

// POST /payouts/cashout — RETIRED. Payouts are automatic and monthly.
//
// The route stays registered rather than being deleted, for two reasons: every
// already-installed build still calls it and would otherwise get a bare 404 with
// nothing to show the driver, and the drift guard compares the two servers'
// route tables. It answers with the date of the next run so even an old client
// can say something true.
//
// It used to debit `availableEarningsCents` here and queue a `payouts` row. That
// work now lives in `queueMonthlyPayouts`, which is the single writer of that
// queue — the enqueue logic must not exist in two places.
app.post("/payouts/cashout", authenticate, async (req, res) => {
  return res.status(409).json({
    error: "automatic_payouts",
    nextPayoutDate: nextPayoutDate(),
  });
});

// ╔═══════════════════════════════════════════════════════════════════════════╗
// ║  TEST-ONLY — DELETE THIS ENTIRE BLOCK BEFORE LAUNCH                       ║
// ║                                                                           ║
// ║  Added 2026-09-01 to dry-run the payout rail by hand before the Sept 5    ║
// ║  monthlyDriverPayouts job makes its first real transfers. It bypasses the ║
// ║  minPayoutCents floor and NOTHING ELSE.                                   ║
// ║                                                                           ║
// ║  Off-switch that needs no code change: unset TEST_CASHOUT_UID in          ║
// ║  functions/.env and redeploy. The route then refuses everyone AND the     ║
// ║  button vanishes from the wallet, because /payouts/summary stops          ║
// ║  advertising it.                                                          ║
// ╚═══════════════════════════════════════════════════════════════════════════╝

/** The one uid allowed to use the test payout surface. Empty = surface is dead.
 *  Lives in functions/.env, which is gitignored and uploaded on deploy. */
const TEST_CASHOUT_UID = process.env.TEST_CASHOUT_UID || "";
/** Hard ceiling on a single test payout. The floor being bypassed is what
 *  normally stops a trivial transfer costing more in Connect fees than it moves,
 *  so cap the blast radius instead: a bug here can send at most $5. */
const TEST_CASHOUT_MAX_CENTS = 500;

function testCashoutAllowed(uid) {
  return TEST_CASHOUT_UID !== "" && uid === TEST_CASHOUT_UID;
}

// POST /payouts/test-cashout — queue a payout now, ignoring the $25 floor.
//
// Deliberately does NOT call cashoutEligibility: that helper fails the whole
// request with `below_minimum`, which is the one check being bypassed. Every
// OTHER guard it applies is reproduced inline — the pendingChargeCents holdback,
// the open-dispute freeze, the payouts-enabled requirement — because those
// protect correctness, not policy.
//
// The row it writes is identical in shape to queueMonthlyPayouts's, so the
// ordinary daily sweeper drains it. There is no second transfer path.
app.post("/payouts/test-cashout", authenticate, async (req, res) => {
  const db = getDb(req);
  const uid = req.uid;

  if (!testCashoutAllowed(uid)) return res.status(403).json({ error: "not_enabled" });

  try {
    // Fail fast with a clear error; the authoritative re-check is in the txn.
    if (await findPendingCashout(db, uid)) {
      return res.status(409).json({ error: "already_pending" });
    }

    const ref = db.collection("users").doc(uid);
    const payoutRef = db.collection("payouts").doc();
    const txRef = ref.collection("transactions").doc();
    const now = new Date().toISOString();

    const out = await db.runTransaction(async (t) => {
      const snap = await t.get(ref);
      if (!snap.exists) return { error: "user_not_found", code: 404 };
      const user = snap.data() ?? {};

      if (await findPendingCashout(db, uid, t)) {
        return { error: "already_pending", code: 409 };
      }
      // Money may still have to come back out of this account.
      if (user.disputeOpen === true) return { error: "dispute_open", code: 400 };
      if (user.stripeConnectPayoutsEnabled !== true) {
        return { error: "payouts_not_enabled", code: 403 };
      }

      const balance = Number(user.availableEarningsCents) || 0;
      const owed = Number(user.pendingChargeCents) || 0;
      // The netting holdback stays: never send money earmarked to cancel this
      // driver's own unsettled ride charges at the next settlement.
      const available = Math.max(0, balance - owed);
      if (available <= 0) return { error: "nothing_available", code: 400, available };

      const amount = Math.min(available, TEST_CASHOUT_MAX_CENTS);

      // Decrement by what is leaving, never to zero — zeroing would destroy the
      // held-back remainder.
      t.update(ref, {
        availableEarningsCents: balance - amount,
        lastCashoutAt: now,
      });
      t.set(txRef, {
        type: "cashout",
        amount,
        status: "pending",
        description: "TEST payout to your bank account",
        createdAt: now,
        payoutId: payoutRef.id,
      });
      t.set(payoutRef, {
        uid,
        amountCents: amount,
        kind: "monthly",
        requestedAt: now,
        settlementMonth: now.slice(0, 7),
        status: "pending",
        attempts: 0,
        txPath: txRef.path,
        createdAt: now,
      });
      return { ok: true, amount };
    });

    if (out.error) {
      return res.status(out.code).json({
        error: out.error,
        ...(out.available != null ? { availableCents: out.available } : {}),
      });
    }
    console.warn(`TEST CASHOUT: queued ${out.amount} cents for ${uid}`);
    return res.json({ success: true, amountCents: out.amount, payoutId: payoutRef.id });
  } catch (err) {
    console.error("/payouts/test-cashout error:", err);
    return res.status(500).json({ error: "internal" });
  }
});
// ╚═══════════════════ END TEST-ONLY BLOCK ═══════════════════╝


// ── Google Maps proxy ────────────────────────────────────────────────────────
//
// The app used to call Directions, Geocoding, Place Autocomplete and Place
// Details straight from the client with a key shipped in the JS bundle. Google's
// Android/iOS application restrictions do NOT apply to these Web Service APIs —
// only IP restriction does, and a phone cannot satisfy that. So the key was
// extractable from any install and billable by anyone who pulled it apart.
//
// The key now lives here, in GOOGLE_MAPS_SERVER_KEY, restricted by IP to this
// function's egress. The native map SDK keeps its own separate key in
// app.config.js, which IS restricted by bundle id and package name.
//
// Every route requires authentication, so usage is attributable to a uid and can
// be rate-limited. Responses are passed through unchanged, so the client parsers
// did not have to change.

const GOOGLE_MAPS_BASE = "https://maps.googleapis.com/maps/api";

/** Per-uid, per-minute budget across all four proxy routes. Generous enough for
 *  normal use — an address search is a few autocomplete calls plus one details
 *  call — and low enough that a scripted client cannot run up a bill. */
const MAPS_RATE_LIMIT = 60;
const MAPS_RATE_WINDOW_MS = 60 * 1000;
const mapsRateBuckets = new Map(); // uid -> { count, resetAt }

function mapsRateLimited(uid) {
  const now = Date.now();
  const bucket = mapsRateBuckets.get(uid);
  if (!bucket || bucket.resetAt <= now) {
    mapsRateBuckets.set(uid, { count: 1, resetAt: now + MAPS_RATE_WINDOW_MS });
    return false;
  }
  bucket.count += 1;
  // Bounded memory: instances are recycled often, and a bucket is one small
  // object per active user per minute.
  if (mapsRateBuckets.size > 5000) mapsRateBuckets.clear();
  return bucket.count > MAPS_RATE_LIMIT;
}

/** Call one Google Maps Web Service endpoint and hand the body back verbatim. */
async function proxyMaps(endpoint, params, res) {
  const key = process.env.GOOGLE_MAPS_SERVER_KEY;
  if (!key) {
    console.error("maps proxy: GOOGLE_MAPS_SERVER_KEY not set");
    return res.status(500).json({ error: "not_configured" });
  }
  const qs = new URLSearchParams({ ...params, key });
  try {
    const upstream = await fetch(`${GOOGLE_MAPS_BASE}/${endpoint}?${qs.toString()}`);
    if (!upstream.ok) {
      console.warn("maps proxy upstream error", endpoint, upstream.status);
      return res.status(502).json({ error: "upstream_error", status: upstream.status });
    }
    const body = await upstream.json();
    // Google reports quota and key problems in the BODY with HTTP 200. Surface
    // them as server errors rather than passing a confusing OVER_QUERY_LIMIT to
    // the client as if it were a normal empty result.
    if (body && (body.status === "REQUEST_DENIED" || body.status === "OVER_QUERY_LIMIT")) {
      console.error("maps proxy denied:", endpoint, body.status, body.error_message || "");
      return res.status(502).json({ error: "upstream_denied", status: body.status });
    }
    return res.json(body);
  } catch (err) {
    console.error("maps proxy failed:", endpoint, err.message);
    return res.status(502).json({ error: "upstream_unreachable" });
  }
}

/** Shared guard for all four routes. */
function mapsGuard(req, res) {
  if (mapsRateLimited(req.uid)) {
    res.status(429).json({ error: "rate_limited" });
    return false;
  }
  return true;
}

// GET /maps/directions?origin=lat,lng&destination=lat,lng[&waypoints=a|b]
app.get("/maps/directions", authenticate, async (req, res) => {
  if (!mapsGuard(req, res)) return;
  const { origin, destination, waypoints } = req.query || {};
  if (!origin || !destination) {
    return res.status(400).json({ error: "origin and destination are required" });
  }
  return proxyMaps("directions/json", {
    origin: String(origin),
    destination: String(destination),
    ...(waypoints ? { waypoints: String(waypoints) } : {}),
  }, res);
});

// GET /maps/geocode?address=…
app.get("/maps/geocode", authenticate, async (req, res) => {
  if (!mapsGuard(req, res)) return;
  const { address } = req.query || {};
  if (!address) return res.status(400).json({ error: "address is required" });
  return proxyMaps("geocode/json", {
    address: String(address),
    // Same regional scoping the client used to apply.
    components: "administrative_area:QC|country:CA",
  }, res);
});

// GET /maps/place-autocomplete?input=…[&lat=&lng=&radius=]
app.get("/maps/place-autocomplete", authenticate, async (req, res) => {
  if (!mapsGuard(req, res)) return;
  const { input, lat, lng, radius, language, sessiontoken } = req.query || {};
  if (!input) return res.status(400).json({ error: "input is required" });
  const hasLocation = lat != null && lng != null && lat !== "" && lng !== "";
  return proxyMaps("place/autocomplete/json", {
    input: String(input),
    language: String(language || "fr"),
    components: "country:ca",
    ...(hasLocation ? { location: `${lat},${lng}`, radius: String(radius || 50000) } : {}),
    ...(sessiontoken ? { sessiontoken: String(sessiontoken) } : {}),
  }, res);
});

// GET /maps/place-details?placeId=…
app.get("/maps/place-details", authenticate, async (req, res) => {
  if (!mapsGuard(req, res)) return;
  const { placeId, sessiontoken } = req.query || {};
  if (!placeId) return res.status(400).json({ error: "placeId is required" });
  return proxyMaps("place/details/json", {
    place_id: String(placeId),
    fields: "geometry",
    ...(sessiontoken ? { sessiontoken: String(sessiontoken) } : {}),
  }, res);
});

// ── Rides: Can Join ─────────────────────────────────────────────────────────
//
// NOTE: the legacy POST /rides/complete lived here. It was removed because it
// charged whatever passenger ids the *client* put in `confirmedPassengerIds` —
// no boarded check, no dropped check, no dropoff-radius check — so a driver
// could be paid for a passenger dropped nowhere near their destination. All
// ride payment now goes through POST /rides/finish, which derives the charge set
// server-side via chargeablePassengers().
/** May this passenger take on another ride charge?
 *
 *  Returns null when they may, or a { error, ... } body when they may not.
 *
 *  Called from every route that can create a future charge, not just
 *  /rides/can-join — that route is a pre-flight the client does not currently
 *  use, so enforcing here only would have enforced nothing. The authoritative
 *  gates are /requests/dispatch (their own action) and /requests/accept (where
 *  the ride, and therefore the charge, is actually created). */
function chargeEligibility(user, pricing) {
  const u = user || {};

  // 1. A card must exist at all.
  if (!u.stripePaymentMethodId) return { error: "no_payment_method" };

  const outstanding = Number(u.pendingChargeCents) || 0;

  // 2. An open chargeback means we are already fighting over money with this
  //    person. Do not extend more credit while that is unresolved.
  if (u.disputeOpen === true) {
    return { error: "dispute_open", outstandingCents: outstanding };
  }

  // 3. The card must not have already failed.
  //
  // A failed settlement leaves both counters untouched so nothing is lost —
  // which also meant a passenger whose card declined could simply keep riding,
  // accruing debt against a card everyone already knows does not work. Blocked
  // until the balance clears; `lastSettlementFailedAt` is stamped by
  // settleAllUsers and by the payment_intent.payment_failed webhook, and cleared
  // on the next successful charge.
  if (u.lastSettlementFailedAt && outstanding > 0) {
    return {
      error: "settlement_failed",
      outstandingCents: outstanding,
      reason: u.lastSettlementFailureReason || null,
    };
  }

  // 4. Unsettled debt must be under the ceiling. Without this the exposure per
  //    passenger is unbounded for a whole billing cycle.
  const ceiling = Number(pricing.maxOutstandingChargeCents) || 0;
  if (ceiling > 0 && outstanding >= ceiling) {
    return { error: "balance_too_high", outstandingCents: outstanding, limitCents: ceiling };
  }

  return null;
}

app.post("/rides/can-join", authenticate, async (req, res) => {
  const db = getDb(req);
  try {
    const [snap, pricing] = await Promise.all([
      db.collection("users").doc(req.uid).get(),
      getPricing(db),
    ]);
    if (!snap.exists) return res.status(404).json({ error: "user_not_found" });
    const refusal = chargeEligibility(snap.data(), pricing);
    if (refusal) return res.status(403).json(refusal);
    return res.json({ canJoin: true });
  } catch (err) {
    console.error("can-join error", err);
    return res.status(500).json({ error: "internal" });
  }
});

// ── Push Notifications ──────────────────────────────────────────────────────

/** Format cents as fr-CA currency: 525 → "5,25 $" */
function formatFrCA(cents) {
  const amount = (cents / 100).toFixed(2).replace(".", ",");
  return `${amount} $`;
}

/**
 * Returns a motivational notification body for drivers, localised to their language.
 * Uses the ride earning to project realistic goals, rotating by time-of-day slot.
 */
function driverMotivationalBody(earningsCents, requestId = "", lang = "en") {
  const earning = earningsCents / 100;
  const ridesTo100 = Math.ceil(10000 / earningsCents);
  const dailyAt5 = Math.round(earning * 5 * 100) / 100;
  const weeklyAt5 = Math.round(earning * 5 * 5 * 100) / 100;
  const daysTo100At5 = Math.ceil(ridesTo100 / 5);

  const fmt = (n) => n.toFixed(2).replace(".", ",") + " $";

  const messages = lang === "fr"
    ? [
        `+${fmt(earning)} — encore ${ridesTo100} trajets comme ça et tu atteins 100 $.`,
        `Accepte maintenant → reste constant ${daysTo100At5} jours → atteins ton objectif de 100 $`,
        `5 trajets aujourd'hui = ${fmt(dailyAt5)} dans ta poche.`,
        `${ridesTo100} trajets de plus cette semaine → 100 $ gagnés.`,
        `Conduis 5 jours comme ça et empoche ${fmt(weeklyAt5)}+ 💵 Accepte pour garder la série`,
        `Chaque trajet s'accumule — ${ridesTo100} te mènent à 100 $.`,
      ]
    : [
        `+${fmt(earning)} — ${ridesTo100} rides like this and you hit 100 $.`,
        `Accept now → stay consistent ${daysTo100At5} days → reach your 100 $ goal`,
        `5 rides today = ${fmt(dailyAt5)} in your pocket.`,
        `${ridesTo100} more rides this week → 100 $ earned.`,
        `Drive 5 days like this and pocket ${fmt(weeklyAt5)}+ 💵 Accept to keep the streak`,
        `Every ride adds up — ${ridesTo100} gets you to 100 $.`,
      ];

  // Rotate deterministically by hour so back-to-back requests feel varied
  const seed = new Date().getHours() + (requestId.charCodeAt(0) || 0);
  return messages[seed % messages.length];
}

/** Send one Expo push. Returns true only when Expo accepted the ticket.
 *
 *  Expo answers 200 even when it rejects the message (bad/stale token →
 *  `{ data: { status: "error", details: { error: "DeviceNotRegistered" } } }`),
 *  so the body must be inspected — otherwise a device that silently stopped
 *  receiving pushes is indistinguishable from a healthy one. Never throws:
 *  callers treat a failed send as "this driver wasn't reached". */
async function sendPushNotification(expoPushToken, title, body, data = {}, subtitle = undefined) {
  const payload = { to: expoPushToken, sound: "default", title, body, data };
  if (subtitle) payload.subtitle = subtitle;
  try {
    const response = await fetch("https://exp.host/--/api/v2/push/send", {
      method: "POST",
      headers: {
        Accept: "application/json",
        "Accept-Encoding": "gzip, deflate",
        "Content-Type": "application/json",
      },
      body: JSON.stringify(payload),
    });
    if (!response.ok) {
      console.warn("push send HTTP error", response.status, await response.text().catch(() => ""));
      return false;
    }
    const json = await response.json();
    const ticket = json && json.data;
    if (ticket && ticket.status === "error") {
      console.warn("push ticket error", {
        token: expoPushToken,
        message: ticket.message,
        details: ticket.details,
      });
      return false;
    }
    return true;
  } catch (e) {
    console.warn("push send failed", expoPushToken, e && e.message);
    return false;
  }
}

// getUserPushToken was removed with POST /notifications/send — it existed only to
// look up an arbitrary user's token by uid, which is precisely the capability that
// made that route dangerous. Targeted sends go through getUserPushInfo/pushTo.

/**
 * Returns { token, lang, tokenEnv } for a user. lang is "fr" or "en" (default
 * "en"). `tokenEnv` is the EXPO_PUBLIC_APP_ENV of the client that registered the
 * token, or null for tokens saved before that field existed — absent is treated
 * as "matches", so no migration is needed and legacy users stay reachable.
 */
async function getUserPushInfo(uid, db) {
  const snap = await db.collection("users").doc(uid).get();
  const data = snap.data() ?? {};
  return {
    token: data.expoPushToken ?? null,
    lang: data.language === "fr" ? "fr" : "en",
    tokenEnv: typeof data.expoPushTokenEnv === "string" ? data.expoPushTokenEnv : null,
  };
}

/**
 * The loose environment check used by TARGETED sends. A token registered by a
 * prod client points at a device running the prod build, so a dev server sending
 * to it would surface as a production notification.
 *
 * Untagged tokens pass here, unlike the strict dev rule in isEligibleRecipient:
 * a targeted send answers an action the user just took in this environment, and
 * dropping it would break a legitimate reply to a tester whose token predates
 * tagging. Broadcasts get the strict treatment; 1:1 replies get this one.
 */
function pushEnvMatches(tokenEnv, db) {
  return !tokenEnv || tokenEnv === envLabel(db);
}

// A push token identifies one physical device, not one account. If the same
// device previously registered this token under a different account (signed
// out, signed in as someone else), that other account must stop being able
// to receive pushes meant for this device — otherwise a signed-out account
// keeps buzzing the phone forever, or two accounts on one device both fire
// for the same event. Registering always atomically moves the token to the
// caller and strips it from every other account that has it.
//
// The write also carries the env tags isEligibleRecipient()/pushEnvMatches()
// filter on, so registering through this route keeps a device eligible for
// pushes instead of silently aging out of dev broadcasts. The client sends its
// own `env` in the body, but it is deliberately NOT trusted here: the tag is
// derived from the same `db` the document is written into, so the two can never
// disagree. A "dev" tag landing in the prod database would exclude that device
// from production pushes permanently, with nothing to show why.
app.post("/notifications/register-token", authenticate, async (req, res) => {
  const db = getDb(req);
  try {
    const { token } = req.body;
    if (!token) {
      return res.status(400).json({ error: "token is required" });
    }
    const staleSnap = await db.collection("users").where("expoPushToken", "==", token).get();
    const batch = db.batch();
    let staleCleared = 0;
    staleSnap.docs.forEach((doc) => {
      if (doc.id === req.uid) return;
      // Drop the env tags along with the token: they describe a registration
      // that no longer exists on that account.
      batch.update(doc.ref, {
        expoPushToken: FieldValue.delete(),
        expoPushTokenEnv: FieldValue.delete(),
        expoPushTokenUpdatedAt: FieldValue.delete(),
      });
      staleCleared += 1;
    });
    // set+merge, not update: the previous client-side PATCH upserted the user
    // doc if it didn't exist yet (e.g. token registers before the signup
    // flow finishes writing the profile). update() would throw NOT_FOUND in
    // that case and silently break registration — keep the same upsert
    // semantics here.
    batch.set(
      db.collection("users").doc(req.uid),
      {
        expoPushToken: token,
        expoPushTokenEnv: envLabel(db),
        // Server clock, so the dev freshness window is immune to device skew.
        expoPushTokenUpdatedAt: FieldValue.serverTimestamp(),
      },
      { merge: true },
    );
    await batch.commit();
    res.json({ success: true, staleCleared });
  } catch (err) {
    console.error("/notifications/register-token:", err);
    res.status(500).json({ error: err.message });
  }
});

// REMOVED: POST /notifications/send.
//
// It accepted an arbitrary `uid`, `title` and `body` from ANY authenticated
// caller and pushed it to that user's device, with no check that the caller had
// any relationship to the recipient. Paired with the old world-readable `users`
// collection — which made every uid enumerable — that was a push-phishing cannon
// aimed at the entire user base ("UniLift: your payment failed, tap here").
//
// It had no callers in the app. Every legitimate notification goes through
// pushTo(), which is only ever reached from a route that has already established
// the sender and recipient are on the same ride. If a genuine need for a relay
// appears, it must take the ride or request id — never a bare uid — and verify
// the caller is on it.

// ── Billing: Settle every user at month-end ──────────────────────────────────
//
// A user's driving earnings and their passenger ride charges are two counters on
// the same account, so only the *difference* between them ever needs to move:
//   net = pendingEarningsCents - pendingChargeCents
//     net < 0  → they owe us  → one off-session PaymentIntent for |net|
//     net > 0  → we owe them  → queue a payout for net (Stripe Connect pending)
//     net == 0 → the two cancelled out; nothing moves, both counters clear
// This is what lets a driver wipe out their own ride debt by driving, and what
// the wallet UI shows as a single signed balance.
//
// Protected by x-billing-secret header (set BILLING_SECRET in functions/.env).
// Trigger via Cloud Scheduler or curl:
//   curl -X POST https://<region>-<project>.cloudfunctions.net/api/billing/settle-monthly \
//        -H "x-billing-secret: <BILLING_SECRET>"
//
/** Has this user already been charged for this settlement month?
 *
 *  Answers the "did the previous run's charge actually land before it crashed?"
 *  question. Scoped to the customer and matched on metadata, so it cannot pick up
 *  an unrelated intent. Returns null on any error — a failed lookup must not
 *  block a legitimate charge, and the amount-scoped idempotency key is still
 *  underneath it as a second line of defence. */
async function findSettledIntent(stripe, customerId, month) {
  try {
    const list = await stripe.paymentIntents.list({ customer: customerId, limit: 25 });
    return list.data.find(
      (i) => i.status === "succeeded" && i.metadata && i.metadata.settlementMonth === month,
    ) || null;
  } catch (err) {
    console.warn("findSettledIntent failed:", err.message);
    return null;
  }
}

/** Users settled per run. Sized so the serial Stripe calls fit inside the
 *  function's 540s timeout with headroom; leftovers roll to the next run. */
const SETTLEMENT_BATCH = 300;

async function settleAllUsers(db, stripe) {
  const month = new Date().toISOString().slice(0, 7);
  // Fee rates and the settlement floor are config-driven (config/pricing).
  const pricing = await getPricing(db);
  const dollars = (cents) => `$${(cents / 100).toFixed(2)}`;

  // Firestore can't OR across two fields in one query — union the candidates.
  //
  // Bounded: this is a serial loop with a Stripe round trip per user inside a
  // 540s cap, and it used to load every candidate at once with no resume. Anyone
  // not reached in this run keeps their counters untouched and is picked up by
  // the next — the claim doc in the charge path is what makes that safe.
  const [chargeSnap, earnSnap] = await Promise.all([
    db.collection("users").where("pendingChargeCents", ">", 0).limit(SETTLEMENT_BATCH).get(),
    db.collection("users").where("pendingEarningsCents", ">", 0).limit(SETTLEMENT_BATCH).get(),
  ]);
  const candidates = new Map();
  for (const doc of [...chargeSnap.docs, ...earnSnap.docs]) {
    candidates.set(doc.id, doc.data());
  }

  const results = [];

  for (const [uid, data] of candidates) {
    const charges  = data.pendingChargeCents   ?? 0;
    const earnings = data.pendingEarningsCents ?? 0;
    const net      = earnings - charges;
    const ref      = db.collection("users").doc(uid);
    const now      = new Date().toISOString();
    const offset   = `${dollars(earnings)} earnings offset against ${dollars(charges)} charges`;

    try {
      // Every branch below settles the amounts read BEFORE the Stripe call, so
      // the write-back must subtract exactly those amounts rather than zeroing the
      // counters. A ride finishing mid-settlement — and the Stripe round trip is
      // seconds long — used to be wiped by the blind `pendingChargeCents: 0`:
      // the passenger was never charged for it, the driver never paid, and there
      // was no trace it had happened.
      const settleCounters = (t, extra = {}) => t.set(ref, {
        pendingChargeCents: FieldValue.increment(-charges),
        pendingEarningsCents: FieldValue.increment(-earnings),
        ...extra,
      }, { merge: true });

      // ── They owe us — charge the difference ────────────────────────────────
      if (net < 0) {
        const owed = -net;

        // Trivial balances roll forward rather than being charged. Stripe
        // rejects charges under ~$0.50 CAD, and grossing up a few cents to
        // clear the fixed fee would bill far more than the debt itself.
        // Counters are left untouched, exactly like the no-card path below.
        if (owed < pricing.minSettlementCents) {
          // Rolls forward, counters untouched. Worth watching in aggregate: the
          // driver who carried these rides was credited in full at
          // /rides/finish, so a balance sitting here is money UniLift has
          // promised out and not collected. settlementTotals() sums it.
          results.push({ uid, status: "below_threshold", amount: owed });
          continue;
        }

        const { stripePaymentMethodId } = data;
        // No card on file: leave BOTH counters untouched so nothing is lost and
        // the balance simply rolls into next month's settlement.
        if (!stripePaymentMethodId) {
          // Silence here meant a user could accumulate months of debt and never
          // know why nothing was charged.
          await pushTo(
            uid, db,
            "Ajoute une carte", "Add a payment method",
            `Tu dois ${dollars(owed)}. Ajoute une carte pour régler ton solde.`,
            `You owe ${dollars(owed)}. Add a card to settle your balance.`,
            { type: "settlement_no_payment_method", amountCents: String(owed) },
          ).catch(() => {});
          // Stamped so /rides/can-join can stop them accruing more against a
          // card that is not there.
          await ref.set({
            lastSettlementFailedAt: now,
            lastSettlementFailureReason: "no_payment_method",
          }, { merge: true }).catch(() => {});
          results.push({ uid, status: "no_payment_method", amount: owed });
          continue;
        }

        // The passenger covers Stripe's fee: charge the grossed-up amount so
        // that what lands in the UniLift balance after Stripe's cut is exactly
        // `owed` — the sum the drivers are due. Charging `owed` flat would make
        // the platform eat the fee on every settlement.
        const gross = grossUpChargeCents(owed, pricing);
        const processingFeeCents = gross - owed;

        const customerId = await getOrCreateCustomer(uid, db, stripe);

        // ── Charge-once bookkeeping ──────────────────────────────────────────
        //
        // The old key was `monthly-settle-{uid}-{month}` with no amount in it,
        // and that had a double-charge in it. If the charge succeeded but the
        // Firestore write did not, the counters stayed dirty; if the balance
        // then moved before a retry, Stripe rejected the reused key (same key,
        // different amount) so the run errored and the counters stayed dirty
        // again — and next month the key was different, so the SAME debt was
        // charged a second time.
        //
        // Two things fix it. The key now carries the amount, so a changed
        // amount gets a fresh key instead of an error. And before charging
        // anything we look for a PaymentIntent already succeeded for this user
        // and month — which is only possible because the intent now carries
        // metadata; it had none.
        const claimRef = db.collection("settlements").doc(`${uid}_${month}`);
        const claim = await claimRef.get();
        const claimData = claim.exists ? claim.data() : null;

        let pi = null;
        if (claimData && claimData.status !== "settled") {
          // A previous run got as far as Stripe. Find out whether it landed.
          const prior = await findSettledIntent(stripe, customerId, month);
          if (prior) {
            console.warn(`settlement ${uid} ${month}: recovering charge ${prior.id}`);
            pi = prior;
          }
        }

        if (!pi) {
          await claimRef.set({
            uid, month, grossCents: gross, subtotalCents: owed,
            status: "attempting", attemptedAt: now,
          }, { merge: true });

          pi = await stripe.paymentIntents.create(
            {
              amount: gross,
              currency: pricing.currency,
              customer: customerId,
              payment_method: stripePaymentMethodId,
              confirm: true,
              off_session: true,
              // Without this the intent is unattributable and the recovery
              // lookup above is impossible.
              metadata: { firebaseUid: uid, settlementMonth: month },
            },
            { idempotencyKey: `monthly-settle-${uid}-${month}-${gross}` },
          );
        }

        if (pi.status !== "succeeded") {
          // `requires_action` is the common one: an off-session charge that needs
          // 3-D Secure cannot complete without the cardholder present, and the
          // balance would otherwise roll silently into next month forever.
          const needsAction = pi.status === "requires_action" || pi.status === "requires_payment_method";
          await pushTo(
            uid, db,
            needsAction ? "Paiement à confirmer" : "Paiement refusé",
            needsAction ? "Confirm your payment" : "Payment declined",
            needsAction
              ? `Ta banque demande une confirmation pour ${dollars(owed)}. Ouvre l'app pour terminer.`
              : `Ton paiement de ${dollars(owed)} a été refusé. Vérifie ta carte.`,
            needsAction
              ? `Your bank needs you to confirm ${dollars(owed)}. Open the app to finish.`
              : `Your ${dollars(owed)} payment was declined. Check your card.`,
            { type: "settlement_failed", status: pi.status, amountCents: String(owed) },
          ).catch(() => {});
          await ref.set({
            lastSettlementFailedAt: now,
            lastSettlementFailureReason: pi.status,
          }, { merge: true }).catch(() => {});
          results.push({ uid, status: "not_succeeded", pi_status: pi.status });
          continue;
        }

        // Only now may the counters clear. Zeroing earnings on a failed charge
        // would silently confiscate money the driver is owed.
        await db.runTransaction(async (t) => {
          // Charge went through — lift any block /rides/can-join was applying.
          settleCounters(t, {
            lastSettlementFailedAt: FieldValue.delete(),
            lastSettlementFailureReason: FieldValue.delete(),
          });
          t.set(claimRef, {
            uid, month, grossCents: gross, subtotalCents: owed,
            status: "settled", settledAt: now, stripePaymentIntentId: pi.id,
          }, { merge: true });
          t.set(ref.collection("transactions").doc(), {
            type: "monthly_charge",
            // `amount` is what the card was actually charged; the split lets the
            // wallet show "Rides $50.00 / Processing $1.81" instead of one
            // unexplained number.
            amount: gross,
            subtotalCents: owed,
            processingFeeCents,
            status: "completed",
            description: `Monthly settlement ${month} — ${offset}`,
            createdAt: now,
            stripePaymentIntentId: pi.id,
          });
        });
        results.push({ uid, status: "charged", amount: gross, subtotal: owed, fee: processingFeeCents });
        continue;
      }

      // ── We owe them — move the difference into their cashable balance ─────
      //
      // Settlement does NOT pay anyone. It converts earnings into money that is
      // actually collectable: passengers were just charged for these rides, so
      // from here the funds genuinely exist (once they clear Stripe's T+2..7),
      // and `queueMonthlyPayouts` sends them on the 5th.
      //
      // This is the ONLY place `availableEarningsCents` is credited, and that is
      // load-bearing: it is what guarantees no driver is ever paid money that a
      // passenger was not charged for. See the note above PAYOUT_DAY_OF_MONTH.
      //
      // No payout floor is applied here on purpose. The floor gates the ENQUEUE
      // instead, so a driver earning $15 a month accumulates toward $25 across
      // months rather than failing the floor every month forever.
      //
      // Connect setup is irrelevant at this point — a driver with no Connect
      // account still accrues a cashable balance, and it still offsets their own
      // ride charges next month. Connect is only needed to move it to a bank.
      if (net > 0) {
        await db.runTransaction(async (t) => {
          const snap = await t.get(ref);
          const cur = snap.data() ?? {};
          const nextAvailable = (Number(cur.availableEarningsCents) || 0) + net;
          const update = {
            pendingChargeCents: FieldValue.increment(-charges),
            pendingEarningsCents: FieldValue.increment(-earnings),
            availableEarningsCents: nextAvailable,
          };
          t.set(ref, update, { merge: true });
          t.set(ref.collection("transactions").doc(), {
            type: "earnings_available",
            amount: net,
            status: "completed",
            description: `Earnings available ${month} — ${offset}`,
            createdAt: now,
          });
        });
        results.push({ uid, status: "earnings_available", amount: net });
        continue;
      }

      // ── Exactly square — clear both, no money moves, no ledger entry ───────
      await db.runTransaction(async (t) => {
        settleCounters(t);
      });
      results.push({ uid, status: "offset", amount: 0 });
    } catch (err) {
      console.error(`Monthly settlement failed for ${uid}:`, err);
      results.push({ uid, status: "failed", error: err.message });
    }
  }

  return results;
}

/** Roll the per-user settlement results into something a human can read.
 *
 *  `charged` is the goal. The three uncollected statuses are the number that
 *  actually matters and the one nothing surfaced before: every one of them is a
 *  ride the DRIVER was already credited for at /rides/finish, against a
 *  passenger charge that did not happen. `below_threshold` in particular is
 *  silent by design — the balance rolls forward with no notification — so
 *  without this total a growing pile of never-collected debt is invisible.
 *
 *  Sums are in cents. `uncollectedCents` is the gap between what the wallets
 *  promise drivers and what UniLift actually holds. */
function settlementTotals(results) {
  const UNCOLLECTED = new Set(["below_threshold", "no_payment_method", "not_succeeded"]);
  const totals = { counts: {}, chargedCents: 0, uncollectedCents: 0, earningsCreditedCents: 0 };
  for (const r of results) {
    totals.counts[r.status] = (totals.counts[r.status] ?? 0) + 1;
    const amount = Number(r.amount) || 0;
    if (r.status === "charged") totals.chargedCents += amount;
    else if (r.status === "earnings_available") totals.earningsCreditedCents += amount;
    else if (UNCOLLECTED.has(r.status)) totals.uncollectedCents += amount;
  }
  return totals;
}

async function handleSettleMonthly(req, res) {
  const db = getDb(req); const stripe = getStripe(req);
  const billingSecret = process.env.BILLING_SECRET;
  if (!billingSecret || req.headers["x-billing-secret"] !== billingSecret) {
    return res.status(403).json({ error: "Forbidden" });
  }
  try {
    const results = await settleAllUsers(db, stripe);
    res.json({ results, totals: settlementTotals(results) });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: err.message });
  }
}

app.post("/billing/settle-monthly", authenticate, handleSettleMonthly);
// Legacy aliases — charges and payouts are one netted pass now, so both of the
// old routes run the same settlement. Re-running within a month is a no-op:
// the counters are already zero.
app.post("/billing/charge-monthly", authenticate, handleSettleMonthly);
app.post("/billing/payout-drivers", authenticate, handleSettleMonthly);

// POST /billing/queue-payouts — manual trigger for the monthly enqueue, same
// x-billing-secret guard. Safe to re-run: findPendingCashout means a driver with
// a row already in flight is skipped rather than queued twice.
app.post("/billing/queue-payouts", authenticate, async (req, res) => {
  const db = getDb(req);
  const billingSecret = process.env.BILLING_SECRET;
  if (!billingSecret || req.headers["x-billing-secret"] !== billingSecret) {
    return res.status(403).json({ error: "Forbidden" });
  }
  try {
    const tally = await queueMonthlyPayouts(db);
    res.json({ tally });
  } catch (err) {
    console.error("/billing/queue-payouts error:", err);
    res.status(500).json({ error: err.message });
  }
});

// POST /billing/run-payouts — manual trigger for the daily transfer sweeper,
// same x-billing-secret guard. Used for testing and incident response.
app.post("/billing/run-payouts", authenticate, async (req, res) => {
  const db = getDb(req); const stripe = getStripe(req);
  const billingSecret = process.env.BILLING_SECRET;
  if (!billingSecret || req.headers["x-billing-secret"] !== billingSecret) {
    return res.status(403).json({ error: "Forbidden" });
  }
  try {
    const tally = await payoutPendingEarningsImpl(db, stripe);
    res.json({ tally });
  } catch (err) {
    console.error("/billing/run-payouts error:", err);
    res.status(500).json({ error: err.message });
  }
});


// POST /billing/refund — give money back for one ride leg.
//
// Behind the same x-billing-secret guard as the other /billing/* routes: this is
// a support tool, not something a client may call. There was previously no
// refund path at all, so a wrongly charged passenger — a bad GPS fix, a disputed
// dropoff, a driver who took them somewhere else — could only be made whole by
// hand in the Stripe dashboard, which left the Firestore counters and the ledger
// saying something different from the truth.
//
// WHERE THE MONEY IS decides what has to happen, so the two cases are separate:
//
//   • Not yet settled — the charge is still an accrual. Nothing has moved, so
//     both sides are simply decremented. No Stripe call.
//   • Already settled — the card was charged, so Stripe must refund it, and the
//     driver's side has to come back too. If their money is still in the wallet
//     it is debited; if it has already been paid out to their bank we record a
//     `clawback` instead of driving the balance negative, because a negative
//     balance would silently eat their next month's earnings without explanation.
app.post("/billing/refund", authenticate, async (req, res) => {
  const db = getDb(req); const stripe = getStripe(req);
  const billingSecret = process.env.BILLING_SECRET;
  if (!billingSecret || req.headers["x-billing-secret"] !== billingSecret) {
    return res.status(403).json({ error: "Forbidden" });
  }

  const { rideId, passengerId, amountCents, reason } = req.body || {};
  const amount = Number(amountCents);
  if (!rideId || !passengerId || !Number.isFinite(amount) || amount <= 0) {
    return res.status(400).json({ error: "rideId, passengerId and a positive amountCents are required" });
  }

  try {
    const rideSnap = await db.collection("rides").doc(rideId).get();
    if (!rideSnap.exists) return res.status(404).json({ error: "ride_not_found" });
    const ride = rideSnap.data();
    const driverId = ride.driverId;

    // The original charge row. Its status tells us which case we are in.
    const chargeQ = await db.collection("users").doc(passengerId)
      .collection("transactions")
      .where("rideId", "==", rideId)
      .where("type", "==", "ride_charge")
      .limit(1).get();
    if (chargeQ.empty) return res.status(404).json({ error: "charge_not_found" });
    const charge = chargeQ.docs[0].data();
    if (amount > Number(charge.amount)) {
      return res.status(400).json({ error: "amount_exceeds_charge", chargedCents: Number(charge.amount) });
    }
    if (charge.refundedCents) {
      const already = Number(charge.refundedCents) || 0;
      if (already + amount > Number(charge.amount)) {
        return res.status(400).json({ error: "amount_exceeds_remaining", refundedCents: already });
      }
    }

    const now = new Date().toISOString();
    const passengerRef = db.collection("users").doc(passengerId);
    const passengerSnap = await passengerRef.get();
    const passenger = passengerSnap.data() ?? {};
    const stillAccrued = (Number(passenger.pendingChargeCents) || 0) >= amount;

    let stripeRefundId = null;
    let mode;

    if (stillAccrued) {
      // ── Unsettled: reverse the accrual on both sides. ──────────────────────
      mode = "accrual";
    } else {
      // ── Settled: the card really was charged. ─────────────────────────────
      const month = String(charge.createdAt || now).slice(0, 7);
      const claim = await db.collection("settlements").doc(`${passengerId}_${month}`).get();
      const paymentIntentId = claim.exists ? claim.data().stripePaymentIntentId : null;
      if (!paymentIntentId) {
        return res.status(409).json({
          error: "no_settlement_found",
          message: "The charge is settled but no PaymentIntent is recorded for that month. Refund it in the Stripe dashboard; the charge.refunded webhook will reconcile the counters.",
        });
      }
      const refund = await stripe.refunds.create(
        {
          payment_intent: paymentIntentId,
          amount,
          metadata: { firebaseUid: passengerId, rideId, reason: String(reason || "support") },
        },
        { idempotencyKey: `refund-${rideId}-${passengerId}-${amount}` },
      );
      stripeRefundId = refund.id;
      mode = "stripe";
    }

    await db.runTransaction(async (t) => {
      const driverRef = db.collection("users").doc(driverId);
      const driverSnap = driverId ? await t.get(driverRef) : null;

      if (stillAccrued) {
        t.set(passengerRef, { pendingChargeCents: FieldValue.increment(-amount) }, { merge: true });
      }

      // The driver's side. `fareCents` is what they were credited; the reserve
      // was never theirs, so only the fare portion is clawed back.
      const fareShare = Math.min(amount, Number(charge.fareCents) || amount);
      if (driverSnap && driverSnap.exists) {
        const d = driverSnap.data() ?? {};
        const pendingEarnings = Number(d.pendingEarningsCents) || 0;
        const availableEarnings = Number(d.availableEarningsCents) || 0;
        if (pendingEarnings >= fareShare) {
          t.set(driverRef, { pendingEarningsCents: FieldValue.increment(-fareShare) }, { merge: true });
        } else if (availableEarnings >= fareShare) {
          t.set(driverRef, { availableEarningsCents: FieldValue.increment(-fareShare) }, { merge: true });
        } else {
          // Already in their bank. Record the debt rather than making the
          // balance negative — support decides how to recover it.
          t.set(driverRef.collection("transactions").doc(), {
            type: "clawback", amount: fareShare, status: "outstanding",
            description: `Refund clawback — ride ${rideId}`,
            createdAt: now, rideId, reason: String(reason || "support"),
          });
        }
      }

      t.set(chargeQ.docs[0].ref, {
        refundedCents: FieldValue.increment(amount),
      }, { merge: true });

      t.set(passengerRef.collection("transactions").doc(), {
        type: "refund", amount, status: "completed",
        description: `Refund — ride ${rideId}`,
        createdAt: now, rideId, mode,
        ...(stripeRefundId ? { stripeRefundId } : {}),
        ...(reason ? { reason: String(reason) } : {}),
      });
    });

    console.log("refund issued", { rideId, passengerId, amount, mode, stripeRefundId });
    return res.json({ success: true, mode, amountCents: amount, stripeRefundId });
  } catch (err) {
    console.error("/billing/refund error:", err);
    return res.status(500).json({ error: err.message });
  }
});

// ── Per-device account cap ───────────────────────────────────────────────────
//
// Signup itself never reaches this server — the app calls Firebase Auth
// directly — so the cap cannot be enforced *during* account creation. It is
// enforced immediately after instead: the client registers the device it just
// created an account on, and a device over its limit has that account deleted
// here before the user ever reaches the app.
//
// The device id is a SHA-256 hash minted on the phone (services/deviceIdentity.ts).
// The raw identifier never leaves the device, so `deviceAccounts` is a table of
// opaque keys rather than a list of people's hardware.
//
// Honest limit, worth knowing before trusting this: the hash is supplied by the
// client. A modified build can send a fresh one every time, and the Firebase
// REST signup endpoint sends none at all. This stops real users and casual
// abuse; attestation (App Check / App Attest — open item #1 in
// docs/security-audit.md) is what would close the rest.
const MAX_ACCOUNTS_PER_DEVICE = 5;

/** Reject anything that is not one of our hashes before it becomes a doc id. */
function validDeviceId(value) {
  return typeof value === "string" && /^[a-f0-9]{64}$/i.test(value);
}

// Advisory pre-check, called when the signup flow opens so somebody at the cap
// is told before answering eight questions. Unauthenticated by necessity — the
// account does not exist yet — so it is IP-throttled on its own and returns
// nothing an attacker could not learn by simply trying to sign up.
app.post("/device/check", async (req, res) => {
  if (deviceCheckThrottled(req.ip)) {
    return res.status(429).json({ error: "rate_limited" });
  }
  const { deviceId } = req.body || {};
  if (!validDeviceId(deviceId)) {
    return res.status(400).json({ error: "deviceId required" });
  }
  try {
    const db = getDb(req);
    const snap = await db.collection("deviceAccounts").doc(deviceId).get();
    const active = snap.exists ? (Number(snap.data().active) || 0) : 0;
    const remaining = Math.max(0, MAX_ACCOUNTS_PER_DEVICE - active);
    return res.json({ allowed: remaining > 0, remaining });
  } catch (err) {
    console.error("/device/check:", err);
    return res.status(500).json({ error: "internal" });
  }
});

// The enforcement half. Claims a slot for the caller's brand-new account, and
// deletes that account if the device is already at its limit.
app.post("/device/register", authenticate, async (req, res) => {
  const { deviceId } = req.body || {};
  if (!validDeviceId(deviceId)) {
    return res.status(400).json({ error: "deviceId required" });
  }
  const db = getDb(req);
  const uid = req.uid;
  try {
    const ref = db.collection("deviceAccounts").doc(deviceId);
    const out = await db.runTransaction(async (tx) => {
      const snap = await tx.get(ref);
      const data = snap.exists ? snap.data() || {} : {};
      const uids = Array.isArray(data.uids) ? data.uids : [];

      // Idempotent: the client retries this on a flaky network, and a retry
      // must not consume a second slot.
      if (uids.includes(uid)) return { ok: true, already: true };

      const active = Number(data.active) || 0;
      if (active >= MAX_ACCOUNTS_PER_DEVICE) return { error: "device_account_limit" };

      tx.set(ref, {
        active: active + 1,
        // Never decremented, unlike `active`. Deleting an account frees a slot
        // by design, which makes create-delete-repeat a bypass; this is the
        // number that shows whether anyone is actually doing it.
        everCreated: FieldValue.increment(1),
        uids: FieldValue.arrayUnion(uid),
        lastAccountAt: FieldValue.serverTimestamp(),
      }, { merge: true });
      return { ok: true };
    });

    if (out.error === "device_account_limit") {
      // The account exists and must not survive. Firestore doc first: if the
      // auth delete fails we have still removed the profile, and a uid with no
      // auth record is inert.
      try {
        await db.collection("users").doc(uid).delete();
        await admin.auth().deleteUser(uid);
      } catch (cleanupErr) {
        console.error("/device/register: cleanup failed for", uid, cleanupErr.message);
      }
      return res.status(429).json({ error: "device_account_limit" });
    }

    return res.json({ success: true });
  } catch (err) {
    console.error("/device/register:", err);
    return res.status(500).json({ error: "internal" });
  }
});

// ── Account: Delete ──────────────────────────────────────────────────────────
//
// Permanently erases all data for the calling user:
//   1. Detaches Stripe payment method and deletes the Stripe customer (if any)
//   2. Deletes all documents in users/{uid}/transactions
//   3. Deletes the users/{uid} document
//   4. Deletes the Firebase Auth account
//
// The client must sign out after receiving a success response because the
// Auth account no longer exists and any subsequent token refresh will fail.
//
app.post("/account/delete", authenticate, async (req, res) => {
  const db = getDb(req); const stripe = getStripe(req);
  const uid = req.uid;
  try {
    const userSnap = await db.collection("users").doc(uid).get();
    const data = userSnap.exists ? (userSnap.data() ?? {}) : {};

    // ── Refuse while money is in flight ────────────────────────────────────
    //
    // Deleting an account used to walk straight past all of this. A driver with a
    // queued payout left a `payouts` row pointing at a user document that no
    // longer existed, so the sweeper failed it five times and then tried to
    // refund the balance onto a deleted doc — throwing, and wedging the row to be
    // retried every day forever. And a passenger with an unsettled balance could
    // simply delete their way out of paying.
    const pending = await findPendingCashout(db, uid);
    if (pending) {
      return res.status(409).json({
        error: "cashout_pending",
        amountCents: pending.amountCents,
        message: "A payout is on its way. Delete your account once it lands.",
      });
    }

    const owed = Number(data.pendingChargeCents) || 0;
    const pricing = await getPricing(db);
    // Gated on what Stripe can actually collect, NOT on minSettlementCents.
    // Those are different questions: the settlement floor decides what is worth
    // charging this month, and a balance under it simply rolls forward. Gating
    // deletion on the same number turned every roll-forward balance into a
    // write-off — close the account, the debt disappears — and silently got
    // worse every time someone raised the floor.
    if (owed >= pricing.minChargeableCents) {
      return res.status(409).json({
        error: "balance_outstanding",
        amountCents: owed,
        message: "Settle your outstanding balance before deleting your account.",
      });
    }

    const unpaid = Number(data.availableEarningsCents) || 0;
    if (unpaid >= pricing.minPayoutCents) {
      return res.status(409).json({
        error: "earnings_unclaimed",
        amountCents: unpaid,
        message: "Cash out your earnings before deleting your account.",
      });
    }

    // ── Active rides ───────────────────────────────────────────────────────
    // A driver vanishing mid-ride strands the people in their car.
    const activeAsDriver = await db.collection("rides")
      .where("driverId", "==", uid)
      .where("status", "in", ["planned", "started"])
      .limit(1).get();
    if (!activeAsDriver.empty) {
      return res.status(409).json({
        error: "active_ride",
        message: "Finish or cancel your active ride before deleting your account.",
      });
    }

    // ── Stripe: the customer AND the connected account ─────────────────────
    if (data.stripePaymentMethodId) {
      await stripe.paymentMethods.detach(data.stripePaymentMethodId).catch(() => {});
    }
    if (data.stripeCustomerId) {
      await stripe.customers.del(data.stripeCustomerId).catch(() => {});
    }
    // Deleting the UniLift account must also delete the Express account, or the
    // person's bank details and SIN stay at Stripe indefinitely under an id
    // nothing references any more — a Loi 25 exposure that grows with every
    // driver who onboards.
    if (data.stripeConnectAccountId) {
      try {
        await stripe.accounts.del(data.stripeConnectAccountId);
      } catch (err) {
        const code = err && err.raw && err.raw.code;
        const isBalance = code === "balance_insufficient" || /balance/i.test(String(err && err.message));
        if (err && err.statusCode !== 404) {
          // Stripe refuses while it still holds money for them. Stop rather than
          // orphan the account — "wait for your payout to reach your bank" is
          // actionable, a silently orphaned account is not.
          console.error("/account/delete: could not delete Connect account", err.message);
          return res.status(409).json({
            error: isBalance ? "connect_balance_not_zero" : "connect_delete_failed",
            message: isBalance
              ? "Stripe is still holding a payout for you. Try again once it reaches your bank."
              : "We could not remove your payout account. Contact support.",
          });
        }
      }
    }

    // ── Their avatar ───────────────────────────────────────────────────────
    // Storage is not covered by Firestore deletes, so the profile picture used to
    // outlive the account it belonged to.
    try {
      // Two shapes exist. `profiles/{uid}/avatar.jpg` is what 1.4.0+ writes;
      // `profiles/{uid}.jpg` is the flat path every build up to 1.3.x wrote and
      // still writes. Deleting only the first left the legacy file behind, so a
      // deletion request did not actually remove the person's photo.
      await admin.storage().bucket().deleteFiles({ prefix: `profiles/${uid}/` });
      // Exact object rather than a `profiles/${uid}` prefix sweep, which would
      // also match another account whose uid merely starts with this one.
      await admin.storage().bucket().file(`profiles/${uid}.jpg`).delete({ ignoreNotFound: true });
    } catch (err) {
      console.warn("/account/delete: avatar cleanup failed", err.message);
    }

    // ── Firestore ──────────────────────────────────────────────────────────
    for (const sub of ["transactions", "public", "private"]) {
      for (;;) {
        const snap = await db.collection("users").doc(uid).collection(sub).limit(400).get();
        if (snap.empty) break;
        const batch = db.batch();
        snap.docs.forEach((doc) => batch.delete(doc.ref));
        await batch.commit();
        if (snap.size < 400) break;
      }
    }

    // Settled payout rows are history, but they carry the uid; drop them so no
    // record of the deleted person survives in a collection they cannot see.
    const payoutRows = await db.collection("payouts").where("uid", "==", uid).limit(400).get();
    if (!payoutRows.empty) {
      const batch = db.batch();
      payoutRows.docs.forEach((doc) => batch.delete(doc.ref));
      await batch.commit();
    }

    // ── Release the account-creation claims ────────────────────────────────
    //
    // Both are released on delete, which is a deliberate product decision:
    // somebody who closes their account can sign up again with their own
    // address, on the same phone. The cost is that create-delete-repeat resets
    // the device tally — `everCreated` on the device document is never
    // decremented, so that bypass is visible if anyone starts using it.
    //
    // Best-effort, and last before the account itself goes: a failure here must
    // not abort a deletion that has already removed the person's data. A
    // stranded emailIndex row is self-healing anyway — the blocking function
    // reclaims any row whose uid no longer resolves to an account.
    try {
      const emailForIndex = typeof data.email === "string" ? data.email : "";
      if (emailForIndex) {
        const canonical = normalizeEmailForIndex(emailForIndex);
        const idxRef = indexDbForClaims().collection("emailIndex").doc(emailIndexKeyForClaims(canonical));
        await indexDbForClaims().runTransaction(async (tx) => {
          const snap = await tx.get(idxRef);
          // Only release a row this account actually holds. Another uid owning
          // it means this one never claimed the mailbox, and deleting the row
          // would hand somebody else's mailbox back to the pool.
          if (snap.exists && (snap.data() || {}).uid === uid) tx.delete(idxRef);
        });
      }
    } catch (err) {
      console.warn("/account/delete: emailIndex release failed", err.message);
    }

    try {
      const devices = await db.collection("deviceAccounts").where("uids", "array-contains", uid).limit(10).get();
      for (const doc of devices.docs) {
        await doc.ref.update({
          active: FieldValue.increment(-1),
          uids: FieldValue.arrayRemove(uid),
        });
      }
    } catch (err) {
      console.warn("/account/delete: device slot release failed", err.message);
    }

    await db.collection("users").doc(uid).delete();

    // ── Auth, last: deleting it invalidates the token this request is using ──
    await admin.auth().deleteUser(uid);

    res.json({ success: true });
  } catch (err) {
    console.error("/account/delete error:", err);
    res.status(500).json({ error: err.message });
  }
});

// ── Social linking (REMOVED 2026-08-25) ──────────────────────────────────────
// The four /social/* routes (link/unlink Facebook, and the OAuth
// authorization-code flow for Instagram / TikTok / Spotify) were deleted along
// with their client (components/profile/connect-socials.tsx and its two hooks),
// which had never been rendered by any screen.
//
// The user-doc fields they wrote — facebookId/facebookName, instagramId/Handle,
// tiktokId/Handle, spotifyId/spotifyName — are INTENTIONALLY LEFT IN PLACE.
// Several screens still read and display them (rider/ride/acceptRide/
// driverRequests profile modals show "@instagramHandle"; the profile tab shows
// facebookId), so the read path is live even though nothing can populate it any
// more. Restoring the feature means restoring these routes plus a UI entry
// point; the stored data and the display code are still here.
// ── Detour Matching Helpers ──────────────────────────────────────────────────

function haversineKmLatLng(a, b) {
  return haversineKm(a.lat, a.lng, b.lat, b.lng);
}

// ── Driver-selects-passenger matchmaking ──────────────────────────────────────

const gp = (g) => (g ? { lat: g.latitude, lng: g.longitude } : null);

// Weekday keys aligned with WEEKDAY_KEYS in types/models.ts (Sun=0 … Sat=6).
const WEEKDAY_KEYS = ["sun", "mon", "tue", "wed", "thu", "fri", "sat"];

/** A representative destination for a Drive Mode driver when we're notifying
 *  them outside any active window (the fallback) — first availability window's
 *  destination, else their saved default destination, else nothing. */
function representativeDriverDest(u) {
  const windows = Array.isArray(u.driverAvailability) ? u.driverAvailability : [];
  for (const w of windows) {
    const coords = gp(w && w.destinationCoords);
    if (coords) return { dest: (w && w.destination) || "", coords };
  }
  const defCoords = gp(u.driverDefaultDestinationCoords);
  if (defCoords) return { dest: u.driverDefaultDestination || "", coords: defCoords };
  return { dest: "", coords: null };
}

// ── Proximity matching tunables ──────────────────────────────────────────────
// How close a driver's live position must be to the passenger's pickup for the
// driver to be considered "near" (live-position gate + fallback radius). Only
// applied to drivers we have a live GPS fix for (online live drives).
const DRIVER_PROXIMITY_KM = 15;
// Default destination-match radius (km) when a driver hasn't set their own. The
// driver's own radius (set in the availability / go-online form) overrides this.
const DEFAULT_DEST_RADIUS_KM = 10;
// If fewer than this many drivers are heading the passenger's direction, broaden
// the dispatch to every driver within DRIVER_PROXIMITY_KM regardless of where
// they're going.
const MIN_DIRECTION_MATCHES = 3;
// TEMPORARY accessibility flag. While false, dispatch ignores all proximity /
// window / destination matching and simply notifies every user with driver mode
// ON (users.driverModeEnabled !== false). Flip back to true to restore the
// proximity + availability-window matching algo below once the user base grows.
// Mirrors functions-sandbox/index.js — keep the two in sync.
const USE_LEGACY_MATCHING = false;

/** First name only. A broadcast goes to strangers; a full name is an
 *  identification most passengers would not expect to hand out to 500 people. */
function broadcastSafeName(full) {
  const first = String(full || "").trim().split(/\s+/)[0] || "A passenger";
  return first;
}

/** Reduce a street-level label to something that conveys the area without the
 *  address. "1234 Rue Saint-Jean, Québec" → "Québec". Falls back to the last
 *  comma-separated component, which is the locality in every label the app
 *  builds; a label with no comma is returned only if it has no digits, since a
 *  bare street address is exactly what must not go out. */
function coarseLabel(label) {
  const raw = String(label || "").trim();
  if (!raw) return "";
  const parts = raw.split(",").map((p) => p.trim()).filter(Boolean);
  if (parts.length > 1) return parts[parts.length - 1];
  return /\d/.test(raw) ? "" : raw;
}

/** Does `now` (minutes from midnight) fall inside any of the driver's
 *  availability windows that are active today? Returns the matching window or
 *  null. */
function matchAvailabilityWindow(windows, todayKey, nowMinutes) {
  if (!Array.isArray(windows)) return null;
  for (const w of windows) {
    if (!w || !Array.isArray(w.days) || !w.days.includes(todayKey)) continue;
    const start = Number(w.startMinutes);
    const end = Number(w.endMinutes);
    if (!Number.isFinite(start) || !Number.isFinite(end)) continue;
    if (nowMinutes >= start && nowMinutes <= end) return w;
  }
  return null;
}
// ── Parked: proximity matching (behind USE_LEGACY_MATCHING) ──────────────────
// Everything in these two functions runs ONLY when USE_LEGACY_MATCHING is
// flipped back to true. While the flag is false they are unreachable.
//
// They are kept deliberately, not forgotten: the broadcast path that replaced
// them scans the entire `users` collection, which is why /drivers/available
// needs a cache (see getEligibleRecipientIds) and why this algorithm is the
// intended destination once the driver base is dense enough. See
// docs/codebase-optimization-plan.md finding #4.
//
// They live in named functions rather than falling through the two route bodies
// so the parked region is one obvious block instead of ~130 lines of dead
// fall-through inside handlers that are very much alive.

/** Phase 1 (direction matches) + phase 2 (proximity fallback) fan-out.
 *  `pushToDriver` and `notifiedDriverIds` are the route's closures — together
 *  they own dedup and rejected-driver filtering, so they are passed in rather
 *  than reimplemented here. */
async function dispatchByProximity({ db, req, res, pickup, dropoff, seatsNeeded, pushToDriver, notifiedDriverIds }) {
  let notified = 0;
  // Drivers heading the passenger's direction (phase 1). The fallback only
  // fires when this stays below MIN_DIRECTION_MATCHES.
  let directionMatches = 0;

  // The online live drives are reused by the fallback pass, so fetch once.
  const sessionsSnap = await db.collection("driverSessions").where("status", "==", "online").get();
  const onlineSessions = sessionsSnap.docs
    .map((doc) => doc.data())
    .filter((s) => s && s.driverId !== req.uid && (Number(s.seatsAvailable) || 0) >= seatsNeeded);

  // ── Phase 1a. Online live drives — near pickup AND heading our way ───────
  await Promise.all(
    onlineSessions.map(async (s) => {
      const dOrigin = gp(s.origin);
      const dDest = gp(s.destinationCoords);
      if (!dOrigin || !dDest) return;
      // Live-position gate: driver must be within 15 km of the pickup.
      if (haversineKmLatLng(pickup, dOrigin) > DRIVER_PROXIMITY_KM) return;
      // Destination match: passenger dropoff inside the driver's own radius.
      const radius = Number(s.destinationRadiusKm) || DEFAULT_DEST_RADIUS_KM;
      if (haversineKmLatLng(dropoff, dDest) > radius) return;
      if (await pushToDriver(s.driverId, s.destination || "", dDest, Number(s.seatsAvailable) || 4)) {
        notified += 1;
        directionMatches += 1;
      }
    }),
  );

  // ── Phase 1b. Ride Mode availability (may be offline) — heading our way ──
  // No live GPS for these drivers, so the proximity gate can't apply; they
  // match on destination radius + an active window only.
  const now = new Date();
  const todayKey = WEEKDAY_KEYS[now.getDay()];
  const nowMinutes = now.getHours() * 60 + now.getMinutes();
  // Every driver with Drive Mode configured (any window on any day). Reused by
  // the fallback pass below.
  const driveModeSnap = await db
    .collection("users")
    .where("driverDays", "array-contains-any", WEEKDAY_KEYS)
    .get();
  await Promise.all(
    driveModeSnap.docs.map(async (doc) => {
      if (doc.id === req.uid || notifiedDriverIds.has(doc.id)) return;
      const u = doc.data() || {};
      const window = matchAvailabilityWindow(u.driverAvailability, todayKey, nowMinutes);
      if (!window) return;
      const wDest = gp(window.destinationCoords);
      if (!wDest) return;
      const radius = Number(u.driverDestinationRadiusKm) || DEFAULT_DEST_RADIUS_KM;
      if (haversineKmLatLng(dropoff, wDest) > radius) return;
      if (await pushToDriver(doc.id, window.destination || "", wDest, 4)) {
        notified += 1;
        directionMatches += 1;
      }
    }),
  );

  // ── Phase 2. Fallback — not enough drivers heading our way ───────────────
  // Notify every available driver regardless of their destination:
  //   • online drivers within DRIVER_PROXIMITY_KM of the pickup, and
  //   • every driver with Drive Mode configured at all — ignoring their day /
  //     time windows entirely (no active-window or live-GPS requirement).
  // Already-notified drivers are skipped via notifiedDriverIds in pushToDriver.
  if (directionMatches < MIN_DIRECTION_MATCHES) {
    await Promise.all(
      onlineSessions.map(async (s) => {
        const dOrigin = gp(s.origin);
        if (!dOrigin) return;
        if (haversineKmLatLng(pickup, dOrigin) > DRIVER_PROXIMITY_KM) return;
        const dDest = gp(s.destinationCoords);
        if (await pushToDriver(s.driverId, s.destination || "", dDest, Number(s.seatsAvailable) || 4)) {
          notified += 1;
        }
      }),
    );
    await Promise.all(
      driveModeSnap.docs.map(async (doc) => {
        if (doc.id === req.uid || notifiedDriverIds.has(doc.id)) return;
        const u = doc.data() || {};
        const { dest, coords } = representativeDriverDest(u);
        if (await pushToDriver(doc.id, dest, coords, 4)) {
          notified += 1;
        }
      }),
    );
  }
  return res.json({ notified, directionMatches });
}

/** Read-only twin of dispatchByProximity: counts who *would* be reached without
 *  notifying anyone, so the passenger-facing stat matches real dispatch. */
async function countReachableByProximity({ db, req, res, pickup, dropoff, hasPickup, seatsNeeded }) {
  // Two sets, mirroring dispatch: `direction` = drivers heading the
  // passenger's way (phase 1); `reachable` = everyone who would actually be
  // pushed if the fallback fires (online within 15 km + active Ride Mode
  // drivers, regardless of destination). The headline count reflects who gets
  // notified: when fewer than MIN_DIRECTION_MATCHES are heading that way, the
  // fallback pings the whole reachable set, so we report its size.
  const direction = new Set();
  const reachable = new Set();

  // 1. Online live drives.
  const sessionsSnap = await db.collection("driverSessions").where("status", "==", "online").get();
  sessionsSnap.docs.forEach((doc) => {
    const s = doc.data();
    if (!s || s.driverId === req.uid) return;
    if ((Number(s.seatsAvailable) || 0) < seatsNeeded) return;
    const dOrigin = gp(s.origin);
    const dDest = gp(s.destinationCoords);
    if (!dOrigin || !dDest) return;
    // Live-position gate (when we know the pickup) applies to both sets.
    if (hasPickup && haversineKmLatLng(pickup, dOrigin) > DRIVER_PROXIMITY_KM) return;
    reachable.add(s.driverId);
    if (haversineKmLatLng(dropoff, dDest) <= (Number(s.destinationRadiusKm) || DEFAULT_DEST_RADIUS_KM)) {
      direction.add(s.driverId);
    }
  });

  // 2. Drive Mode drivers (any window on any day). Every one of them is in the
  //    reachable (fallback) set regardless of day/time/destination; they're
  //    direction-matched only if a window is active now AND within their radius.
  const now = new Date();
  const todayKey = WEEKDAY_KEYS[now.getDay()];
  const nowMinutes = now.getHours() * 60 + now.getMinutes();
  const driveModeSnap = await db.collection("users").where("driverDays", "array-contains-any", WEEKDAY_KEYS).get();
  driveModeSnap.docs.forEach((doc) => {
    if (doc.id === req.uid) return;
    const u = doc.data() || {};
    reachable.add(doc.id);
    const window = matchAvailabilityWindow(u.driverAvailability, todayKey, nowMinutes);
    if (!window) return;
    const wDest = gp(window.destinationCoords);
    if (!wDest) return;
    if (haversineKmLatLng(dropoff, wDest) <= (Number(u.driverDestinationRadiusKm) || DEFAULT_DEST_RADIUS_KM)) {
      direction.add(doc.id);
    }
  });

  const count = direction.size >= MIN_DIRECTION_MATCHES ? direction.size : reachable.size;
  return res.json({ count, directionCount: direction.size, reachableCount: reachable.size });
}

// POST /requests/dispatch — fan a passenger request out to eligible drivers via
// push. Proximity model, deduped by driverId so a driver who is both online
// (Flow B Live Drive) and inside a Ride Mode window (Flow A) is only notified
// once. Two phases:
//   Phase 1 — direction matches (drivers heading the passenger's way):
//     a. Online driverSessions: live position within DRIVER_PROXIMITY_KM of the
//        passenger's pickup AND destination within the driver's match radius of
//        the passenger's destination.
//     b. Ride Mode availability (may be offline, no live GPS): destination
//        within the driver's match radius of the passenger's destination. The
//        live-position gate is skipped — we have no live fix for them.
//   Phase 2 — fallback: if fewer than MIN_DIRECTION_MATCHES drivers were heading
//     that direction, also notify every online driver within DRIVER_PROXIMITY_KM
//     of the pickup, regardless of where they're going.
// Called by the passenger client right after creating the rideRequest.
app.post("/requests/dispatch", authenticate, async (req, res) => {
  const db = getDb(req);
  try {
    const { requestId } = req.body;
    if (!requestId) return res.status(400).json({ error: "requestId is required" });

    const reqSnap = await db.collection("rideRequests").doc(requestId).get();
    if (!reqSnap.exists) return res.status(404).json({ error: "request not found" });
    const reqData = reqSnap.data();
    if (reqData.passengerId !== req.uid) return res.status(403).json({ error: "not your request" });

    // Throttle. This route is a full scan of `users` followed by a push to every
    // eligible one, and nothing stopped a caller looping it: one account could
    // ring the entire user base as often as it liked, at your cost. A request is
    // dispatched once, then at most once per cooldown, up to a hard cap.
    const lastDispatch = ageMs(reqData.lastDispatchAt);
    if (lastDispatch != null && lastDispatch < DISPATCH_COOLDOWN_MS) {
      return res.status(429).json({
        error: "dispatch_throttled",
        retryAfterMs: DISPATCH_COOLDOWN_MS - lastDispatch,
      });
    }
    if ((Number(reqData.dispatchCount) || 0) >= MAX_DISPATCHES_PER_REQUEST) {
      return res.status(429).json({ error: "dispatch_limit_reached" });
    }
    // Only "open" requests may be fanned out — never one already matched.
    if (reqData.status && reqData.status !== "open") {
      return res.status(409).json({ error: "request_not_open", status: reqData.status });
    }

    const pickup = gp(reqData.origin);
    const dropoff = gp(reqData.destinationCoords);
    if (!pickup || !dropoff) return res.status(400).json({ error: "request missing coordinates" });
    const seatsNeeded = Number(reqData.seatsRequested) || 1;
    // Broadcast dispatch (USE_LEGACY_MATCHING = false) reaches every eligible
    // user, not just drivers near the pickup. Sending the requester's full name
    // and their exact pickup and destination labels to up to 500 strangers is a
    // real disclosure — "request a lift from home" should not tell the whole user
    // base your name and address. The push carries a first name and coarse labels;
    // the full detail lives on the accept screen, which loads the request itself
    // and is only opened by a driver actually considering the ride.
    const fullName = reqData.passengerName || "A passenger";
    const passengerName = broadcastSafeName(fullName);
    const destLabel = coarseLabel(reqData.destination) || "their destination";
    const originLabel = coarseLabel(reqData.originLabel) || "nearby";
    // The precise labels, used only for targeted 1:1 pushes.
    // Can this passenger take on another charge? Checked here rather than only
    // in /rides/can-join, which the client does not call.
    const pricingForGate = await getPricing(db);
    const meSnap = await db.collection("users").doc(req.uid).get();
    const refusal = chargeEligibility(meSnap.data(), pricingForGate);
    if (refusal) return res.status(403).json(refusal);

    // Claim the dispatch slot before doing any work, so two concurrent calls
    // cannot both pass the throttle above.
    await db.collection("rideRequests").doc(requestId).update({
      lastDispatchAt: FieldValue.serverTimestamp(),
      dispatchCount: FieldValue.increment(1),
    });

    const rideKm = haversineKmLatLng(pickup, dropoff);
    const pricing = await getPricing(db);
    // The driver is credited the fare itself, so the "+$X" teaser uses the one
    // fare rate — it now matches what they will actually earn.
    const earningsCents = Math.max(
      Math.round(rideKm * pricing.passengerRateCentsPerKm),
      pricing.minimumChargeCents,
    );

    // Persist the quote. This is the number the passenger is shown for this
    // request, computed here from THEIR OWN pickup and dropoff, and it becomes the
    // ceiling /rides/finish clamps the final charge against. Writing it server-side
    // is the point: the rules make it unwritable by the client, so the amount a
    // passenger consented to cannot be edited after the fact by either party.
    await db.collection("rideRequests").doc(requestId).update({
      quotedFareCents: earningsCents,
      quotedAt: FieldValue.serverTimestamp(),
    }).catch((err) => console.warn("could not persist quote for", requestId, err.message));

    // Drivers already reached, so the availability pass never double-notifies.
    const notifiedDriverIds = new Set();
    // Drivers this passenger already passed on (swiped left) — don't re-notify.
    const rejectedDrivers = new Set(
      Array.isArray(reqData.rejectedDrivers) ? reqData.rejectedDrivers : [],
    );

    const pushToDriver = async (driverId, driverDest, driverDestCoords, seatsAvailable) => {
      if (driverId === req.uid || notifiedDriverIds.has(driverId) || rejectedDrivers.has(driverId)) return false;
      const { token, lang, tokenEnv } = await getUserPushInfo(driverId, db);
      if (!token) return false;
      if (!pushEnvMatches(tokenEnv, db)) return false;
      // Claim the driver before awaiting so concurrent passes can't double-send.
      // A failed send still counts as claimed — retrying the same dead token
      // inside one dispatch would just fail again.
      notifiedDriverIds.add(driverId);
      const isFr = lang === "fr";
      return sendPushNotification(
        token,
        isFr
          ? `🚗 ${passengerName} cherche un lift — +${formatFrCA(earningsCents)}`
          : `🚗 ${passengerName} wants a lift — +${formatFrCA(earningsCents)}`,
        driverMotivationalBody(earningsCents, requestId, lang),
        {
          type: "passenger_request",
          requestId,
          riderId: reqData.passengerId,
          // Coarse only. acceptRideScreen re-reads the request document for the
          // precise labels, so they reach a driver who opens the ride rather than
          // every device the broadcast touched.
          origin: originLabel,
          destination: destLabel,
          fare: String(earningsCents),
          rideKm: String(Math.round(rideKm * 10) / 10),
          seats: String(seatsAvailable),
          ...(driverDest ? { driverDest } : {}),
          ...(driverDestCoords
            ? { driverDestLat: String(driverDestCoords.lat), driverDestLng: String(driverDestCoords.lng) }
            : {}),
        },
        `📍 ${originLabel} → ${destLabel}`,
      );
    };

    // Only the broadcast branch below uses this; the proximity path keeps its
    // own counters inside dispatchByProximity.
    let notified = 0;

    // ── TEMPORARY broadcast dispatch ─────────────────────────────────────────
    // Notify every user with driver mode ON, ignoring proximity / windows /
    // destination. Absent driverModeEnabled is treated as ON so existing users
    // stay reachable without a migration. (Full-collection scan — intentionally
    // simple and non-scalable; the legacy matching below is kept for later.)
    //
    // Scoped by isEligibleRecipient: dev requests reach only accounts whose push
    // token was registered by a recent dev build, and prod requests reach prod
    // accounts under a blast-radius cap. See that function for why the database
    // split alone does not prevent a dev test from paging real users.
    if (!USE_LEGACY_MATCHING) {
      const { limit, denyReason } = await getBroadcastLimit(db);
      if (denyReason) {
        console.warn("/requests/dispatch broadcast blocked:", denyReason);
        return res.json({ notified: 0, directionMatches: 0, blocked: denyReason });
      }
      const usersSnap = await db.collection("users").get();
      const now = Date.now();
      const recipients = usersSnap.docs
        .filter((doc) => doc.id !== req.uid)
        .filter((doc) => isEligibleRecipient(doc.data(), db, now).ok)
        .slice(0, limit);
      await Promise.all(
        recipients.map(async (doc) => {
          if (await pushToDriver(doc.id, "", null, 4)) notified += 1;
        }),
      );
      return res.json({
        notified,
        directionMatches: notified,
        eligible: recipients.length,
        scanned: usersSnap.size,
      });
    }

    return dispatchByProximity({ db, req, res, pickup, dropoff, seatsNeeded, pushToDriver, notifiedDriverIds });
  } catch (err) {
    console.error("requests/dispatch error:", err);
    return res.status(500).json({ error: "internal" });
  }
});

// POST /drivers/available — count drivers a passenger could currently reach for
// a given trip, WITHOUT notifying anyone. Mirrors the /requests/dispatch
// matching (online live drives + active Ride Mode windows, deduped by driver)
// so the "drivers available" stat the client polls stays consistent with who
// would actually be pushed. Body: { originLat, originLng, destLat, destLng, seats? }.
app.post("/drivers/available", authenticate, async (req, res) => {
  const db = getDb(req);
  try {
    const num = (v) => (v == null || v === "" || isNaN(Number(v)) ? null : Number(v));
    const destLat = num(req.body.destLat);
    const destLng = num(req.body.destLng);
    if (destLat == null || destLng == null) {
      return res.status(400).json({ error: "destLat and destLng are required" });
    }
    const dropoff = { lat: destLat, lng: destLng };
    // Fall back to the dropoff as the pickup if the client has no GPS fix yet —
    // the detour term is then ~0 and we rely on destination proximity.
    const oLat = num(req.body.originLat);
    const oLng = num(req.body.originLng);
    const hasPickup = oLat != null && oLng != null;
    const pickup = hasPickup ? { lat: oLat, lng: oLng } : dropoff;
    const seatsNeeded = Number(req.body.seats) || 1;

    // TEMPORARY: while broadcast dispatch is active, the reachable count is every
    // eligible recipient minus the requester. It shares isEligibleRecipient with
    // /requests/dispatch on purpose, so the number the passenger sees is exactly
    // the number of drivers that dispatch would actually reach — counting users
    // who cannot be pushed (no token, wrong environment, stale dev token) would
    // inflate the stat.
    // `rejectedDrivers` is the one dispatch filter we can't apply here: it lives
    // on the rideRequests doc, which doesn't exist yet when this stat is polled.
    if (!USE_LEGACY_MATCHING) {
      // Cached (60s) — see getEligibleRecipientIds. The requester is never
      // notified of their own request, so they are excluded from the count.
      const eligible = await getEligibleRecipientIds(db);
      let enabled = eligible.size - (eligible.has(req.uid) ? 1 : 0);
      // The blast-radius rails dispatch applies must be applied here too, or the
      // promise above ("exactly the number of drivers that dispatch would reach")
      // is false in the one case that matters: with config/broadcast.prodEnabled
      // set to false, dispatch pushes to nobody while this route still reported a
      // healthy count — so "N drivers available" then silence looked like drivers
      // ignoring the request rather than a kill switch being on.
      const { limit, denyReason } = await getBroadcastLimit(db);
      if (denyReason) enabled = 0;
      else if (Number.isFinite(limit)) enabled = Math.min(enabled, limit);
      return res.json({ count: enabled, directionCount: enabled, reachableCount: enabled });
    }

    return countReachableByProximity({ db, req, res, pickup, dropoff, hasPickup, seatsNeeded });
  } catch (err) {
    console.error("drivers/available error:", err);
    return res.status(500).json({ error: "internal" });
  }
});

// POST /admin/dispatch-report — who would /requests/dispatch notify, right now,
// in THIS server's environment, and why is everyone else skipped. Read-only; it
// sends no pushes and writes nothing.
//
// The sandbox has /dev/dispatch-report for the same question, but that route is
// hard-pinned to uniliftdev, so on a production build there was no way to answer
// "did anybody actually get the broadcast?" — a dead push token, a
// `config/broadcast` kill switch and "no drivers online" all look identical from
// the app. Two deliberate differences from the dev version:
//
//   • Gated on the `admin` custom claim (scripts/set-admin-claims.js), not on
//     the environment. Production user counts are not something any signed-in
//     account may enumerate.
//   • AGGREGATE ONLY. The dev report lists every account by name and uid, which
//     is fine for a ten-row dev database and a privacy incident against the real
//     one. This returns counts plus the caller's own row.
//
// It reuses isEligibleRecipient and getBroadcastLimit rather than restating the
// rule, so the report cannot drift from what dispatch actually does.
app.post("/admin/dispatch-report", authenticate, async (req, res) => {
  const db = getDb(req);
  try {
    const caller = await admin.auth().getUser(req.uid);
    if (!caller.customClaims || caller.customClaims.admin !== true) {
      return res.status(403).json({ error: "admin_only" });
    }

    const { limit, denyReason } = await getBroadcastLimit(db);
    const usersSnap = await db.collection("users").get();
    const now = Date.now();

    // Bucketed by the verbatim reason string isEligibleRecipient returns, so a
    // new skip reason shows up here without this route being touched. The
    // strings are static text — they carry no user data.
    const skipped = {};
    let wouldNotify = 0;
    let me = null;

    usersSnap.docs.forEach((doc) => {
      const u = doc.data() || {};
      const eligible = isEligibleRecipient(u, db, now);
      if (doc.id === req.uid) {
        const age = tokenAgeMs(u, now);
        me = {
          // "would MY phone buzz when SOMEONE ELSE requests a ride" — the
          // self-exclusion in dispatch is deliberately not applied here, since
          // it would mask the answer being debugged.
          wouldReceive: eligible.ok,
          blockedBy: eligible.reason,
          driverModeEnabled: u.driverModeEnabled !== false,
          hasPushToken: Boolean(u.expoPushToken),
          tokenEnv: typeof u.expoPushTokenEnv === "string" ? u.expoPushTokenEnv : null,
          tokenAgeDays: age === null ? null : Math.floor(age / 86400000),
        };
      }
      if (eligible.ok) {
        wouldNotify += 1;
      } else {
        skipped[eligible.reason] = (skipped[eligible.reason] || 0) + 1;
      }
    });

    // What one dispatch would actually reach: eligible users, minus the
    // requester, clamped by the config/broadcast cap.
    const reachable = Math.max(wouldNotify - (me && me.wouldReceive ? 1 : 0), 0);
    return res.json({
      environment: envLabel(db),
      database: db === devDb ? "uniliftdev" : "uniliftdefault",
      matching: USE_LEGACY_MATCHING ? "proximity" : "broadcast",
      devTokenMaxAgeDays: DEV_TOKEN_MAX_AGE_DAYS,
      broadcast: {
        maxRecipients: Number.isFinite(limit) ? limit : null,
        // Non-null means config/broadcast.prodEnabled is false: dispatch returns
        // { notified: 0 } and nobody is pushed, while /drivers/available still
        // reports a healthy driver count. That gap is the whole reason to look.
        blocked: denyReason,
      },
      totals: {
        users: usersSnap.size,
        eligible: wouldNotify,
        wouldNotifyOnOneDispatch: denyReason
          ? 0
          : Math.min(reachable, Number.isFinite(limit) ? limit : reachable),
      },
      skipped,
      me,
    });
  } catch (err) {
    console.error("admin/dispatch-report error:", err);
    return res.status(500).json({ error: "internal" });
  }
});

// POST /admin/connect-probe — can this server, with the Stripe credential it is
// actually holding, do Connect at all? Read-only: it creates no account, no link
// and no charge.
//
// The Stripe dashboard answers this for the account you logged into. It cannot
// tell you which key `functions/.env` really carries — and a stale, revoked or
// accidentally test-mode STRIPE_SECRET_KEY_LIVE fails exactly the way "Connect
// not enabled" does. Three questions, one answer each, all from the server's own
// credential:
//   • platform — is the platform account itself complete and capable
//   • connect  — is this key a Connect platform at all
//   • balance  — live or test key (`livemode`), and does a CAD balance exist,
//                which the payout sweeper needs
//
// Every failure runs through classifyStripeError, so the probe and the real
// /connect/* routes can never disagree about a diagnosis.
app.post("/admin/connect-probe", authenticate, async (req, res) => {
  const db = getDb(req);
  const stripe = getStripe(req);
  try {
    if (!(await callerIsAdmin(req.uid))) {
      return res.status(403).json({ error: "admin_only" });
    }

    // One failing question must not hide the other two — that is the whole point
    // of asking three — so each is caught on its own.
    const probe = async (step, fn) => {
      try {
        return { ok: true, ...(await fn()) };
      } catch (err) {
        const { code, detail, message } = classifyStripeError(err, step);
        console.error("/admin/connect-probe error:", JSON.stringify({ ...detail, error: code, message }));
        return { ok: false, error: code, detail, message: message.slice(0, 300) };
      }
    };

    const platform = await probe("platform", async () => {
      // No id argument → the account the key belongs to.
      const acct = await stripe.accounts.retrieve();
      return {
        id: acct.id,
        country: acct.country ?? null,
        chargesEnabled: acct.charges_enabled === true,
        payoutsEnabled: acct.payouts_enabled === true,
        detailsSubmitted: acct.details_submitted === true,
        capabilities: acct.capabilities ?? null,
      };
    });

    const connect = await probe("connect", async () => {
      // The cheapest question only a real Connect platform can answer.
      const list = await stripe.accounts.list({ limit: 1 });
      return { enabled: true, connectedAccountsSampled: list.data.length };
    });

    const balance = await probe("balance", async () => {
      const bal = await stripe.balance.retrieve();
      const currencies = (bal.available || []).map((b) => b.currency);
      return {
        // Which key is loaded, answered by the credential rather than by the
        // config that is supposed to describe it.
        livemode: bal.livemode === true,
        currencies,
        hasCad: currencies.includes("cad"),
      };
    });

    return res.json({ environment: envLabel(db), platform, connect, balance });
  } catch (err) {
    console.error("/admin/connect-probe error:", err.message);
    return res.status(500).json({ error: "internal" });
  }
});

// POST /requests/accept — a driver claims a passenger request. Atomic
// first-wins: only succeeds if the request is still "open". Creates the ride
// with the passenger pre-enrolled, then notifies the passenger.
// How long the passenger has to swipe-confirm a driver after acceptance before
// the match auto-expires (sweepStaleRides). Keep in sync with the client countdown.
const CONFIRM_WINDOW_MS = 2 * 60 * 1000;

app.post("/requests/accept", authenticate, async (req, res) => {
  const db = getDb(req);
  // Read before the transaction — Firestore transactions cannot do external reads.
  const acceptPricing = await getPricing(db);
  const env = req.headers["x-app-env"] === "dev" ? "dev" : "prod";
  // Debug traces only for dev traffic; production stays quiet (errors still log below).
  const dbg = (...a) => { if (env === "dev") console.log(...a); };
  dbg("[ACCEPT-DEBUG] /requests/accept", { env, requestId: req.body.requestId, driverId: req.uid });
  try {
    const { requestId } = req.body;
    if (!requestId) return res.status(400).json({ error: "requestId is required" });
    const driverId = req.uid;

    // Optional fallback params for a Ride Mode (Flow A) accept where the driver
    // has no live session: the client supplies live GPS origin + the matched
    // window's destination. GeoPoint is imported at module scope (top of file).
    const num = (v) => (v == null || v === "" || isNaN(Number(v)) ? null : Number(v));
    const bodyOriginLat = num(req.body.originLat);
    const bodyOriginLng = num(req.body.originLng);
    const bodyDestLat = num(req.body.destinationLat);
    const bodyDestLng = num(req.body.destinationLng);
    const bodyDestination = typeof req.body.destination === "string" ? req.body.destination : "";
    const bodySeats = num(req.body.seats);

    const reqRef = db.collection("rideRequests").doc(requestId);
    const sessionRef = db.collection("driverSessions").doc(driverId);
    const rideRef = db.collection("rides").doc();

    const result = await db.runTransaction(async (tx) => {
      const reqSnap = await tx.get(reqRef);
      if (!reqSnap.exists) {
        dbg("[ACCEPT-DEBUG] request not found in", env, "db:", requestId);
        return { error: 404, reason: "request_not_found" };
      }
      const reqData = reqSnap.data();
      if (reqData.status !== "open") {
        dbg("[ACCEPT-DEBUG] request not open, status:", reqData.status);
        return { error: 409, reason: "request_not_open" }; // another driver won
      }

      const seatsNeeded = Number(reqData.seatsRequested) || 1;
      const passengerId = reqData.passengerId;

      // The authoritative credit gate: this is where the ride — and therefore
      // the future charge — comes into existence. A request could have been
      // dispatched before the passenger crossed the ceiling, or created without
      // going through dispatch at all.
      const paxSnap = await tx.get(db.collection("users").doc(passengerId));
      const paxRefusal = chargeEligibility(paxSnap.data(), acceptPricing);
      if (paxRefusal) {
        return { error: 402, reason: paxRefusal.error };
      }
      const pickup = reqData.origin;                 // GeoPoint
      const dropoff = reqData.destinationCoords;      // GeoPoint

      // Guard: a request must carry a valid pickup so the driver map can plot it.
      // Without this a missing/undefined origin would write an unusable entry the
      // client filters out, leaving the driver with no passenger marker.
      if (!(pickup instanceof GeoPoint)) {
        console.warn("requests/accept: request missing valid origin GeoPoint", requestId);
        return { error: 400, reason: "request_missing_origin" };
      }

      // Prefer a live online session (Flow B). Fall back to client-supplied
      // params (Flow A — Ride Mode push, possibly offline).
      const sessSnap = await tx.get(sessionRef);
      const hasSession = sessSnap.exists && sessSnap.data().status === "online";
      const s = hasSession ? sessSnap.data() : null;

      let driverOrigin;
      let driverDestCoords;
      let driverDestLabel;
      let capacity;
      let routeExtras = {};

      if (hasSession) {
        capacity = Number(s.seatsAvailable) || 0;
        if (capacity < seatsNeeded) return { error: 422, reason: "not_enough_seats" };
        driverOrigin = s.origin;
        driverDestCoords = s.destinationCoords;
        driverDestLabel = s.destination || bodyDestination || "";
        routeExtras = {
          driverName: s.driverName || "",
          driverAvatar: s.driverAvatar || "",
          maxDetourKm: Number(s.maxDetourKm) || 10,
          ...(s.baseRouteKm != null ? { baseRouteKm: s.baseRouteKm } : {}),
          ...(s.routePolyline ? { routePolyline: s.routePolyline } : {}),
        };
      } else {
        // No live session (Flow A — reached by push). The GPS origin is still
        // required: without it there is no pickup route to plot.
        if (bodyOriginLat == null || bodyOriginLng == null) {
          return { error: 400, reason: "missing_driver_origin" };
        }
        // The destination is OPTIONAL. Under broadcast dispatch the driver is
        // notified regardless of where they are heading, so the notification
        // carries no driverDest* keys and the client has none to send — requiring
        // one here made every accept from a broadcast push fail. Falling back to
        // the passenger's dropoff is the correct semantic: the driver is agreeing
        // to take *this* passenger where the passenger is going, which is exactly
        // what the accept screen showed them before they tapped Accept.
        const hasBodyDest = bodyDestLat != null && bodyDestLng != null;
        if (!hasBodyDest && !(dropoff instanceof GeoPoint)) {
          return { error: 400, reason: "missing_destination" };
        }
        // Clamp: `seats` is driver-supplied and unvalidated, and it decides how
        // many more passengers this ride will accept.
        capacity = bodySeats != null ? Math.min(Math.max(Math.floor(bodySeats), 1), MAX_VEHICLE_SEATS) : 4;
        if (capacity < seatsNeeded) return { error: 422, reason: "not_enough_seats" };
        driverOrigin = new GeoPoint(bodyOriginLat, bodyOriginLng);
        driverDestCoords = hasBodyDest ? new GeoPoint(bodyDestLat, bodyDestLng) : dropoff;
        driverDestLabel = bodyDestination || reqData.destination || "";
        const driverSnap = await tx.get(db.collection("users").doc(driverId));
        const du = driverSnap.exists ? driverSnap.data() : {};
        routeExtras = {
          driverName: du.name || (du.email ? String(du.email).split("@")[0] : ""),
          driverAvatar: du.avatar || "",
          maxDetourKm: Number(du.driverMaxDetourKm) || 10,
        };
      }

      const remaining = Math.max(0, capacity - seatsNeeded);

      tx.set(rideRef, {
        driverId,
        driverName: routeExtras.driverName || "",
        driverAvatar: routeExtras.driverAvatar || "",
        localisation: driverOrigin,                   // driver origin GeoPoint
        destination: driverDestLabel,
        destinationCoords: driverDestCoords,          // GeoPoint
        date: Timestamp.now(),
        seatsAvailable: remaining,
        passengers: [passengerId],
        passengerSeats: { [passengerId]: seatsNeeded },
        passengerPickups: { [passengerId]: pickup },
        // Never leave this empty: it is the reference point for the dropoff
        // radius check, and a missing entry used to fall back to the pickup.
        passengerDropoffs: { [passengerId]: dropoff instanceof GeoPoint ? dropoff : driverDestCoords },
        // The fare this passenger was quoted at dispatch. /rides/finish clamps
        // the final charge to it, so a driver cannot inflate the bill by naming a
        // distant destination on accept.
        ...(Number.isFinite(Number(reqData.quotedFareCents))
          ? { quotedFareCents: { [passengerId]: Number(reqData.quotedFareCents) } }
          : {}),
        joinRequests: {},
        status: "planned",
        started: false,
        // Mutual match: the passenger must swipe to confirm this driver before
        // the ride can start. Seeded with the dispatched passenger; the deadline
        // lets sweepStaleRides auto-expire an unconfirmed match. requestId lets
        // reject/expire re-open the originating search.
        pendingConfirmation: [passengerId],
        confirmDeadlineAt: Timestamp.fromMillis(Date.now() + CONFIRM_WINDOW_MS),
        requestId,
        maxDetourKm: routeExtras.maxDetourKm || 10,
        ...(routeExtras.baseRouteKm != null ? { baseRouteKm: routeExtras.baseRouteKm } : {}),
        ...(routeExtras.routePolyline ? { routePolyline: routeExtras.routePolyline } : {}),
        createdAt: FieldValue.serverTimestamp(),
      });

      tx.update(reqRef, {
        status: "matched",
        matchedRideId: rideRef.id,
        matchedDriverId: driverId,
        matchedAt: FieldValue.serverTimestamp(),
      });

      // Decrement the live session's seats (if any); auto-offline when full.
      if (hasSession) {
        tx.update(sessionRef, {
          seatsAvailable: remaining,
          ...(remaining === 0 ? { status: "offline" } : {}),
          updatedAt: FieldValue.serverTimestamp(),
        });
      }

      return {
        rideId: rideRef.id,
        passengerId,
        originLat: driverOrigin.latitude,
        originLng: driverOrigin.longitude,
        destination: driverDestLabel,
        destinationLat: driverDestCoords.latitude,
        destinationLng: driverDestCoords.longitude,
        maxSeat: capacity,
        // Passenger's own pickup/dropoff — used to render the ride map correctly
        // when the passenger opens the app from the "driver accepted" push.
        passengerOriginLat: pickup.latitude,
        passengerOriginLng: pickup.longitude,
        passengerDestLat: dropoff instanceof GeoPoint ? dropoff.latitude : null,
        passengerDestLng: dropoff instanceof GeoPoint ? dropoff.longitude : null,
      };
    });

    // `reason` is machine-readable and names the exact branch that refused. Every
    // one of these used to surface as the same opaque message on the client, which
    // made "impossible to accept" impossible to diagnose without server logs.
    if (result.error === 404) {
      return res.status(404).json({ error: "request not found", reason: result.reason });
    }
    if (result.error === 409) {
      return res.status(409).json({ error: "already taken", reason: result.reason });
    }
    if (result.error === 400) {
      return res.status(400).json({ error: "driver origin/destination required", reason: result.reason });
    }
    if (result.error === 422) {
      return res.status(422).json({ error: "not enough seats", reason: result.reason });
    }
    if (result.error === 402) {
      // The passenger cannot take on another charge. Told plainly so the driver
      // knows this is not their problem and not a transient failure.
      return res.status(402).json({ error: "passenger_cannot_be_charged", reason: result.reason });
    }

    // Notify the passenger a driver accepted — they must open the app and swipe
    // to confirm the driver (mutual match) before the ride can start.
    try {
      const { token: pToken, lang: pLang } = await getUserPushInfo(result.passengerId, db);
      if (pToken) {
        const isFr = pLang === "fr";
        await sendPushNotification(
          pToken,
          isFr ? "Un chauffeur t'a accepté ! 🎉" : "A driver accepted you! 🎉",
          isFr
            ? "Ouvre l'app et confirme ton chauffeur pour verrouiller ton trajet."
            : "Open the app and confirm your driver to lock in your ride.",
          {
            type: "driver_accepted",
            rideId: result.rideId,
            requestId: requestId || "",
            oLat: result.passengerOriginLat != null ? String(result.passengerOriginLat) : "",
            oLng: result.passengerOriginLng != null ? String(result.passengerOriginLng) : "",
            dLat: result.passengerDestLat != null ? String(result.passengerDestLat) : "",
            dLng: result.passengerDestLng != null ? String(result.passengerDestLng) : "",
          },
        );
      }
    } catch (e) {
      console.warn("requests/accept: passenger push failed", e.message);
    }

    return res.json(result);
  } catch (err) {
    console.error("requests/accept error:", err && err.stack ? err.stack : err);
    return res.status(500).json({ error: "internal" });
  }
});

// ── Ride lifecycle (server-authoritative) ────────────────────────────────────
//
// These endpoints own every ride state transition. Once the tightened Firestore
// rules ship (firestore.dev.rules → prod at cutover), clients can no longer PATCH
// `rides/*` directly — they only read the ride doc and call these functions. Each
// runs in a transaction, verifies the caller's role from the ride doc itself, and
// derives money/state server-side (never from client-supplied values).

const RIDE_LIVE_WINDOW_MS = 3 * 60 * 60 * 1000; // mirrors utils/ride-lifecycle.ts

/** Max distance (km) between the driver at dropoff and the passenger's
 *  destination for the leg to be billable. Mirrored in constants/ride-geo.ts and
 *  in functions-sandbox/index.js — change all three together. */
const DROPOFF_CONFIRM_RADIUS_KM = 3;

/** Boarding nonce location. A subcollection doc rather than a field on the ride,
 *  because `rides/{id}` is world-readable to signed-in users and this value is a
 *  bearer credential. `read, write: if false` in the rules; the admin SDK bypasses
 *  that. */
const rideQrRef = (db, rideId) =>
  db.collection("rides").doc(rideId).collection("private").doc("qr");

/** Read a stored GeoPoint-ish value ({latitude,longitude}) into {lat,lng}. */
const gpLL = (g) => (g && g.latitude != null && g.longitude != null
  ? { lat: g.latitude, lng: g.longitude }
  : null);

/** Reference point for the dropoff radius check: the passenger's own dropoff,
 *  else the ride's destination.
 *
 *  NEVER the pickup. Falling back to the pickup (as this used to) meant that
 *  dropping a passenger where you collected them scored as an in-range delivery
 *  and billed them — the driver got paid for going nowhere. Falling back to
 *  destinationCoords also keeps this consistent with /rides/finish, which prices
 *  the leg as pickup → destinationCoords. */
function dropoffReference(ride, passengerId) {
  return gpLL((ride.passengerDropoffs || {})[passengerId]) || gpLL(ride.destinationCoords);
}

/** Single source of truth for "is this leg billable".
 *
 *  `driverLat/Lng` is the fix the driver's device took at the moment they tapped
 *  Drop off. `ride.driverLocation` is only a fallback for app builds that predate
 *  that parameter — it is throttled telemetry that can be minutes stale, and a
 *  stationary driver stops emitting it entirely.
 *
 *  Returns { ok, distanceKm, reason }. Fails closed: anything we can't measure
 *  is not billable. */
/** How far the driver's self-reported dropoff fix may sit from the last position
 *  their app actually reported before we stop believing it. Generous, because
 *  `driverLocation` is throttled telemetry that can be minutes stale — this is
 *  meant to catch a fabricated coordinate, not ordinary lag. */
const DROPOFF_TELEMETRY_TOLERANCE_KM = 10;

function evaluateDropoff(ride, passengerId, driverLat, driverLng) {
  let lat = Number(driverLat);
  let lng = Number(driverLng);
  const stored = gpLL(ride.driverLocation);
  let source = "reported";
  let disputed = false;

  if (!Number.isFinite(lat) || !Number.isFinite(lng)) {
    // Legacy client fallback — remove once app adoption is complete.
    if (!stored) return { ok: false, distanceKm: null, reason: "no_driver_location" };
    lat = stored.lat;
    lng = stored.lng;
    source = "telemetry";
  } else if (stored) {
    // `driverLat/Lng` is whatever the driver's client says. A driver who wants to
    // bill a passenger they dropped nowhere near the destination need only send
    // the destination's own coordinates. Cross-check it against the position
    // their app was reporting during the ride: if the two are implausibly far
    // apart, trust the telemetry and flag the leg.
    const drift = haversineKm(lat, lng, stored.lat, stored.lng);
    if (drift > DROPOFF_TELEMETRY_TOLERANCE_KM) {
      disputed = true;
      source = "telemetry";
      lat = stored.lat;
      lng = stored.lng;
    }
  }

  const ref = dropoffReference(ride, passengerId);
  if (!ref) return { ok: false, distanceKm: null, reason: "no_destination" };
  const distanceKm = haversineKm(lat, lng, ref.lat, ref.lng);
  const ok = distanceKm <= DROPOFF_CONFIRM_RADIUS_KM;
  return {
    ok,
    distanceKm,
    driverLat: lat,
    driverLng: lng,
    source,
    disputed,
    reason: ok ? null : "out_of_range",
  };
}

/** Give a driver back the seats a torn-down match had taken from their live
 *  session.
 *
 *  `/requests/accept` decrements `driverSessions/{driverId}.seatsAvailable` and
 *  auto-goes offline at zero. NOTHING used to give them back — not a passenger
 *  rejecting the driver, not a passenger leaving, not the driver cancelling, not
 *  the sweep expiring an unconfirmed match. So every abandoned match permanently
 *  cost a driver a seat, and after a few they silently went offline and stopped
 *  receiving requests with no way to tell why.
 *
 *  Best-effort and idempotent-ish: a driver with no live session has nothing to
 *  restore, and a failure here must never fail the teardown that called it. */
async function releaseSessionSeats(db, driverId, seats) {
  const freed = Number(seats) || 0;
  if (!driverId || freed <= 0) return;
  try {
    const ref = db.collection("driverSessions").doc(driverId);
    await db.runTransaction(async (t) => {
      const snap = await t.get(ref);
      if (!snap.exists) return;
      const cur = snap.data() || {};
      const next = (Number(cur.seatsAvailable) || 0) + freed;
      t.update(ref, {
        seatsAvailable: next,
        // Seats coming back means the driver can take someone again, so a session
        // that auto-went offline at zero is put back online.
        ...(cur.status === "offline" && next > 0 ? { status: "online" } : {}),
        updatedAt: FieldValue.serverTimestamp(),
      });
    });
  } catch (err) {
    console.warn("releaseSessionSeats failed for", driverId, err.message);
  }
}

async function pushTo(uid, db, titleFr, titleEn, bodyFr, bodyEn, data = {}) {
  try {
    const { token, lang } = await getUserPushInfo(uid, db);
    if (!token) return;
    const fr = lang === "fr";
    await sendPushNotification(token, fr ? titleFr : titleEn, fr ? bodyFr : bodyEn, data);
  } catch (e) {
    console.warn("pushTo failed", uid, e && e.message);
  }
}

// POST /rides/start — driver starts a planned ride (locks it, blocks new joins).
app.post("/rides/start", authenticate, async (req, res) => {
  const db = getDb(req);
  const { rideId } = req.body || {};
  if (!rideId) return res.status(400).json({ error: "rideId is required" });
  const rideRef = db.collection("rides").doc(rideId);
  try {
    const out = await db.runTransaction(async (tx) => {
      const snap = await tx.get(rideRef);
      if (!snap.exists) return { error: 404 };
      const ride = snap.data();
      if (ride.driverId !== req.uid) return { error: 403 };
      if (ride.status === "started") return { ok: true, already: true };
      if (ride.status !== "planned") return { error: 409, status: ride.status };
      if (!Array.isArray(ride.passengers) || ride.passengers.length === 0) {
        return { error: 422 };
      }
      // Mutual-match gate: every passenger who was dispatched must have swiped
      // to confirm this driver. Passengers who joined via the planned-ride flow
      // are never in pendingConfirmation, so they don't block start.
      if (Array.isArray(ride.pendingConfirmation) && ride.pendingConfirmation.length > 0) {
        return { error: 428 };
      }
      tx.update(rideRef, {
        status: "started",
        started: true,
        startedAt: FieldValue.serverTimestamp(),
      });
      return { ok: true };
    });
    if (out.error === 404) return res.status(404).json({ error: "ride not found" });
    if (out.error === 403) return res.status(403).json({ error: "not the ride driver" });
    if (out.error === 409) return res.status(409).json({ error: "ride not startable", status: out.status });
    if (out.error === 422) return res.status(422).json({ error: "no accepted passengers" });
    if (out.error === 428) return res.status(428).json({ error: "passengers not confirmed" });
    return res.json({ success: true });
  } catch (err) {
    console.error("/rides/start error:", err);
    return res.status(500).json({ error: "internal" });
  }
});

// POST /rides/qr — driver mints a fresh boarding nonce (10 min). The QR payload
// is returned base64-encoded; the passenger scans it and calls /rides/board.
app.post("/rides/qr", authenticate, async (req, res) => {
  const db = getDb(req);
  const { rideId } = req.body || {};
  if (!rideId) return res.status(400).json({ error: "rideId is required" });
  try {
    const rideRef = db.collection("rides").doc(rideId);
    const snap = await rideRef.get();
    if (!snap.exists) return res.status(404).json({ error: "ride not found" });
    const ride = snap.data();
    if (ride.driverId !== req.uid) return res.status(403).json({ error: "not the ride driver" });
    if (ride.status !== "planned" && ride.status !== "started") {
      return res.status(409).json({ error: "ride not active" });
    }
    const nonce = require("crypto").randomBytes(16).toString("hex");
    const issuedAt = Date.now();
    const expiresAt = issuedAt + 10 * 60 * 1000;
    // The nonce lives in a server-only subcollection, NOT on the ride doc.
    // `rides/{id}` is readable by any signed-in user, so a nonce stored there was
    // not a secret at all: a passenger could read it straight out of Firestore
    // and board without ever scanning the driver's screen — which is the entire
    // thing boarding is supposed to prove.
    await rideQrRef(db, rideId).set({
      nonce,
      expiresAt: new Date(expiresAt).toISOString(),
      issuedAt: new Date(issuedAt).toISOString(),
      driverUid: req.uid,
    });
    const payload = Buffer
      .from(JSON.stringify({ rideId, driverUid: req.uid, issuedAt, expiresAt, nonce }))
      .toString("base64");
    return res.json({ payload, expiresAt });
  } catch (err) {
    console.error("/rides/qr error:", err);
    return res.status(500).json({ error: "internal" });
  }
});

// POST /rides/passenger-contact — the driver of an active ride reads ONE
// passenger's phone number.
//
// This exists because there is no way to do it with Firestore rules.
// `users/{uid}` is owner-only, and the public projection deliberately omits
// `phone`, so a driver cannot read it directly. Putting it on the ride document
// instead would be worse: `rides/{id}` is readable by every signed-in user, so
// that would publish every passenger's number to the whole app — the same
// mistake the boarding nonce was moved out of the ride doc to avoid.
//
// Four gates, and the last one is the feature:
//   · caller is this ride's driver
//   · the ride is still planned or started  (planned matters — the drive TO the
//     pickup is exactly when a driver needs to call, and it happens before the
//     ride starts)
//   · the subject is actually a passenger on it
//   · the subject has NOT been dropped off yet
//
// That last check is what makes "the driver can reach you until drop-off" a real
// boundary rather than a UI convention: afterwards this returns 400 and the
// client has nothing cached to fall back on.
//
// A passenger who never shared a number is not an error — 200 with a null phone,
// so the driver's card can say "no number shared" instead of showing a failure.
app.post("/rides/passenger-contact", authenticate, async (req, res) => {
  const db = getDb(req);
  const { rideId, passengerId } = req.body || {};
  if (!rideId || !passengerId) {
    return res.status(400).json({ error: "rideId and passengerId are required" });
  }
  try {
    const snap = await db.collection("rides").doc(rideId).get();
    if (!snap.exists) return res.status(404).json({ error: "ride not found" });
    const ride = snap.data();

    if (ride.driverId !== req.uid) {
      return res.status(403).json({ error: "not the ride driver" });
    }
    if (ride.status !== "planned" && ride.status !== "started") {
      return res.status(409).json({ error: "ride not active", reason: "ride_not_active" });
    }
    const passengers = Array.isArray(ride.passengers) ? ride.passengers : [];
    if (!passengers.includes(passengerId)) {
      return res.status(400).json({ error: "not_passenger" });
    }
    const dropped = Array.isArray(ride.droppedPassengers) ? ride.droppedPassengers : [];
    if (dropped.includes(passengerId)) {
      return res.status(400).json({ error: "already_dropped" });
    }

    const userSnap = await db.collection("users").doc(passengerId).get();
    const phone = userSnap.exists ? userSnap.data().phone : null;
    if (typeof phone !== "string" || !phone) {
      return res.json({ phone: null, reason: "not_shared" });
    }

    // Who read whose number, and under which ride. Free, and the only record
    // that exists if anyone ever has to answer that question.
    console.log("PASSENGER CONTACT READ", { rideId, driverUid: req.uid, passengerId });
    return res.json({ phone });
  } catch (err) {
    console.error("/rides/passenger-contact error:", err);
    return res.status(500).json({ error: "internal" });
  }
});

// POST /rides/board — passenger boards by presenting the driver's QR payload.
// All validation (nonce match, expiry, membership, no double-board) is atomic.
app.post("/rides/board", authenticate, async (req, res) => {
  const db = getDb(req);
  const { rideId, qrPayload } = req.body || {};
  if (!rideId || !qrPayload) return res.status(400).json({ error: "rideId and qrPayload are required" });

  let parsed;
  try {
    parsed = JSON.parse(Buffer.from(String(qrPayload), "base64").toString("utf8"));
  } catch {
    return res.status(400).json({ error: "invalid_qr" });
  }
  if (parsed.rideId !== rideId) return res.status(400).json({ error: "qr_ride_mismatch" });

  const rideRef = db.collection("rides").doc(rideId);
  try {
    const out = await db.runTransaction(async (tx) => {
      const [snap, qrSnap] = await Promise.all([tx.get(rideRef), tx.get(rideQrRef(db, rideId))]);
      if (!snap.exists) return { error: 404 };
      const ride = snap.data();
      if (ride.status !== "started") return { error: 409 };
      if (parsed.driverUid !== ride.driverId) return { error: "driver_mismatch" };
      // Falls back to the legacy on-doc fields for rides that were already in
      // flight when the nonce moved. Remove the fallback once none remain.
      const qr = qrSnap.exists ? qrSnap.data() : null;
      const nonce = qr ? qr.nonce : ride.qrToken;
      const expiresAt = qr ? qr.expiresAt : ride.qrTokenExpiresAt;
      if (!nonce || nonce !== parsed.nonce) return { error: "nonce" };
      const exp = Date.parse(expiresAt || "");
      if (!Number.isFinite(exp) || Date.now() > exp) return { error: "expired" };
      const passengers = Array.isArray(ride.passengers) ? ride.passengers : [];
      if (!passengers.includes(req.uid)) return { error: "not_passenger" };
      const boarded = Array.isArray(ride.boardedPassengers) ? ride.boardedPassengers : [];
      if (boarded.includes(req.uid)) return { ok: true, already: true };
      tx.update(rideRef, { boardedPassengers: FieldValue.arrayUnion(req.uid) });
      return { ok: true };
    });
    if (out.error === 404) return res.status(404).json({ error: "ride not found" });
    if (out.error === 409) return res.status(409).json({ error: "ride not started" });
    if (out.error) return res.status(403).json({ error: out.error });
    return res.json({ success: true });
  } catch (err) {
    console.error("/rides/board error:", err);
    return res.status(500).json({ error: "internal" });
  }
});

// POST /rides/confirm-driver — passenger swipes right to confirm the matched
// driver (mutual match). Removes them from pendingConfirmation so the driver's
// Start gate clears. Mirrors /rides/board minus the QR/nonce check.
app.post("/rides/confirm-driver", authenticate, async (req, res) => {
  const db = getDb(req);
  const { rideId } = req.body || {};
  if (!rideId) return res.status(400).json({ error: "rideId is required" });
  const rideRef = db.collection("rides").doc(rideId);
  try {
    const out = await db.runTransaction(async (tx) => {
      const snap = await tx.get(rideRef);
      if (!snap.exists) return { error: 404 };
      const ride = snap.data();
      if (ride.status !== "planned") return { error: 409 };
      const passengers = Array.isArray(ride.passengers) ? ride.passengers : [];
      if (!passengers.includes(req.uid)) return { error: "not_passenger" };
      tx.update(rideRef, {
        pendingConfirmation: FieldValue.arrayRemove(req.uid),
        confirmedPassengers: FieldValue.arrayUnion(req.uid),
      });
      return { ok: true };
    });
    if (out.error === 404) return res.status(404).json({ error: "ride not found" });
    if (out.error === 409) return res.status(409).json({ error: "ride not confirmable" });
    if (out.error) return res.status(403).json({ error: out.error });
    return res.json({ success: true });
  } catch (err) {
    console.error("/rides/confirm-driver error:", err);
    return res.status(500).json({ error: "internal" });
  }
});

// POST /rides/reject-driver — passenger swipes left to pass on the matched
// driver. Removes them from the ride (restores the seat), cancels the ride if it
// becomes empty, and re-opens the originating request so the search resumes.
app.post("/rides/reject-driver", authenticate, async (req, res) => {
  const db = getDb(req);
  const { rideId } = req.body || {};
  if (!rideId) return res.status(400).json({ error: "rideId is required" });
  const rideRef = db.collection("rides").doc(rideId);
  try {
    const out = await db.runTransaction(async (tx) => {
      const snap = await tx.get(rideRef);
      if (!snap.exists) return { error: 404 };
      const ride = snap.data();
      const pending = Array.isArray(ride.pendingConfirmation) ? ride.pendingConfirmation : [];
      if (!pending.includes(req.uid)) {
        // Already confirmed, already gone, or ride advanced — nothing to reject.
        return { error: 409 };
      }
      // Re-open the originating request (read inside the tx before any write).
      const reqRef = ride.requestId ? db.collection("rideRequests").doc(ride.requestId) : null;
      if (reqRef) await tx.get(reqRef);

      const seats = (ride.passengerSeats || {})[req.uid];
      const freed = Number(seats) || 1;
      const nextPassengers = (Array.isArray(ride.passengers) ? ride.passengers : []).filter(
        (id) => id !== req.uid,
      );
      const update = {
        passengers: nextPassengers,
        seatsAvailable: (Number(ride.seatsAvailable) || 0) + freed,
        pendingConfirmation: FieldValue.arrayRemove(req.uid),
        [`passengerSeats.${req.uid}`]: FieldValue.delete(),
        [`passengerPickups.${req.uid}`]: FieldValue.delete(),
        [`passengerDropoffs.${req.uid}`]: FieldValue.delete(),
      };
      if (nextPassengers.length === 0) update.status = "cancelled";
      tx.update(rideRef, update);

      if (reqRef) {
        tx.update(reqRef, {
          status: "open",
          matchedRideId: FieldValue.delete(),
          matchedDriverId: FieldValue.delete(),
          matchedAt: FieldValue.delete(),
          rejectedDrivers: FieldValue.arrayUnion(ride.driverId),
        });
      }
      return { ok: true, driverId: ride.driverId, freed };
    });
    if (out.error === 404) return res.status(404).json({ error: "ride not found" });
    if (out.error === 409) return res.status(409).json({ error: "nothing to reject" });
    await releaseSessionSeats(db, out.driverId, out.freed);
    return res.json({ success: true });
  } catch (err) {
    console.error("/rides/reject-driver error:", err);
    return res.status(500).json({ error: "internal" });
  }
});

// POST /rides/dropoff — driver drops a passenger (or marks a no-show).
// Normal dropoff requires the passenger to have boarded; no-show does not.
//
// Confirmation is derived server-side from `driverLat`/`driverLng` — the fix the
// driver's device took when they tapped Drop off — measured against the
// passenger's destination. The client cannot assert the outcome, and the measured
// distance is recorded on the ride doc so /rides/finish re-derives the charge set
// instead of trusting a boolean.
app.post("/rides/dropoff", authenticate, async (req, res) => {
  const db = getDb(req);
  const { rideId, passengerId, noShow, driverLat, driverLng } = req.body || {};
  if (!rideId || !passengerId) return res.status(400).json({ error: "rideId and passengerId are required" });
  const rideRef = db.collection("rides").doc(rideId);
  try {
    const out = await db.runTransaction(async (tx) => {
      const snap = await tx.get(rideRef);
      if (!snap.exists) return { error: 404 };
      const ride = snap.data();
      if (ride.driverId !== req.uid) return { error: 403 };
      if (ride.status !== "started") return { error: 409 };
      const passengers = Array.isArray(ride.passengers) ? ride.passengers : [];
      if (!passengers.includes(passengerId)) return { error: "not_passenger" };
      const boarded = Array.isArray(ride.boardedPassengers) ? ride.boardedPassengers : [];

      if (noShow) {
        // Never boarded → resolve without charging or rating.
        tx.update(rideRef, { droppedPassengers: FieldValue.arrayUnion(passengerId) });
        return { ok: true, noShow: true };
      }

      if (!boarded.includes(passengerId)) return { error: "not_boarded" };

      // This GATES charging — only confirmed dropoffs are billed at /rides/finish
      // (see chargeablePassengers). A passenger dropped too far from their
      // destination is resolved and rated, but never charged, and the driver
      // earns nothing for that leg.
      const ev = evaluateDropoff(ride, passengerId, driverLat, driverLng);

      const update = {
        droppedPassengers: FieldValue.arrayUnion(passengerId),
        pendingRatings: FieldValue.arrayUnion(passengerId),
        [`dropoffAt.${passengerId}`]: new Date().toISOString(),
      };
      if (ev.distanceKm != null) {
        // Recorded so the charge is re-derivable (and disputable) after the fact.
        update[`dropoffDistanceKm.${passengerId}`] = Math.round(ev.distanceKm * 100) / 100;
        update[`dropoffDriverLocation.${passengerId}`] = new GeoPoint(ev.driverLat, ev.driverLng);
      }
      if (ev.disputed) {
        // Kept on the ride so an overcharge dispute is answerable, and so the
        // pattern is visible if a driver does it repeatedly.
        update[`dropoffDisputed.${passengerId}`] = true;
        console.warn("dropoff fix contradicted telemetry", { rideId, passengerId });
      }
      if (ev.source) update[`dropoffSource.${passengerId}`] = ev.source;
      if (ev.ok) update.confirmedDropoffPassengers = FieldValue.arrayUnion(passengerId);
      tx.update(rideRef, update);
      return { ok: true, confirmed: ev.ok, distanceKm: ev.distanceKm, reason: ev.reason };
    });
    if (out.error === 404) return res.status(404).json({ error: "ride not found" });
    if (out.error === 403) return res.status(403).json({ error: "not the ride driver" });
    if (out.error === 409) return res.status(409).json({ error: "ride not started" });
    if (out.error) return res.status(400).json({ error: out.error });
    return res.json({
      success: true,
      confirmed: !!out.confirmed,
      noShow: !!out.noShow,
      distanceKm: out.distanceKm != null ? out.distanceKm : null,
      radiusKm: DROPOFF_CONFIRM_RADIUS_KM,
      reason: out.reason || null,
    });
  } catch (err) {
    console.error("/rides/dropoff error:", err);
    return res.status(500).json({ error: "internal" });
  }
});

/** Charge set = passengers who boarded AND were dropped off within
 *  DROPOFF_CONFIRM_RADIUS_KM of their destination. A passenger dropped too far
 *  from their destination stays in droppedPassengers but is NOT charged, and the
 *  driver earns nothing for that leg (earnings are derived from the passenger
 *  total in /rides/finish).
 *
 *  Prefers the distance recorded at dropoff time so the charge is re-derived from
 *  the measurement rather than trusting a stored boolean. The
 *  confirmedDropoffPassengers fallback covers only rides that were already in
 *  flight when this shipped — safe because the tightened Firestore rules make
 *  that array unwritable by clients. */
function chargeablePassengers(ride) {
  const boarded = new Set(Array.isArray(ride.boardedPassengers) ? ride.boardedPassengers : []);
  const confirmed = new Set(Array.isArray(ride.confirmedDropoffPassengers) ? ride.confirmedDropoffPassengers : []);
  const dropped = Array.isArray(ride.droppedPassengers) ? ride.droppedPassengers : [];
  const distances = ride.dropoffDistanceKm || {};
  return dropped.filter((id) => {
    if (!boarded.has(id)) return false;
    const d = Number(distances[id]);
    if (Number.isFinite(d)) return d <= DROPOFF_CONFIRM_RADIUS_KM;
    return confirmed.has(id);
  });
}

// POST /rides/finish — driver ends the ride. Atomically: charges each
// boarded∧dropped passenger for their booked leg (server-stored pickup→dest),
// credits the driver, sets status=completed + paymentStatus=completed. One
// transaction ⇒ no "processing" wedge, no split-write race, idempotent.
app.post("/rides/finish", authenticate, async (req, res) => {
  const db = getDb(req);
  const { rideId } = req.body || {};
  if (!rideId) return res.status(400).json({ error: "rideId is required" });
  const rideRef = db.collection("rides").doc(rideId);
  try {
    // Load pricing before the transaction (transactions must not do external reads).
    const pricing = await getPricing(db);
    const out = await db.runTransaction(async (tx) => {
      const snap = await tx.get(rideRef);
      if (!snap.exists) return { error: 404 };
      const ride = snap.data();
      if (ride.driverId !== req.uid) return { error: 403 };
      if (ride.paymentStatus === "completed") return { ok: true, skipped: true };

      const charge = chargeablePassengers(ride);

      // The fare is charged to the passenger and credited to the driver
      // unchanged — no ratio, no spread, no platform cut. `reserve` is the
      // future Connect payout float and is 0 today, so the two totals are
      // currently identical to the cent.
      let driverEarningsCents = 0;
      const now = new Date().toISOString();
      for (const pid of charge) {
        // The passenger's own pickup → their own dropoff, not the driver-supplied
        // ride destination. See the fare guardrails above.
        const distKm = legDistanceKm(ride, pid) ?? 0;
        const rawFare = calculatePassengerChargeCents(distKm, pricing);
        const quoted = (ride.quotedFareCents || {})[pid];
        const { fareCents, clampedBy } = clampFare(rawFare, quoted);
        if (clampedBy) {
          console.warn("ride fare clamped", { rideId, pid, rawFare, fareCents, clampedBy });
        }
        const reserveCents = payoutReserveCents(fareCents, pricing);
        const chargedCents = fareCents + reserveCents;
        driverEarningsCents += fareCents;
        const userRef = db.collection("users").doc(pid);
        // set+merge rather than update: a passenger who deleted their account
        // between dropoff and finish must not fail the whole ride for everyone
        // else on it.
        tx.set(userRef, { pendingChargeCents: FieldValue.increment(chargedCents) }, { merge: true });
        tx.set(userRef.collection("transactions").doc(), {
          type: "ride_charge",
          amount: chargedCents,
          fareCents,
          // Recorded even at 0 so the split is auditable rather than folded
          // invisibly into the fare.
          payoutReserveCents: reserveCents,
          // Recorded so an overcharge dispute is answerable from the ledger alone.
          ...(clampedBy ? { clampedBy, rawFareCents: rawFare } : {}),
          ...(Number.isFinite(Number(quoted)) ? { quotedFareCents: Number(quoted) } : {}),
          status: "completed",
          description: `Ride to ${ride.destination || "destination"}`,
          createdAt: now,
          rideId,
          distanceKm: Math.round(distKm * 10) / 10,
        });
      }

      if (driverEarningsCents > 0) {
        const driverRef = db.collection("users").doc(ride.driverId);
        tx.set(driverRef, { pendingEarningsCents: FieldValue.increment(driverEarningsCents) }, { merge: true });
        tx.set(driverRef.collection("transactions").doc(), {
          type: "ride_earning",
          amount: driverEarningsCents,
          status: "completed",
          description: `Earnings — ${charge.length} passenger(s) — ${ride.destination || ""}`,
          createdAt: now,
          rideId,
        });
      }

      tx.update(rideRef, { status: "completed", paymentStatus: "completed" });
      return { ok: true, charged: charge.length, driverEarningsCents };
    });
    if (out.error === 404) return res.status(404).json({ error: "ride not found" });
    if (out.error === 403) return res.status(403).json({ error: "not the ride driver" });
    return res.json({ success: true, skipped: !!out.skipped, chargedPassengers: out.charged || 0 });
  } catch (err) {
    console.error("/rides/finish error:", err);
    return res.status(500).json({ error: "internal" });
  }
});

// POST /rides/rate — passenger rates the driver once. Weighted average + XP are
// computed server-side in a transaction (race-free, unspoofable).
app.post("/rides/rate", authenticate, async (req, res) => {
  const db = getDb(req);
  const { rideId, stars } = req.body || {};
  const s = Number(stars);
  if (!rideId || !Number.isFinite(s) || s < 1 || s > 5) {
    return res.status(400).json({ error: "rideId and stars (1-5) are required" });
  }
  const rideRef = db.collection("rides").doc(rideId);
  try {
    const out = await db.runTransaction(async (tx) => {
      const snap = await tx.get(rideRef);
      if (!snap.exists) return { error: 404 };
      const ride = snap.data();
      const pending = Array.isArray(ride.pendingRatings) ? ride.pendingRatings : [];
      const submitted = Array.isArray(ride.ratingsSubmitted) ? ride.ratingsSubmitted : [];
      if (!pending.includes(req.uid)) return { error: 403 };
      if (submitted.includes(req.uid)) return { ok: true, already: true };
      const driverId = ride.driverId;

      const driverRef = db.collection("users").doc(driverId);
      const raterRef = db.collection("users").doc(req.uid);
      const [driverSnap, raterSnap] = await Promise.all([tx.get(driverRef), tx.get(raterRef)]);
      const d = driverSnap.exists ? driverSnap.data() : {};

      // Sum + count, not a running average. The old code did
      // `Math.round(((avg * weight) + s) / (weight + 1))` and fed the ROUNDED
      // value back in, so every driver's rating was an integer and drifted
      // upward with each rating. Keeping the two components makes the average
      // exact and lets the client round only for display.
      const legacyAvg = Number(d.ratings);
      const legacyWeight = Number(d.ratingWeigth);
      const hasCount = Number.isFinite(Number(d.ratingCount));
      const priorSum = hasCount
        ? (Number(d.ratingSum) || 0)
        : (Number.isFinite(legacyAvg) && Number.isFinite(legacyWeight) ? legacyAvg * legacyWeight : 0);
      const priorCount = hasCount
        ? (Number(d.ratingCount) || 0)
        : (Number.isFinite(legacyWeight) ? legacyWeight : 0);

      const nextSum = priorSum + s;
      const nextCount = priorCount + 1;
      const nextAvg = Math.round((nextSum / nextCount) * 100) / 100;

      tx.update(driverRef, {
        ratingSum: nextSum,
        ratingCount: nextCount,
        // `ratings`/`ratingWeigth` are still written so a client build that
        // predates this release keeps rendering something sane. Remove once the
        // old binary is off the floor.
        ratings: nextAvg,
        ratingWeigth: nextCount,
        xp: FieldValue.increment(s * 20),
        ridesCompleted: FieldValue.increment(1),
      });
      if (raterSnap.exists) {
        tx.update(raterRef, {
          xp: FieldValue.increment(Math.floor((s * 20) / 2)),
          ridesCompleted: FieldValue.increment(1),
        });
      }
      tx.update(rideRef, { ratingsSubmitted: FieldValue.arrayUnion(req.uid) });
      return { ok: true, driverId, raterId: raterSnap.exists ? req.uid : null };
    });
    if (out.error === 404) return res.status(404).json({ error: "ride not found" });
    if (out.error === 403) return res.status(403).json({ error: "not eligible to rate" });
    // The trigger mirrors these too; doing it inline as well means the rating a
    // passenger just gave is visible on the next screen rather than a tick later.
    await Promise.all([out.driverId, out.raterId].filter(Boolean).map(async (uid) => {
      const snap = await db.collection("users").doc(uid).get();
      if (snap.exists) await writePublicProfile(db, uid, snap.data());
    }));
    return res.json({ success: true });
  } catch (err) {
    console.error("/rides/rate error:", err);
    return res.status(500).json({ error: "internal" });
  }
});

// POST /rides/cancel — driver cancels a not-yet-completed ride and notifies
// every affected passenger (so they learn even when backgrounded).
app.post("/rides/cancel", authenticate, async (req, res) => {
  const db = getDb(req);
  const { rideId } = req.body || {};
  if (!rideId) return res.status(400).json({ error: "rideId is required" });
  const rideRef = db.collection("rides").doc(rideId);
  try {
    const out = await db.runTransaction(async (tx) => {
      const snap = await tx.get(rideRef);
      if (!snap.exists) return { error: 404 };
      const ride = snap.data();
      if (ride.driverId !== req.uid) return { error: 403 };
      if (ride.status === "completed") return { error: 409 };
      // Once someone has boarded, the legs are real and somebody is owed for
      // them. Cancelling used to clear `passengers` outright, so a driver could
      // deliver a car full of people and then erase the ride: nobody charged, and
      // the driver themselves earning nothing. Finish it instead.
      const boarded = Array.isArray(ride.boardedPassengers) ? ride.boardedPassengers : [];
      if (boarded.length > 0) return { error: 428 };
      const affected = Array.isArray(ride.passengers) ? ride.passengers.slice() : [];
      tx.update(rideRef, { status: "cancelled", passengers: [], joinRequests: {} });
      return { ok: true, affected, driverId: ride.driverId, seats: ride.passengerSeats || {} };
    });
    if (out.error === 404) return res.status(404).json({ error: "ride not found" });
    if (out.error === 403) return res.status(403).json({ error: "not the ride driver" });
    if (out.error === 409) return res.status(409).json({ error: "ride already completed" });
    if (out.error === 428) {
      return res.status(428).json({
        error: "passengers already boarded",
        reason: "boarded_passengers",
      });
    }
    await releaseSessionSeats(db, out.driverId, Object.values(out.seats || {}).reduce((a, v) => a + (Number(v) || 1), 0));
    await Promise.all((out.affected || []).map((pid) => pushTo(
      pid, db,
      "Trajet annulé", "Ride cancelled",
      "Ton chauffeur a annulé le trajet. Ouvre l'app pour trouver un autre lift.",
      "Your driver cancelled the ride. Open the app to find another lift.",
      { type: "ride_cancelled", rideId },
    )));
    return res.json({ success: true });
  } catch (err) {
    console.error("/rides/cancel error:", err);
    return res.status(500).json({ error: "internal" });
  }
});

// POST /rides/leave — passenger leaves a ride they were accepted into, before
// boarding. Restores the seat and notifies the driver.
app.post("/rides/leave", authenticate, async (req, res) => {
  const db = getDb(req);
  const { rideId } = req.body || {};
  if (!rideId) return res.status(400).json({ error: "rideId is required" });
  const rideRef = db.collection("rides").doc(rideId);
  try {
    const out = await db.runTransaction(async (tx) => {
      const snap = await tx.get(rideRef);
      if (!snap.exists) return { error: 404 };
      const ride = snap.data();
      const passengers = Array.isArray(ride.passengers) ? ride.passengers : [];
      if (!passengers.includes(req.uid)) return { ok: true, already: true };
      const boarded = Array.isArray(ride.boardedPassengers) ? ride.boardedPassengers : [];
      if (boarded.includes(req.uid)) return { error: 409 };
      if (ride.status !== "planned") return { error: 409 };

      const seats = (ride.passengerSeats || {})[req.uid];
      const freed = Number(seats) || 1;
      const nextPassengers = passengers.filter((id) => id !== req.uid);
      const update = {
        passengers: nextPassengers,
        seatsAvailable: (Number(ride.seatsAvailable) || 0) + freed,
        [`passengerSeats.${req.uid}`]: FieldValue.delete(),
        [`passengerPickups.${req.uid}`]: FieldValue.delete(),
        [`passengerDropoffs.${req.uid}`]: FieldValue.delete(),
      };
      tx.update(rideRef, update);
      return { ok: true, driverId: ride.driverId, freed };
    });
    if (out.error === 404) return res.status(404).json({ error: "ride not found" });
    if (out.error === 409) return res.status(409).json({ error: "cannot leave after boarding/start" });
    await releaseSessionSeats(db, out.driverId, out.freed);
    if (out.driverId) {
      await pushTo(
        out.driverId, db,
        "Un passager a quitté", "A passenger left",
        "Un passager a quitté ton trajet avant l'embarquement.",
        "A passenger left your ride before boarding.",
        { type: "passenger_left", rideId },
      );
    }
    return res.json({ success: true });
  } catch (err) {
    console.error("/rides/leave error:", err);
    return res.status(500).json({ error: "internal" });
  }
});

// ── Export ───────────────────────────────────────────────────────────────────
// Deploy: firebase deploy --only functions
exports.api = functions.https.onRequest(app);

// ── Admin metrics (founder dashboard) ─────────────────────────────────────────
// Privileged, AGGREGATE-ONLY metrics for the founder-only admin dashboard. Gated
// by the `admin` custom claim (set via scripts/set-admin-claims.js). Returns no
// PII — only counts and a summed cents total — so it stays Loi 25-safe.
//
// Defaults to the prod database (uniliftdefault); pass { env: "dev" } to read
// uniliftdev. Region matches `api` (us-central1, the v1 default).
//
// Deploy: firebase deploy --only functions:getAdminMetrics
exports.getAdminMetrics = functions.https.onCall(async (data, context) => {
  if (!context.auth) {
    throw new functions.https.HttpsError("unauthenticated", "Sign in required.");
  }
  if (context.auth.token.admin !== true) {
    throw new functions.https.HttpsError("permission-denied", "Admins only.");
  }

  const db = data && data.env === "dev" ? devDb : prodDb;
  const { AggregateField } = require("firebase-admin/firestore");

  const dayMs = 24 * 60 * 60 * 1000;
  const cutoff7 = Timestamp.fromMillis(Date.now() - 7 * dayMs);
  const cutoff30 = Timestamp.fromMillis(Date.now() - 30 * dayMs);

  // Each metric is isolated: a single failing query yields null instead of
  // failing the whole call (e.g. a missing index on `date`).
  const countOf = async (query) => {
    try {
      const snap = await query.count().get();
      return snap.data().count;
    } catch (err) {
      console.warn("getAdminMetrics count failed:", err.message);
      return null;
    }
  };

  const gmvCents = async () => {
    try {
      const snap = await db
        .collectionGroup("transactions")
        .where("type", "==", "ride_charge")
        .aggregate({ total: AggregateField.sum("amount") })
        .get();
      return snap.data().total || 0;
    } catch (err) {
      console.warn("getAdminMetrics gmv failed:", err.message);
      return null;
    }
  };

  const totalAuthUsers = async () => {
    try {
      let total = 0;
      let pageToken;
      do {
        const res = await admin.auth().listUsers(1000, pageToken);
        total += res.users.length;
        pageToken = res.pageToken;
      } while (pageToken);
      return total;
    } catch (err) {
      console.warn("getAdminMetrics auth count failed:", err.message);
      return null;
    }
  };

  const [
    users,
    rides,
    events,
    rideRequests,
    onlineDrivers,
    ridesLast7d,
    ridesLast30d,
    completedRides,
    driveModeDrivers,
    gmv,
    authUsers,
  ] = await Promise.all([
    countOf(db.collection("users")),
    countOf(db.collection("rides")),
    countOf(db.collection("events")),
    countOf(db.collection("rideRequests")),
    countOf(db.collection("driverSessions").where("status", "==", "online")),
    countOf(db.collection("rides").where("date", ">=", cutoff7)),
    countOf(db.collection("rides").where("date", ">=", cutoff30)),
    countOf(db.collection("rides").where("status", "==", "completed")),
    countOf(db.collection("users").where("driverDays", "array-contains-any", WEEKDAY_KEYS)),
    gmvCents(),
    totalAuthUsers(),
  ]);

  return {
    users,
    rides,
    events,
    rideRequests,
    onlineDrivers,
    ridesLast7d,
    ridesLast30d,
    completedRides,
    driveModeDrivers,
    gmvCents: gmv,
    totalAuthUsers: authUsers,
    env: data && data.env === "dev" ? "dev" : "prod",
    generatedAt: new Date().toISOString(),
  };
});

// ── Scheduled: sweep stale ride state ────────────────────────────────────────
//
// Self-healing timeouts so no ride/request can wedge forever. Operates on
// TARGET_DB only (dev during phase-1 rollout — flip to prodDb at cutover), so
// deploying this can never mutate live production data.
//
// - rideRequests still `open` past REQUEST_TTL_MS       → expired (+ notify)
// - rides `planned` never started past PLANNED_TTL_MS    → expired (+ notify both)
// - rides `started` past the 3h live window              → expired (abandoned)
const REQUEST_TTL_MS = 15 * 60 * 1000;
const PLANNED_TTL_MS = 30 * 60 * 1000;

/** Documents examined per collection per sweep.
 *
 *  Every query in this job used to be unbounded, and every pass fanned a write
 *  plus a push over the whole result with `Promise.all`. On a backlog that means
 *  the job either exhausts memory or is killed mid-flight — and the first run
 *  against a database that has never been swept faces the entire history at once.
 *  Bounded batches drain the backlog over successive ticks instead, oldest first,
 *  which is also the order that matters to the people waiting. */
const SWEEP_BATCH = 200;

/** Claim a stale document before acting on it.
 *
 *  The passes below read, then write, then push, with no transaction. Two sweeps
 *  overlapping — a slow run against the 5-minute schedule — both saw the same
 *  stale doc and both notified, which is the duplicate-push bug. This re-reads
 *  inside a transaction and only proceeds if the document is still in the state
 *  that made it stale, so exactly one run wins the claim and sends the push. */
async function claimStale(db, ref, stillStale, update) {
  try {
    return await db.runTransaction(async (t) => {
      const snap = await t.get(ref);
      if (!snap.exists) return null;
      const data = snap.data();
      if (!stillStale(data)) return null;
      t.update(ref, typeof update === "function" ? update(data) : update);
      return data;
    });
  } catch (err) {
    console.warn("claimStale failed for", ref.path, err.message);
    return null;
  }
}

function ageMs(value) {
  // Accepts Firestore Timestamp, ISO string, or ms number.
  if (value == null) return null;
  if (typeof value === "object" && typeof value.toMillis === "function") {
    return Date.now() - value.toMillis();
  }
  const ms = typeof value === "number" ? value : Date.parse(value);
  return Number.isFinite(ms) ? Date.now() - ms : null;
}

async function sweepStaleRidesImpl(db) {
  const summary = { requestsExpired: 0, plannedExpired: 0, startedExpired: 0, matchesExpired: 0 };

  // 1. Open ride requests past their TTL.
  const openReqs = await db.collection("rideRequests")
    .where("status", "==", "open").limit(SWEEP_BATCH).get();
  for (const doc of openReqs.docs) {
    const age = ageMs(doc.data().createdAt);
    if (age == null || age < REQUEST_TTL_MS) continue;
    const claimed = await claimStale(
      db, doc.ref,
      (d) => d.status === "open",
      { status: "expired" },
    );
    if (!claimed) continue;
    summary.requestsExpired += 1;
    await pushTo(
      claimed.passengerId, db,
      "Aucun chauffeur trouvé", "No driver found",
      "Aucun chauffeur n'a répondu à ta demande. Réessaie quand tu veux.",
      "No driver responded to your request. Try again anytime.",
      { type: "request_expired" },
    );
  }

  // 2. Planned rides never started.
  // Fetched ONCE and reused by pass 5 below — both passes want exactly the same
  // "status == planned" set, and issuing the query twice per tick doubled the
  // read cost of every sweep for no benefit.
  const planned = await db.collection("rides")
    .where("status", "==", "planned").limit(SWEEP_BATCH).get();
  // Rides this pass moves out of "planned". Pass 5 re-queried Firestore, so it
  // never saw them; reusing the snapshot means it must skip them explicitly, or
  // it would overwrite the "expired" status this pass just wrote.
  const expiredHere = new Set();
  for (const doc of planned.docs) {
    const r = doc.data();
    const age = ageMs(r.createdAt || r.date);
    if (age == null || age < PLANNED_TTL_MS) continue;
    const claimed = await claimStale(
      db, doc.ref,
      (d) => d.status === "planned",
      { status: "expired", passengers: [], joinRequests: {} },
    );
    if (!claimed) continue;
    expiredHere.add(doc.id);
    summary.plannedExpired += 1;
    // Give the driver back the seats this match had taken from their session.
    const seats = Object.values(claimed.passengerSeats || {})
      .reduce((acc, v) => acc + (Number(v) || 1), 0);
    await releaseSessionSeats(db, claimed.driverId, seats);
    await Promise.all((Array.isArray(claimed.passengers) ? claimed.passengers : []).map((pid) => pushTo(
      pid, db,
      "Trajet expiré", "Ride expired",
      "Le chauffeur n'a jamais démarré le trajet. Ouvre l'app pour un autre lift.",
      "The driver never started the ride. Open the app for another lift.",
      { type: "ride_expired", rideId: doc.id },
    )));
  }

  // 3. (removed) Payment stuck in "processing".
  //
  // Nothing has written that value since /rides/complete was deleted — the whole
  // charge now happens inside one /rides/finish transaction, so there is no
  // partial state to unwedge. The pass was kept for a release to drain docs
  // already stuck in it; that is done, and re-querying a value nothing writes
  // cost a collection scan every five minutes forever.

  // 4. Started rides abandoned past the 3h live window.
  const started = await db.collection("rides")
    .where("status", "==", "started").limit(SWEEP_BATCH).get();
  for (const doc of started.docs) {
    const age = ageMs(doc.data().startedAt);
    if (age == null || age < RIDE_LIVE_WINDOW_MS) continue;
    const claimed = await claimStale(
      db, doc.ref,
      (d) => d.status === "started",
      { status: "expired" },
    );
    if (claimed) summary.startedExpired += 1;
  }

  // 5. Matches the passenger never confirmed past the confirm window. Tear the
  //    match down (free the seat, cancel the empty ride) and re-open the request
  //    so the passenger's search resumes and the driver is unblocked.
  for (const doc of planned.docs) {
    if (expiredHere.has(doc.id)) continue; // already torn down by pass 2
    const r = doc.data();
    const pending = Array.isArray(r.pendingConfirmation) ? r.pendingConfirmation : [];
    if (pending.length === 0) continue;
    const deadline = r.confirmDeadlineAt;
    const expired = deadline && typeof deadline.toMillis === "function"
      ? Date.now() > deadline.toMillis()
      : (ageMs(r.createdAt) ?? 0) > CONFIRM_WINDOW_MS;
    if (!expired) continue;

    // Remove every unconfirmed passenger, restore their seats, cancel if empty.
    const seatsMap = r.passengerSeats || {};
    const freed = pending.reduce((acc, pid) => acc + (Number(seatsMap[pid]) || 1), 0);
    const nextPassengers = (Array.isArray(r.passengers) ? r.passengers : []).filter(
      (id) => !pending.includes(id),
    );
    const update = {
      passengers: nextPassengers,
      seatsAvailable: (Number(r.seatsAvailable) || 0) + freed,
      pendingConfirmation: [],
    };
    for (const pid of pending) {
      update[`passengerSeats.${pid}`] = FieldValue.delete();
      update[`passengerPickups.${pid}`] = FieldValue.delete();
      update[`passengerDropoffs.${pid}`] = FieldValue.delete();
    }
    if (nextPassengers.length === 0) update.status = "cancelled";

    // Claim it: only the run that still sees these passengers pending tears the
    // match down and sends the push. An overlapping sweep finds them gone.
    const claimed = await claimStale(
      db, doc.ref,
      (d) => {
        const p = Array.isArray(d.pendingConfirmation) ? d.pendingConfirmation : [];
        return d.status === "planned" && p.length > 0;
      },
      update,
    );
    if (!claimed) continue;

    // Same seats the accept took out of the driver's live session.
    await releaseSessionSeats(db, r.driverId, freed);

    if (r.requestId) {
      await db.collection("rideRequests").doc(r.requestId).update({
        status: "open",
        matchedRideId: FieldValue.delete(),
        matchedDriverId: FieldValue.delete(),
        matchedAt: FieldValue.delete(),
        // The driver whose match just lapsed should not be the first one
        // re-notified for the same request.
        rejectedDrivers: FieldValue.arrayUnion(r.driverId),
      }).catch(() => {});
    }
    summary.matchesExpired += 1;
    await Promise.all(pending.map((pid) => pushTo(
      pid, db,
      "Match expiré", "Match expired",
      "Tu n'as pas confirmé à temps. On te retrouve un autre chauffeur.",
      "You didn't confirm in time. We're finding you another driver.",
      { type: "match_expired", rideId: doc.id, requestId: r.requestId || "" },
    )));
  }

  return summary;
}

exports.sweepStaleRides = onSchedule(
  // Explicit timeout and memory. The v2 default is 60s / 256MiB, which is not
  // enough for a job that scans four collections and sends a push per hit — it
  // was being killed mid-sweep, leaving half the batch un-expired.
  {
    schedule: "every 5 minutes",
    timeZone: "America/Toronto",
    timeoutSeconds: 540,
    memory: "512MiB",
  },
  async () => {
    if (SCHEDULED_JOBS_PAUSED) return void console.log("sweepStaleRides: PAUSED, skipping");
    try {
      const summary = await sweepStaleRidesImpl(TARGET_DB);
      console.log("sweepStaleRides:", JSON.stringify(summary));
    } catch (err) {
      console.error("sweepStaleRides error:", err);
    }
  },
);

// ── Monthly Billing Scheduled Function ───────────────────────────────────────
// Runs 1st of every month at 3 AM ET against TARGET_DB (dev during phase-1
// rollout — flip to prodDb/stripeLive at cutover). One netted pass per user:
// earnings are subtracted from ride charges and only the difference moves —
// charged off-session if negative, moved into the driver's settled
// availableEarningsCents if positive (monthlyDriverPayouts queues it on the 5th,
// once those charges have cleared, and the daily sweeper transfers it out).
exports.monthlyBilling = onSchedule(
  // Settlement makes one serial Stripe round trip per user with a balance. At the
  // 60s default this was killed after a few dozen users every month — the rest
  // silently went unsettled until the next run.
  {
    schedule: "0 3 1 * *",
    timeZone: "America/Toronto",
    timeoutSeconds: 540,
    memory: "512MiB",
  },
  async () => {
    if (SCHEDULED_JOBS_PAUSED) return void console.log("monthlyBilling: PAUSED, skipping");
    try {
      const settled = await settleAllUsers(TARGET_DB, TARGET_STRIPE);
      console.log("monthlyBilling:", JSON.stringify(settlementTotals(settled)));
    } catch (err) {
      console.error("monthlyBilling error:", err);
    }
  },
);

// ── Payout Sweeper ───────────────────────────────────────────────────────────
// Drains the `payouts` queue that queueMonthlyPayouts fills on the 5th.
//
// Why this is a SEPARATE daily job rather than part of the enqueue: card charges
// take 2–7 days to become `available` in the Stripe balance, but a transfer
// needs the funds now. Paying in the same run as the charge would fail with
// balance_insufficient. Running daily means the queue drains over the days after
// the 5th as money settles, and every other failure mode — a driver who finishes
// onboarding late, a transient Stripe error — retries for free.

/** Give up on a payout row after this many failed transfer attempts. */
const MAX_PAYOUT_ATTEMPTS = 5;
/** Rows processed per run. Keeps the job inside its timeout; leftovers are
 *  picked up by the next run because nothing is mutated until a row succeeds. */
const PAYOUT_BATCH_LIMIT = 200;
/** A payout waiting this long on Connect onboarding is cancelled and refunded. */
const AWAITING_SETUP_TTL_MS = 30 * 24 * 60 * 60 * 1000;

/** Did a transfer for this payout row already reach Stripe?
 *
 *  Matched on `metadata.payoutId`, which every transfer this file creates carries.
 *  Returns null when it genuinely cannot tell — the caller treats that as "not
 *  sent", which risks a double payout, so this deliberately errs toward finding
 *  one: it scans a generous window rather than the last few. */
async function findExistingTransfer(stripe, destination, payoutId) {
  if (!destination) return null;
  try {
    const list = await stripe.transfers.list({ destination, limit: 100 });
    return list.data.find((t) => t.metadata && t.metadata.payoutId === payoutId) || null;
  } catch (err) {
    console.warn("findExistingTransfer failed:", err.message);
    return null;
  }
}

async function payoutPendingEarningsImpl(db, stripe) {
  const tally = { paid: 0, awaitingSetup: 0, insufficient: 0, failed: 0, skipped: 0, expired: 0 };
  const pricing = await getPricing(db);

  const snap = await db
    .collection("payouts")
    .where("status", "in", ["pending", "awaiting_setup"])
    .orderBy("createdAt")
    .limit(PAYOUT_BATCH_LIMIT)
    .get();
  if (snap.empty) return tally;

  // Available balance, tracked locally as we spend it. Stripe's balance is only
  // re-read once per run: transfers settle against it immediately, so decrementing
  // our own copy is both accurate and far cheaper than re-fetching per row.
  const balance = await stripe.balance.retrieve();
  const funds = (balance.available || []).find((b) => b.currency === pricing.currency);
  // Withhold an operating float so the sweeper never drains the account to zero —
  // Stripe fees, refunds and chargebacks all draw on the same balance.
  const float = Number(pricing.operatingFloatCents) || 0;
  let remaining = Math.max(0, (funds ? funds.amount : 0) - float);

  for (const doc of snap.docs) {
    const row = doc.data();
    const uid = row.uid;
    const amount = Number(row.amountCents) || 0;
    // What goes back to the wallet if this payout never happens. The wallet was
    // debited GROSS at enqueue (amount + the Connect fee), so refunding
    // `amount` would quietly pocket the fee for a payout that never occurred.
    // Rows written before the fee existed carry no grossCents — fall back.
    const refundCents = Number(row.grossCents) || amount;
    if (amount <= 0) { tally.skipped += 1; continue; }

    // Hoisted so the catch below can ask Stripe whether the transfer landed.
    let destinationAccountId = null;

    try {
      const userRef = db.collection("users").doc(uid);
      const userSnap = await userRef.get();
      const user = userSnap.data() ?? {};
      let accountId = user.stripeConnectAccountId;
      destinationAccountId = accountId;
      let ready = user.stripeConnectPayoutsEnabled === true;

      // Self-heal a missed webhook: the driver may have finished onboarding
      // without the app ever reopening to reconcile.
      if (accountId && !ready) {
        try {
          const acct = await stripe.accounts.retrieve(accountId);
          const fields = connectFieldsFromAccount(acct);
          await userRef.set(fields, { merge: true });
          ready = fields.stripeConnectPayoutsEnabled;
        } catch (_e) {
          // Leave `ready` false; the row waits for the next run.
        }
      }

      if (!accountId || !ready) {
        // Give up after a while and hand the money back.
        //
        // The balance was debited when the row was queued, so a driver who never
        // finishes Connect onboarding had it parked here indefinitely, nudged
        // once a month forever — and, since account deletion started refusing
        // while a payout is queued, could not even close their account.
        const waitedMs = ageMs(row.createdAt);
        if (waitedMs != null && waitedMs > AWAITING_SETUP_TTL_MS) {
          await db.runTransaction(async (t) => {
            const uRef = db.collection("users").doc(uid);
            const uSnap = await t.get(uRef);
            const cur = uSnap.exists ? (uSnap.data() ?? {}) : null;
            if (cur) {
              t.update(uRef, {
                availableEarningsCents: (Number(cur.availableEarningsCents) || 0) + refundCents,
              });
            }
            if (row.feeTxPath) t.update(db.doc(row.feeTxPath), { status: "cancelled" });
            t.update(doc.ref, {
              status: "expired",
              expiredAt: new Date().toISOString(),
              lastError: "connect onboarding never completed",
            });
            if (row.txPath) t.update(db.doc(row.txPath), { status: "cancelled" });
          });
          tally.expired += 1;
          await pushTo(
            uid, db,
            "Paiement annulé", "Payout cancelled",
            "Ton virement a été annulé faute de configuration bancaire. Le montant est de retour dans ton solde.",
            "Your payout was cancelled because your bank details were never set up. The amount is back in your balance.",
            { type: "payout_expired", payoutId: doc.id },
          ).catch(() => {});
          continue;
        }

        // Nudge at most once per settlement month, not once per daily run.
        const month = row.settlementMonth || new Date().toISOString().slice(0, 7);
        const update = { status: "awaiting_setup" };
        if (row.nudgedMonth !== month) {
          update.nudgedMonth = month;
          await pushTo(
            uid, db,
            "Configure tes paiements", "Set up your payouts",
            "Tes gains t'attendent. Ajoute tes infos bancaires pour être payé.",
            "Your earnings are waiting. Add your bank details to get paid.",
            { type: "payout_setup_required", payoutId: doc.id },
          ).catch(() => {});
        }
        await doc.ref.update(update);
        tally.awaitingSetup += 1;
        continue;
      }

      if (amount > remaining) {
        // Not enough settled funds yet. Stop rather than skip ahead: the queue is
        // ordered oldest-first, and paying a later small row before an earlier
        // large one would starve the driver who has waited longest.
        tally.insufficient += 1;
        break;
      }

      const transfer = await stripe.transfers.create(
        {
          amount,
          currency: pricing.currency,
          destination: accountId,
          metadata: {
            firebaseUid: uid,
            payoutId: doc.id,
            settlementMonth: row.settlementMonth || "",
          },
        },
        // Doc id is unique per driver per settlement, so a re-run can never
        // double-pay even if the write below failed last time.
        { idempotencyKey: `payout-${doc.id}` },
      );

      remaining -= amount;
      const paidAt = new Date().toISOString();
      await db.runTransaction(async (t) => {
        t.update(doc.ref, {
          status: "completed",
          stripeTransferId: transfer.id,
          paidAt,
        });
        if (row.txPath) {
          t.update(db.doc(row.txPath), {
            status: "completed",
            stripeTransferId: transfer.id,
          });
        }
      });
      tally.paid += 1;

      await pushTo(
        uid, db,
        "Paiement envoyé", "Payout sent",
        `${(amount / 100).toFixed(2)} $ sont en route vers ton compte.`,
        `$${(amount / 100).toFixed(2)} is on its way to your account.`,
        { type: "payout_sent", payoutId: doc.id },
      ).catch(() => {});
    } catch (err) {
      const attempts = (Number(row.attempts) || 0) + 1;
      const giveUp = attempts >= MAX_PAYOUT_ATTEMPTS;
      const lastError = String(err && err.message ? err.message : err).slice(0, 500);

      if (giveUp) {
        // Before refunding, find out whether the transfer actually went out.
        //
        // The failures that land here are usually "Stripe said yes and the write
        // afterwards said no". The idempotency key stops a second TRANSFER, but
        // it does nothing about the refund below — so giving up blind would put
        // the money back in the driver's balance after it had already reached
        // their bank, and they would be paid twice.
        const landed = await findExistingTransfer(stripe, destinationAccountId, doc.id);
        if (landed) {
          console.warn(`payout ${doc.id}: transfer ${landed.id} had already landed; completing instead of refunding`);
          await db.runTransaction(async (t) => {
            t.update(doc.ref, {
              status: "completed",
              stripeTransferId: landed.id,
              paidAt: new Date().toISOString(),
              recoveredAfterAttempts: attempts,
            });
            if (row.txPath) {
              t.update(db.doc(row.txPath), { status: "completed", stripeTransferId: landed.id });
            }
          });
          tally.paid += 1;
          continue;
        }

        // Genuinely never sent — CREDIT THE MONEY BACK. queueMonthlyPayouts
        // debits availableEarningsCents at enqueue time so a re-run cannot
        // double-queue, so giving up here without refunding would silently
        // destroy the driver's balance — the worst bug this design can have.
        // Same transaction as the status write, so the two can never diverge.
        await db.runTransaction(async (t) => {
          const userRef = db.collection("users").doc(uid);
          const userSnap = await t.get(userRef);
          const cur = userSnap.data() ?? {};
          t.update(userRef, {
            availableEarningsCents: (Number(cur.availableEarningsCents) || 0) + refundCents,
          });
          t.update(doc.ref, { attempts, lastError, status: "failed", refundedAt: new Date().toISOString() });
          if (row.txPath) t.update(db.doc(row.txPath), { status: "failed" });
          if (row.feeTxPath) t.update(db.doc(row.feeTxPath), { status: "cancelled" });
        });
        tally.failed += 1;
        await pushTo(
          uid, db,
          "Paiement échoué", "Payout failed",
          "Ton virement n'a pas pu être envoyé. Le montant est de retour dans ton solde.",
          "We couldn't send your payout. The amount is back in your balance.",
          { type: "payout_failed", payoutId: doc.id },
        ).catch(() => {});
      } else {
        await doc.ref.update({ attempts, lastError });
      }
      console.error(`payout ${doc.id} attempt ${attempts} failed:`, err.message);
    }
  }

  return tally;
}

/** Fill the payout queue — every driver whose settled balance clears the floor,
 *  once a month, without being asked.
 *
 *  This replaced an on-demand `POST /payouts/cashout`. Pull cashout let a driver
 *  take settled-but-not-yet-CLEARED money on the 2nd, days before the card
 *  charges behind it had actually landed in the Stripe balance — so the platform
 *  could owe more than it held on any given day. Pushing on a fixed date, after
 *  the charges clear, makes outflow as predictable as inflow.
 *
 *  Only `availableEarningsCents` is ever queued, and only settleAllUsers credits
 *  that field, so a queued dollar always has a succeeded passenger charge behind
 *  it. That is the guarantee; the date is only about Stripe's clearing delay.
 *
 *  Rows are written in exactly the shape the sweeper expects, so there is still
 *  one transfer path and one refund path to keep correct. */
async function queueMonthlyPayouts(db) {
  const tally = { queued: 0, skipped: 0, failed: 0, totalCents: 0, feesCents: 0 };
  const pricing = await getPricing(db);

  // The floor is on the raw balance, but eligibility is decided on `available`
  // (balance minus this driver's own unsettled charges), which is never larger.
  // So this query is a cheap superset and the real gate is cashoutEligibility.
  const snap = await db
    .collection("users")
    .where("availableEarningsCents", ">=", pricing.minPayoutCents)
    .limit(PAYOUT_BATCH_LIMIT)
    .get();

  for (const userDoc of snap.docs) {
    const elig = cashoutEligibility(userDoc.data(), pricing, false);
    // Below the floor after the offset, no Connect account, or a live dispute.
    // Nothing is lost — the balance stays put and is retried next month.
    if (!elig.canCashout) { tally.skipped += 1; continue; }
    // Never stack a second row on a driver who already has one in flight. This
    // is what makes a re-run of this job a no-op rather than a double payout.
    if (await findPendingCashout(db, userDoc.id)) { tally.skipped += 1; continue; }

    // `gross` leaves the driver's wallet; `amount` is what actually transfers.
    // The difference is Stripe's Connect cost for this one payout, recovered
    // here rather than from passengers per ride — see payoutFeeCents().
    const gross = elig.available;
    const fee = payoutFeeCents(gross, pricing);
    const amount = gross - fee;
    const now = new Date().toISOString();
    const payoutRef = db.collection("payouts").doc();
    const txRef = userDoc.ref.collection("transactions").doc();
    const feeTxRef = userDoc.ref.collection("transactions").doc();
    try {
      const queued = await db.runTransaction(async (t) => {
        const fresh = await t.get(userDoc.ref);
        const cur = fresh.data() ?? {};
        // Re-check inside the transaction: the driver may have accrued new
        // charges, or a dispute may have opened, since the query above.
        const freshElig = cashoutEligibility(cur, pricing, false);
        if (!freshElig.canCashout || freshElig.available !== gross) return false;
        // Decrement by what is leaving, NOT to zero — `available` is the balance
        // minus the driver's own unsettled charges, and zeroing here would
        // silently destroy the amount held back for next month's offset.
        //
        // Debited by GROSS: the fee leaves the wallet too. Every refund path in
        // the sweeper must therefore credit back grossCents, not amountCents.
        t.update(userDoc.ref, {
          availableEarningsCents: freshElig.balance - gross,
          lastCashoutAt: now,
        });
        t.set(txRef, {
          type: "cashout",
          amount,
          status: "pending",
          description: "Monthly payout to your bank account",
          createdAt: now,
          payoutId: payoutRef.id,
        });
        // Itemised, never netted silently into the payout. A driver seeing only
        // a smaller number than they earned is exactly the "silent spread" the
        // one-rate design exists to prevent.
        if (fee > 0) {
          t.set(feeTxRef, {
            type: "payout_fee",
            amount: fee,
            status: "completed",
            description: "Payout processing fee",
            createdAt: now,
            payoutId: payoutRef.id,
          });
        }
        t.set(payoutRef, {
          uid: userDoc.id,
          amountCents: amount,
          grossCents: gross,
          feeCents: fee,
          kind: "monthly",
          requestedAt: now,
          settlementMonth: now.slice(0, 7),
          status: "pending",
          attempts: 0,
          txPath: txRef.path,
          ...(fee > 0 ? { feeTxPath: feeTxRef.path } : {}),
          createdAt: now,
        });
        return true;
      });

      if (queued) {
        tally.queued += 1;
        tally.totalCents += amount;
        tally.feesCents += fee;
        await pushTo(
          userDoc.id, db,
          "Paiement en route", "Payout on its way",
          `${(amount / 100).toFixed(2)} $ de gains s'en vont vers ton compte.`,
          `$${(amount / 100).toFixed(2)} in earnings is heading to your account.`,
          { type: "payout_queued", payoutId: payoutRef.id },
        ).catch(() => {});
      } else {
        tally.skipped += 1;
      }
    } catch (err) {
      tally.failed += 1;
      console.error(`monthly payout enqueue for ${userDoc.id} failed:`, err.message);
    }
  }

  return tally;
}

exports.payoutPendingEarnings = onSchedule(
  { schedule: "0 4 * * *", timeZone: "America/Toronto", timeoutSeconds: 540, memory: "512MiB" },
  async () => {
    if (SCHEDULED_JOBS_PAUSED) return void console.log("payoutPendingEarnings: PAUSED, skipping");
    try {
      const tally = await payoutPendingEarningsImpl(TARGET_DB, TARGET_STRIPE);
      console.log("payoutPendingEarnings:", JSON.stringify(tally));
    } catch (err) {
      console.error("payoutPendingEarnings error:", err);
    }
  },
);

// ── Monthly Driver Payouts ───────────────────────────────────────────────────
// Fills the payout queue on the 5th at 3 AM ET, four days after monthlyBilling
// charged the passengers on the 1st.
//
// THE GAP IS DELIBERATE. Card money sits in Stripe's `pending` balance for
// T+2..7 (CAD) before it is `available`, and a transfer can spend nothing but
// `available` funds. Enqueuing on the 1st would put every row straight into the
// sweeper's `insufficient` branch. Four days puts the run inside the clearing
// window, and the daily sweeper picks up whatever is still short.
//
// Do NOT move this earlier to "pay drivers faster". The order — charge, clear,
// queue, transfer — is what keeps UniLift from ever pushing money it has not
// yet collected.
exports.monthlyDriverPayouts = onSchedule(
  {
    schedule: `0 3 ${PAYOUT_DAY_OF_MONTH} * *`,
    timeZone: "America/Toronto",
    timeoutSeconds: 540,
    memory: "512MiB",
  },
  async () => {
    if (SCHEDULED_JOBS_PAUSED) return void console.log("monthlyDriverPayouts: PAUSED, skipping");
    try {
      const tally = await queueMonthlyPayouts(TARGET_DB);
      console.log("monthlyDriverPayouts:", JSON.stringify(tally));
    } catch (err) {
      console.error("monthlyDriverPayouts error:", err);
    }
  },
);


// ── Public profile mirror ────────────────────────────────────────────────────
// Keeps `users/{uid}/public/profile` in step with the private user doc.
//
// A trigger rather than a write in each code path, because the private doc is
// edited from many places — signup, profile settings, the avatar hook, the
// language toggle, /rides/rate — and every one of them would otherwise have to
// remember to mirror. The projection is an allowlist (publicProfileFrom), so a
// new private field added tomorrow does not leak by being forgotten here.
//
// The trigger is scoped to the PRODUCTION database. functions-sandbox/ carries
// the uniliftdev twin; a v2 Firestore trigger binds to exactly one database.
exports.mirrorPublicProfile = onDocumentWritten(
  { document: "users/{uid}", database: "uniliftdefault", region: "us-central1" },
  async (event) => {
    const uid = event.params.uid;
    const after = event.data && event.data.after;
    // Deleted user → drop the public copy too, so /account/delete cannot leave a
    // readable profile behind.
    if (!after || !after.exists) {
      try {
        await publicProfileRef(prodDb, uid).delete();
      } catch (err) {
        console.warn("mirrorPublicProfile delete failed for", uid, err.message);
      }
      return;
    }
    await writePublicProfile(prodDb, uid, after.data());
  },
);

// ── Auth blocking functions ─────────────────────────────────────────────────
//
// The account-creation chokepoint: one mailbox, one account, enforced before
// the auth record exists. See functions/identity.js for why these are exported
// from the LIVE codebase ONLY — a project has a single beforeCreate URI, and
// functions-sandbox/ deploys to the same project, so exporting them from both
// would make the two deploys fight over the same registration.
//
// Requires Firebase Authentication upgraded to Identity Platform. Until that
// upgrade is done in the console these are inert: unregistered blocking
// functions simply never fire, so this is safe to deploy ahead of it.
const identity = require("./identity");
exports.beforeUserCreated = identity.beforeUserCreated;
exports.beforeUserSignedIn = identity.beforeUserSignedIn;
