const functions = require("firebase-functions");
const { onSchedule } = require("firebase-functions/v2/scheduler");
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

// Scheduled jobs (sweepStaleRides, monthlyBilling) have no per-request env
// header, so they must name a fixed database in code. Phase 1 of the ride-path
// hardening rollout keeps them pointed at the dev database so running them can
// NEVER touch live production data. At cutover (new production app live + old
// clients force-gated) flip these to prodDb / stripeLive and redeploy.
const TARGET_DB = devDb;
const TARGET_STRIPE = stripeTest;

const getDb     = (req) => req.headers["x-app-env"] === "dev" ? devDb  : prodDb;
const getStripe = (req) => req.headers["x-app-env"] === "dev" ? stripeTest : stripeLive;
const getStripePublishableKey = (req) =>
  req.headers["x-app-env"] === "dev"
    ? process.env.STRIPE_PUBLISHABLE_KEY_TEST
    : process.env.STRIPE_PUBLISHABLE_KEY_LIVE;

const app = express();
app.use(express.json());

// ── Auth Middleware ──────────────────────────────────────────────────────────
const authenticate = async (req, res, next) => {
  const header = req.headers.authorization ?? "";
  if (!header.startsWith("Bearer ")) {
    return res.status(401).json({ error: "Unauthorized" });
  }
  try {
    const decoded = await admin.auth().verifyIdToken(header.split("Bearer ")[1]);
    req.uid = decoded.uid;
    next();
  } catch {
    res.status(401).json({ error: "Invalid token" });
  }
};

// ── Payment Utilities (mirrors constants/pricing.ts) ────────────────────────
// Fallback defaults. The live values are read from the Firestore doc
// `config/pricing` (editable via the founder admin dashboard). These are used
// only when that doc is missing or a field is invalid, so charges never break.
const DEFAULT_PRICING = {
  passengerRateCentsPerKm: 25,
  driverRateCentsPerKm: 20,
  minimumChargeCents: 100,
  minimumDistanceKm: 0.5,
};

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
        const n = Number(data[key]);
        if (Number.isFinite(n) && n > 0) value[key] = n;
      }
    }
  } catch (err) {
    console.warn("getPricing failed, using defaults:", err.message);
  }

  pricingCache.set(env, { value, expires: Date.now() + PRICING_TTL_MS });
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

  const customer = await stripe.customers.create({ metadata: { firebaseUid: uid } });
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

// ── Rides: Can Join ─────────────────────────────────────────────────────────
//
// NOTE: the legacy POST /rides/complete lived here. It was removed because it
// charged whatever passenger ids the *client* put in `confirmedPassengerIds` —
// no boarded check, no dropped check, no dropoff-radius check — so a driver
// could be paid for a passenger dropped nowhere near their destination. All
// ride payment now goes through POST /rides/finish, which derives the charge set
// server-side via chargeablePassengers().
app.post("/rides/can-join", authenticate, async (req, res) => {
  const db = getDb(req);
  try {
    const snap = await db.collection("users").doc(req.uid).get();
    if (!snap.exists) return res.status(404).json({ error: "user_not_found" });
    const pmId = snap.data()?.stripePaymentMethodId;
    if (!pmId) return res.status(403).json({ error: "no_payment_method" });
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
        `+${fmt(earning)} — encore ${ridesTo100} trajets comme ça et tu atteins 100 $. Commence ici 💰`,
        `Accepte maintenant → reste constant ${daysTo100At5} jours → atteins ton objectif de 100 $ 🎯`,
        `5 trajets aujourd'hui = ${fmt(dailyAt5)} dans ta poche. Celui-ci compte 🔥`,
        `${ridesTo100} trajets de plus cette semaine → 100 $ gagnés. Un à la fois 🚀`,
        `Conduis 5 jours comme ça et empoche ${fmt(weeklyAt5)}+ 💵 Accepte pour garder la série`,
        `Chaque trajet s'accumule — ${ridesTo100} te mènent à 100 $. C'est le trajet #1 ⚡`,
      ]
    : [
        `+${fmt(earning)} — ${ridesTo100} rides like this and you hit 100 $. Start here 💰`,
        `Accept now → stay consistent ${daysTo100At5} days → reach your 100 $ goal 🎯`,
        `5 rides today = ${fmt(dailyAt5)} in your pocket. This one counts 🔥`,
        `${ridesTo100} more rides this week → 100 $ earned. One at a time 🚀`,
        `Drive 5 days like this and pocket ${fmt(weeklyAt5)}+ 💵 Accept to keep the streak`,
        `Every ride adds up — ${ridesTo100} gets you to 100 $. This is ride #1 ⚡`,
      ];

  // Rotate deterministically by hour so back-to-back requests feel varied
  const seed = new Date().getHours() + (requestId.charCodeAt(0) || 0);
  return messages[seed % messages.length];
}

async function sendPushNotification(expoPushToken, title, body, data = {}, subtitle = undefined) {
  const payload = { to: expoPushToken, sound: "default", title, body, data };
  if (subtitle) payload.subtitle = subtitle;
  const response = await fetch("https://exp.host/--/api/v2/push/send", {
    method: "POST",
    headers: {
      Accept: "application/json",
      "Accept-Encoding": "gzip, deflate",
      "Content-Type": "application/json",
    },
    body: JSON.stringify(payload),
  });
  return response.json();
}

async function getUserPushToken(uid, db) {
  const snap = await db.collection("users").doc(uid).get();
  return (snap.data() ?? {}).expoPushToken ?? null;
}

/** Returns { token, lang } for a user. lang is "fr" or "en" (default "en"). */
async function getUserPushInfo(uid, db) {
  const snap = await db.collection("users").doc(uid).get();
  const data = snap.data() ?? {};
  return {
    token: data.expoPushToken ?? null,
    lang: data.language === "fr" ? "fr" : "en",
  };
}

app.post("/notifications/send", authenticate, async (req, res) => {
  const db = getDb(req);
  try {
    const { uid, title, body, data } = req.body;
    if (!uid || !title || !body) {
      return res.status(400).json({ error: "uid, title, and body are required" });
    }
    const token = await getUserPushToken(uid, db);
    if (!token) {
      return res.status(404).json({ error: "User has no push token" });
    }
    const result = await sendPushNotification(token, title, body, data ?? {});
    res.json({ success: true, result });
  } catch (err) {
    console.error("/notifications/send:", err);
    res.status(500).json({ error: err.message });
  }
});

// ── Billing: Charge passengers at month-end ───────────────────────────────────
//
// Reads all users with pendingChargeCents > 0, creates an off-session
// Stripe PaymentIntent against their saved card, then zeroes the balance.
// Protected by x-billing-secret header (set BILLING_SECRET in functions/.env).
// Trigger via Cloud Scheduler or curl:
//   curl -X POST https://<region>-<project>.cloudfunctions.net/api/billing/charge-monthly \
//        -H "x-billing-secret: <BILLING_SECRET>"
//
async function chargeAllPassengers(db, stripe) {
  const month = new Date().toISOString().slice(0, 7);
  const usersSnap = await db
    .collection("users")
    .where("pendingChargeCents", ">", 0)
    .get();
  const results = [];

  for (const doc of usersSnap.docs) {
    const { pendingChargeCents, stripePaymentMethodId } = doc.data();
    if (!stripePaymentMethodId || !pendingChargeCents) continue;

    try {
      const customerId = await getOrCreateCustomer(doc.id, db, stripe);
      const pi = await stripe.paymentIntents.create(
        {
          amount: pendingChargeCents,
          currency: "cad",
          customer: customerId,
          payment_method: stripePaymentMethodId,
          confirm: true,
          off_session: true,
        },
        { idempotencyKey: `monthly-charge-${doc.id}-${month}` },
      );

      if (pi.status === "succeeded") {
        await db.runTransaction(async (t) => {
          const ref = db.collection("users").doc(doc.id);
          const txRef = ref.collection("transactions").doc();
          t.update(ref, { pendingChargeCents: 0 });
          t.set(txRef, {
            type: "monthly_charge",
            amount: pendingChargeCents,
            status: "completed",
            description: `Monthly billing ${month}`,
            createdAt: new Date().toISOString(),
            stripePaymentIntentId: pi.id,
          });
        });
        results.push({ uid: doc.id, status: "charged", amount: pendingChargeCents });
      } else {
        results.push({ uid: doc.id, status: "not_succeeded", pi_status: pi.status });
      }
    } catch (err) {
      console.error(`Monthly charge failed for ${doc.id}:`, err);
      results.push({ uid: doc.id, status: "failed", error: err.message });
    }
  }
  return results;
}

// ── Billing: Payout drivers at month-end ─────────────────────────────────────
//
// Queues payout records for all drivers with pendingEarningsCents > 0.
// Actual bank transfers require Stripe Connect (future work).
// For now this zeroes the balance and records a monthly_payout transaction.
//
async function payoutAllDrivers(db) {
  const month = new Date().toISOString().slice(0, 7);
  const driversSnap = await db
    .collection("users")
    .where("pendingEarningsCents", ">", 0)
    .get();
  const results = [];

  for (const doc of driversSnap.docs) {
    const amount = doc.data().pendingEarningsCents;
    if (!amount) continue;

    try {
      await db.runTransaction(async (t) => {
        const ref = db.collection("users").doc(doc.id);
        const txRef = ref.collection("transactions").doc();
        t.update(ref, { pendingEarningsCents: 0 });
        t.set(txRef, {
          type: "monthly_payout",
          amount,
          status: "pending",
          description: `Monthly payout ${month}`,
          createdAt: new Date().toISOString(),
        });
      });
      results.push({ uid: doc.id, status: "payout_queued", amount });
    } catch (err) {
      console.error(`Monthly payout failed for ${doc.id}:`, err);
      results.push({ uid: doc.id, status: "failed", error: err.message });
    }
  }
  return results;
}

app.post("/billing/charge-monthly", authenticate, async (req, res) => {
  const db = getDb(req); const stripe = getStripe(req);
  const billingSecret = process.env.BILLING_SECRET;
  if (!billingSecret || req.headers["x-billing-secret"] !== billingSecret) {
    return res.status(403).json({ error: "Forbidden" });
  }
  try {
    const results = await chargeAllPassengers(db, stripe);
    res.json({ results });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: err.message });
  }
});

app.post("/billing/payout-drivers", authenticate, async (req, res) => {
  const db = getDb(req);
  const billingSecret = process.env.BILLING_SECRET;
  if (!billingSecret || req.headers["x-billing-secret"] !== billingSecret) {
    return res.status(403).json({ error: "Forbidden" });
  }
  try {
    const results = await payoutAllDrivers(db);
    res.json({ results });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: err.message });
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
    // 1. Clean up Stripe customer
    const userSnap = await db.collection("users").doc(uid).get();
    if (userSnap.exists) {
      const { stripeCustomerId, stripePaymentMethodId } = userSnap.data() ?? {};
      if (stripePaymentMethodId) {
        await stripe.paymentMethods.detach(stripePaymentMethodId).catch(() => {});
      }
      if (stripeCustomerId) {
        await stripe.customers.del(stripeCustomerId).catch(() => {});
      }
    }

    // 2. Delete transactions subcollection in batches
    let hasMore = true;
    while (hasMore) {
      const batch = db.batch();
      const snap = await db
        .collection("users")
        .doc(uid)
        .collection("transactions")
        .limit(400)
        .get();
      if (snap.empty) {
        hasMore = false;
      } else {
        snap.docs.forEach((doc) => batch.delete(doc.ref));
        await batch.commit();
        if (snap.size < 400) hasMore = false;
      }
    }

    // 3. Delete user Firestore document
    await db.collection("users").doc(uid).delete();

    // 4. Delete Firebase Auth account (must be last — invalidates the token)
    await admin.auth().deleteUser(uid);

    res.json({ success: true });
  } catch (err) {
    console.error("/account/delete error:", err);
    res.status(500).json({ error: err.message });
  }
});

// ── Social: Link / Unlink Facebook ───────────────────────────────────────────
app.post("/social/link-facebook", authenticate, async (req, res) => {
  const db = getDb(req);
  const { accessToken } = req.body;
  if (!accessToken || typeof accessToken !== "string") {
    return res.status(400).json({ error: "accessToken is required" });
  }

  try {
    const fbRes = await fetch(
      `https://graph.facebook.com/v18.0/me?fields=id,name&access_token=${encodeURIComponent(accessToken)}`,
    );
    if (!fbRes.ok) {
      return res.status(401).json({ error: "Invalid Facebook access token" });
    }
    const fbData = await fbRes.json();
    if (!fbData.id || fbData.error) {
      return res.status(401).json({ error: fbData.error?.message ?? "Could not retrieve Facebook ID" });
    }

    const facebookId = String(fbData.id);
    const facebookName = String(fbData.name ?? "");

    const existingSnap = await db
      .collection("users")
      .where("facebookId", "==", facebookId)
      .limit(1)
      .get();

    if (!existingSnap.empty && existingSnap.docs[0].id !== req.uid) {
      return res.status(409).json({ error: "facebook_already_linked" });
    }

    await db
      .collection("users")
      .doc(req.uid)
      .set({ facebookId, facebookName }, { merge: true });

    res.json({ facebookId, facebookName });
  } catch (err) {
    console.error("link-facebook error:", err);
    res.status(500).json({ error: err.message });
  }
});

app.post("/social/unlink-facebook", authenticate, async (req, res) => {
  const db = getDb(req);
  try {
    await db.collection("users").doc(req.uid).update({
      facebookId: FieldValue.delete(),
      facebookName: FieldValue.delete(),
    });
    res.json({ success: true });
  } catch (err) {
    console.error("unlink-facebook error:", err);
    res.status(500).json({ error: err.message });
  }
});

// ── Social: Instagram / TikTok / Spotify (OAuth authorization-code) ───────────
//
// Unlike Facebook (implicit token flow), these providers use the OAuth
// authorization-code flow: the mobile client obtains a short-lived `code`, and
// this server exchanges it for an access token using the provider's *secret*
// (never shipped to the client), then reads the public profile to store an id +
// handle on the user doc. Each provider needs credentials in functions/.env:
//
//   INSTAGRAM_APP_ID / INSTAGRAM_APP_SECRET
//   TIKTOK_CLIENT_KEY / TIKTOK_CLIENT_SECRET
//   SPOTIFY_CLIENT_ID / SPOTIFY_CLIENT_SECRET
//
// A LinkError carries an HTTP status so the route can translate it to a client
// response (e.g. 401 invalid_token, 502 provider unreachable).
class LinkError extends Error {
  constructor(status, code) {
    super(code);
    this.status = status;
    this.code = code;
  }
}

function requireEnv(...keys) {
  for (const k of keys) {
    if (!process.env[k]) throw new LinkError(500, `missing_config:${k}`);
  }
}

// Each exchanger returns { id, handle } or throws a LinkError.
const SOCIAL_EXCHANGERS = {
  // ── Spotify — confidential authorization-code (client secret, no PKCE) ──────
  async spotify({ code, redirectUri }) {
    requireEnv("SPOTIFY_CLIENT_ID", "SPOTIFY_CLIENT_SECRET");
    const basic = Buffer.from(
      `${process.env.SPOTIFY_CLIENT_ID}:${process.env.SPOTIFY_CLIENT_SECRET}`,
    ).toString("base64");
    const tokenRes = await fetch("https://accounts.spotify.com/api/token", {
      method: "POST",
      headers: {
        "Content-Type": "application/x-www-form-urlencoded",
        Authorization: `Basic ${basic}`,
      },
      body: new URLSearchParams({
        grant_type: "authorization_code",
        code,
        redirect_uri: redirectUri,
      }).toString(),
    });
    const token = await tokenRes.json().catch(() => ({}));
    if (!tokenRes.ok || !token.access_token) throw new LinkError(401, "invalid_token");

    const meRes = await fetch("https://api.spotify.com/v1/me", {
      headers: { Authorization: `Bearer ${token.access_token}` },
    });
    const me = await meRes.json().catch(() => ({}));
    if (!meRes.ok || !me.id) throw new LinkError(502, "profile_unavailable");
    return { id: String(me.id), handle: String(me.display_name || me.id) };
  },

  // ── TikTok — authorization-code with PKCE (code_verifier required) ──────────
  async tiktok({ code, codeVerifier, redirectUri }) {
    requireEnv("TIKTOK_CLIENT_KEY", "TIKTOK_CLIENT_SECRET");
    if (!codeVerifier) throw new LinkError(400, "missing_code_verifier");
    const tokenRes = await fetch("https://open.tiktokapis.com/v2/oauth/token/", {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams({
        client_key: process.env.TIKTOK_CLIENT_KEY,
        client_secret: process.env.TIKTOK_CLIENT_SECRET,
        code,
        grant_type: "authorization_code",
        redirect_uri: redirectUri,
        code_verifier: codeVerifier,
      }).toString(),
    });
    const token = await tokenRes.json().catch(() => ({}));
    if (!tokenRes.ok || !token.access_token) throw new LinkError(401, "invalid_token");

    const meRes = await fetch(
      "https://open.tiktokapis.com/v2/user/info/?fields=open_id,display_name,username",
      { headers: { Authorization: `Bearer ${token.access_token}` } },
    );
    const me = await meRes.json().catch(() => ({}));
    const u = me?.data?.user;
    const id = u?.open_id || token.open_id;
    if (!meRes.ok || !id) throw new LinkError(502, "profile_unavailable");
    return { id: String(id), handle: String(u?.username || u?.display_name || id) };
  },

  // ── Instagram — Instagram Login authorization-code (client secret, no PKCE) ─
  // Instagram appends "#_" to the redirect; the client should strip it, but we
  // defensively strip again here.
  async instagram({ code, redirectUri }) {
    requireEnv("INSTAGRAM_APP_ID", "INSTAGRAM_APP_SECRET");
    const cleanCode = String(code).replace(/#_$/, "");
    const tokenRes = await fetch("https://api.instagram.com/oauth/access_token", {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams({
        client_id: process.env.INSTAGRAM_APP_ID,
        client_secret: process.env.INSTAGRAM_APP_SECRET,
        grant_type: "authorization_code",
        redirect_uri: redirectUri,
        code: cleanCode,
      }).toString(),
    });
    const token = await tokenRes.json().catch(() => ({}));
    const accessToken = token.access_token;
    if (!tokenRes.ok || !accessToken) throw new LinkError(401, "invalid_token");

    const meRes = await fetch(
      `https://graph.instagram.com/me?fields=id,username&access_token=${encodeURIComponent(accessToken)}`,
    );
    const me = await meRes.json().catch(() => ({}));
    const id = me.id || token.user_id;
    if (!meRes.ok || !id) throw new LinkError(502, "profile_unavailable");
    return { id: String(id), handle: String(me.username || id) };
  },
};

// Firestore field names per provider: <provider>Id + a human-readable handle.
const SOCIAL_FIELDS = {
  instagram: { idField: "instagramId", handleField: "instagramHandle" },
  tiktok: { idField: "tiktokId", handleField: "tiktokHandle" },
  spotify: { idField: "spotifyId", handleField: "spotifyName" },
};

// POST /social/link/:provider  { code, codeVerifier?, redirectUri }
app.post("/social/link/:provider", authenticate, async (req, res) => {
  const db = getDb(req);
  const { provider } = req.params;
  const exchange = SOCIAL_EXCHANGERS[provider];
  const fields = SOCIAL_FIELDS[provider];
  if (!exchange || !fields) {
    return res.status(404).json({ error: "unsupported_provider" });
  }

  const { code, codeVerifier, redirectUri } = req.body ?? {};
  if (!code || !redirectUri) {
    return res.status(400).json({ error: "code and redirectUri are required" });
  }

  try {
    const { id, handle } = await exchange({ code, codeVerifier, redirectUri });

    // Enforce one social account → one user.
    const existing = await db
      .collection("users")
      .where(fields.idField, "==", id)
      .limit(1)
      .get();
    if (!existing.empty && existing.docs[0].id !== req.uid) {
      return res.status(409).json({ error: "already_linked" });
    }

    await db
      .collection("users")
      .doc(req.uid)
      .set({ [fields.idField]: id, [fields.handleField]: handle }, { merge: true });

    res.json({ id, handle });
  } catch (err) {
    if (err instanceof LinkError) {
      console.error(`link/${provider} error:`, err.code);
      return res.status(err.status).json({ error: err.code });
    }
    console.error(`link/${provider} error:`, err);
    res.status(500).json({ error: "internal" });
  }
});

// POST /social/unlink/:provider
app.post("/social/unlink/:provider", authenticate, async (req, res) => {
  const db = getDb(req);
  const { provider } = req.params;
  const fields = SOCIAL_FIELDS[provider];
  if (!fields) return res.status(404).json({ error: "unsupported_provider" });
  try {
    await db.collection("users").doc(req.uid).update({
      [fields.idField]: FieldValue.delete(),
      [fields.handleField]: FieldValue.delete(),
    });
    res.json({ success: true });
  } catch (err) {
    console.error(`unlink/${provider} error:`, err);
    res.status(500).json({ error: err.message });
  }
});

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
const USE_LEGACY_MATCHING = false;

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

    const pickup = gp(reqData.origin);
    const dropoff = gp(reqData.destinationCoords);
    if (!pickup || !dropoff) return res.status(400).json({ error: "request missing coordinates" });
    const seatsNeeded = Number(reqData.seatsRequested) || 1;
    const passengerName = reqData.passengerName || "A passenger";
    const destLabel = reqData.destination || "their destination";
    const originLabel = reqData.originLabel || "Votre position";
    const rideKm = haversineKmLatLng(pickup, dropoff);
    const pricing = await getPricing(db);
    const earningsCents = Math.max(
      Math.round(rideKm * pricing.driverRateCentsPerKm),
      pricing.minimumChargeCents,
    );

    // Drivers already reached, so the availability pass never double-notifies.
    const notifiedDriverIds = new Set();
    // Drivers this passenger already passed on (swiped left) — don't re-notify.
    const rejectedDrivers = new Set(
      Array.isArray(reqData.rejectedDrivers) ? reqData.rejectedDrivers : [],
    );

    const pushToDriver = async (driverId, driverDest, driverDestCoords, seatsAvailable) => {
      if (driverId === req.uid || notifiedDriverIds.has(driverId) || rejectedDrivers.has(driverId)) return false;
      const { token, lang } = await getUserPushInfo(driverId, db);
      if (!token) return false;
      notifiedDriverIds.add(driverId);
      const isFr = lang === "fr";
      await sendPushNotification(
        token,
        isFr
          ? `🚗 ${passengerName} cherche un lift — +${formatFrCA(earningsCents)}`
          : `🚗 ${passengerName} wants a lift — +${formatFrCA(earningsCents)}`,
        driverMotivationalBody(earningsCents, requestId, lang),
        {
          type: "passenger_request",
          requestId,
          riderId: reqData.passengerId,
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
      return true;
    };

    let notified = 0;
    // Drivers heading the passenger's direction (phase 1). The fallback only
    // fires when this stays below MIN_DIRECTION_MATCHES.
    let directionMatches = 0;

    // ── TEMPORARY broadcast dispatch ─────────────────────────────────────────
    // Notify every user with driver mode ON, ignoring proximity / windows /
    // destination. Absent driverModeEnabled is treated as ON so existing users
    // stay reachable without a migration. (Full-collection scan — intentionally
    // simple and non-scalable; the legacy matching below is kept for later.)
    if (!USE_LEGACY_MATCHING) {
      const usersSnap = await db.collection("users").get();
      await Promise.all(
        usersSnap.docs.map(async (doc) => {
          if (doc.id === req.uid) return;
          const u = doc.data() || {};
          if (u.driverModeEnabled === false) return;
          if (await pushToDriver(doc.id, "", null, 4)) notified += 1;
        }),
      );
      return res.json({ notified, directionMatches: notified });
    }

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

    // TEMPORARY: while broadcast dispatch is active, the reachable count is simply
    // every user with driver mode ON (absent = ON), minus the requester.
    if (!USE_LEGACY_MATCHING) {
      const usersSnap = await db.collection("users").get();
      let enabled = 0;
      usersSnap.docs.forEach((doc) => {
        if (doc.id === req.uid) return;
        const u = doc.data() || {};
        if (u.driverModeEnabled === false) return;
        enabled += 1;
      });
      return res.json({ count: enabled, directionCount: enabled, reachableCount: enabled });
    }

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
  } catch (err) {
    console.error("drivers/available error:", err);
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
  const env = req.headers["x-app-env"] === "dev" ? "dev" : "prod";
  // Debug traces only in dev; production stays quiet (errors still log below).
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
        return { error: 404 };
      }
      const reqData = reqSnap.data();
      if (reqData.status !== "open") {
        dbg("[ACCEPT-DEBUG] request not open, status:", reqData.status);
        return { error: 409 }; // another driver won
      }

      const seatsNeeded = Number(reqData.seatsRequested) || 1;
      const passengerId = reqData.passengerId;
      const pickup = reqData.origin;                 // GeoPoint
      const dropoff = reqData.destinationCoords;      // GeoPoint

      // Guard: a request must carry a valid pickup so the driver map can plot it.
      // Without this a missing/undefined origin would write an unusable entry the
      // client filters out, leaving the driver with no passenger marker.
      if (!(pickup instanceof GeoPoint)) {
        console.warn("requests/accept: request missing valid origin GeoPoint", requestId);
        return { error: 400 };
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
        if (capacity < seatsNeeded) return { error: 422 };
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
        // No live session: require the client's GPS origin + a destination.
        if (bodyOriginLat == null || bodyOriginLng == null) return { error: 400 };
        if (bodyDestLat == null || bodyDestLng == null) return { error: 400 };
        capacity = bodySeats != null ? bodySeats : 4;
        if (capacity < seatsNeeded) return { error: 422 };
        driverOrigin = new GeoPoint(bodyOriginLat, bodyOriginLng);
        driverDestCoords = new GeoPoint(bodyDestLat, bodyDestLng);
        driverDestLabel = bodyDestination || "";
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

    if (result.error === 404) return res.status(404).json({ error: "request not found" });
    if (result.error === 409) return res.status(409).json({ error: "already taken" });
    if (result.error === 400) return res.status(400).json({ error: "driver origin/destination required" });
    if (result.error === 422) return res.status(422).json({ error: "not enough seats" });

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
function evaluateDropoff(ride, passengerId, driverLat, driverLng) {
  let lat = Number(driverLat);
  let lng = Number(driverLng);
  if (!Number.isFinite(lat) || !Number.isFinite(lng)) {
    // Legacy client fallback — remove once app adoption is complete.
    const stored = gpLL(ride.driverLocation);
    if (!stored) return { ok: false, distanceKm: null, reason: "no_driver_location" };
    lat = stored.lat;
    lng = stored.lng;
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
    reason: ok ? null : "out_of_range",
  };
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
    await rideRef.update({
      qrToken: nonce,
      qrTokenExpiresAt: new Date(expiresAt).toISOString(),
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
      const snap = await tx.get(rideRef);
      if (!snap.exists) return { error: 404 };
      const ride = snap.data();
      if (ride.status !== "started") return { error: 409 };
      if (parsed.driverUid !== ride.driverId) return { error: "driver_mismatch" };
      if (!ride.qrToken || ride.qrToken !== parsed.nonce) return { error: "nonce" };
      const exp = Date.parse(ride.qrTokenExpiresAt || "");
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
      return { ok: true };
    });
    if (out.error === 404) return res.status(404).json({ error: "ride not found" });
    if (out.error === 409) return res.status(409).json({ error: "nothing to reject" });
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

      const dest = gpLL(ride.destinationCoords);
      const origin = gpLL(ride.localisation);
      const pickups = ride.passengerPickups || {};
      const charge = chargeablePassengers(ride);

      let totalPassengerCents = 0;
      const now = new Date().toISOString();
      for (const pid of charge) {
        const pu = gpLL(pickups[pid]) || origin;
        const distKm = (pu && dest)
          ? haversineKm(pu.lat, pu.lng, dest.lat, dest.lng)
          : 0;
        const cents = calculatePassengerChargeCents(distKm, pricing);
        totalPassengerCents += cents;
        const userRef = db.collection("users").doc(pid);
        tx.update(userRef, { pendingChargeCents: FieldValue.increment(cents) });
        tx.set(userRef.collection("transactions").doc(), {
          type: "ride_charge",
          amount: cents,
          status: "completed",
          description: `Ride to ${ride.destination || "destination"}`,
          createdAt: now,
          rideId,
          distanceKm: Math.round(distKm * 10) / 10,
        });
      }

      const driverEarningsCents = Math.round(
        totalPassengerCents * (pricing.driverRateCentsPerKm / pricing.passengerRateCentsPerKm),
      );
      if (driverEarningsCents > 0) {
        const driverRef = db.collection("users").doc(ride.driverId);
        tx.update(driverRef, { pendingEarningsCents: FieldValue.increment(driverEarningsCents) });
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
      return { ok: true, charged: charge.length, totalPassengerCents, driverEarningsCents };
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
      const curRating = Number(d.ratings) || 0;
      const weight = Number(d.ratingWeigth) || 0;
      const newRating = Math.round(((curRating * weight) + s) / (weight + 1));

      tx.update(driverRef, {
        ratings: newRating,
        ratingWeigth: weight + 1,
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
      return { ok: true, driverId };
    });
    if (out.error === 404) return res.status(404).json({ error: "ride not found" });
    if (out.error === 403) return res.status(403).json({ error: "not eligible to rate" });
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
      const affected = Array.isArray(ride.passengers) ? ride.passengers.slice() : [];
      tx.update(rideRef, { status: "cancelled", passengers: [], joinRequests: {} });
      return { ok: true, affected };
    });
    if (out.error === 404) return res.status(404).json({ error: "ride not found" });
    if (out.error === 403) return res.status(403).json({ error: "not the ride driver" });
    if (out.error === 409) return res.status(409).json({ error: "ride already completed" });
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
      return { ok: true, driverId: ride.driverId };
    });
    if (out.error === 404) return res.status(404).json({ error: "ride not found" });
    if (out.error === 409) return res.status(409).json({ error: "cannot leave after boarding/start" });
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
// - rides `paymentStatus:"processing"` past PROC_TTL_MS  → reset to pending (retryable)
// - rides `started` past the 3h live window              → expired (abandoned)
const REQUEST_TTL_MS = 15 * 60 * 1000;
const PLANNED_TTL_MS = 30 * 60 * 1000;
const PROC_TTL_MS = 2 * 60 * 1000;

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
  const summary = { requestsExpired: 0, plannedExpired: 0, processingReset: 0, startedExpired: 0, matchesExpired: 0 };

  // 1. Open ride requests past their TTL.
  const openReqs = await db.collection("rideRequests").where("status", "==", "open").get();
  await Promise.all(openReqs.docs.map(async (doc) => {
    const age = ageMs(doc.data().createdAt);
    if (age == null || age < REQUEST_TTL_MS) return;
    await doc.ref.update({ status: "expired" });
    summary.requestsExpired += 1;
    await pushTo(
      doc.data().passengerId, db,
      "Aucun chauffeur trouvé", "No driver found",
      "Aucun chauffeur n'a répondu à ta demande. Réessaie quand tu veux.",
      "No driver responded to your request. Try again anytime.",
      { type: "request_expired" },
    );
  }));

  // 2. Planned rides never started.
  const planned = await db.collection("rides").where("status", "==", "planned").get();
  await Promise.all(planned.docs.map(async (doc) => {
    const r = doc.data();
    const age = ageMs(r.createdAt || r.date);
    if (age == null || age < PLANNED_TTL_MS) return;
    await doc.ref.update({ status: "expired", passengers: [], joinRequests: {} });
    summary.plannedExpired += 1;
    await Promise.all((Array.isArray(r.passengers) ? r.passengers : []).map((pid) => pushTo(
      pid, db,
      "Trajet expiré", "Ride expired",
      "Le chauffeur n'a jamais démarré le trajet. Ouvre l'app pour un autre lift.",
      "The driver never started the ride. Open the app for another lift.",
      { type: "ride_expired", rideId: doc.id },
    )));
  }));

  // 3. Payment stuck in "processing".
  // Nothing writes "processing" any more — it was the non-atomic lock held by the
  // removed /rides/complete route (/rides/finish does the whole charge in one
  // transaction). Kept for a release or two to unwedge docs already stuck in it.
  // TODO: delete once no ride doc has paymentStatus == "processing".
  const processing = await db.collection("rides").where("paymentStatus", "==", "processing").get();
  await Promise.all(processing.docs.map(async (doc) => {
    const age = ageMs(doc.data().processingAt);
    // If no processingAt (legacy), still reset conservatively after the window.
    if (age != null && age < PROC_TTL_MS) return;
    await doc.ref.update({ paymentStatus: "pending" });
    summary.processingReset += 1;
  }));

  // 4. Started rides abandoned past the 3h live window.
  const started = await db.collection("rides").where("status", "==", "started").get();
  await Promise.all(started.docs.map(async (doc) => {
    const age = ageMs(doc.data().startedAt);
    if (age == null || age < RIDE_LIVE_WINDOW_MS) return;
    await doc.ref.update({ status: "expired" });
    summary.startedExpired += 1;
  }));

  // 5. Matches the passenger never confirmed past the confirm window. Tear the
  //    match down (free the seat, cancel the empty ride) and re-open the request
  //    so the passenger's search resumes and the driver is unblocked.
  const unconfirmed = await db.collection("rides").where("status", "==", "planned").get();
  await Promise.all(unconfirmed.docs.map(async (doc) => {
    const r = doc.data();
    const pending = Array.isArray(r.pendingConfirmation) ? r.pendingConfirmation : [];
    if (pending.length === 0) return;
    const deadline = r.confirmDeadlineAt;
    const expired = deadline && typeof deadline.toMillis === "function"
      ? Date.now() > deadline.toMillis()
      : (ageMs(r.createdAt) ?? 0) > CONFIRM_WINDOW_MS;
    if (!expired) return;

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
    await doc.ref.update(update);

    if (r.requestId) {
      await db.collection("rideRequests").doc(r.requestId).update({
        status: "open",
        matchedRideId: FieldValue.delete(),
        matchedDriverId: FieldValue.delete(),
        matchedAt: FieldValue.delete(),
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
  }));

  return summary;
}

exports.sweepStaleRides = onSchedule(
  { schedule: "every 5 minutes", timeZone: "America/Toronto" },
  async () => {
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
// rollout — flip to prodDb/stripeLive at cutover). Charges accumulated
// pendingChargeCents off-session; driver payout stays a ledger stub until
// Stripe Connect lands.
exports.monthlyBilling = onSchedule(
  { schedule: "0 3 1 * *", timeZone: "America/Toronto" },
  async () => {
    try {
      const charged = await chargeAllPassengers(TARGET_DB, TARGET_STRIPE);
      const paid = await payoutAllDrivers(TARGET_DB);
      console.log("monthlyBilling:", JSON.stringify({ charged: charged.length, paid: paid.length }));
    } catch (err) {
      console.error("monthlyBilling error:", err);
    }
  },
);
