const functions = require("firebase-functions");
const express = require("express");
const admin = require("firebase-admin");

const STRIPE_SECRET_KEY = "sk_test_51STT8xLp2qE85Ber5F37hcmYkBOyy3U9ysK3jhFgRDYapZNl35767q4ZErC6cMJeaj7RbLqGqkduk0CURk4RGHZZ00tNN92Gnc"
const STRIPE_PUBLISHABLE_KEY = "pk_test_51STT8xLp2qE85BeryLOWyCzhPYDoRJDXOYpGcuJUG5aQsPfkQ4grzZgtiqxQJuNoxSEHEpaTYjkXJrpCvcHWnzQu00nZkvFDFD";

if (!STRIPE_SECRET_KEY || !STRIPE_PUBLISHABLE_KEY) {
  throw new Error(
    "Missing Stripe function env vars: STRIPE_SECRET_KEY and STRIPE_PUBLISHABLE_KEY",
  );
}

// firebase deploy --only functions

admin.initializeApp();
const db = admin.firestore();
db.settings({ databaseId: "uniliftdefault" });

const stripe = require("stripe")(STRIPE_SECRET_KEY);

const app = express();

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

// ── Helper: get or create Stripe customer ────────────────────────────────────
async function getOrCreateCustomer(uid) {
  console.log("Getting or creating Stripe customer for UID:", uid);
  const userRef = db.collection("users").doc(uid);
  const snap = await userRef.get();
  const data = snap.data() ?? {};
  console.log("User data:", data);

  if (data.stripeCustomerId) {
    return data.stripeCustomerId;
  }

  const customer = await stripe.customers.create({ metadata: { firebaseUid: uid } });
  await userRef.set({ stripeCustomerId: customer.id }, { merge: true });
  return customer.id;
}

// ── Existing routes (keep unchanged) ────────────────────────────────────────
app.get("/hello", (req, res) => {
  res.send("Hello world!");
});

app.post("/payment-sheet", async (req, res) => {
  try {
    const customer = await stripe.customers.create();
    const ephemeralKey = await stripe.ephemeralKeys.create(
      { customer: customer.id },
      { apiVersion: "2024-06-20" }
    );
    const paymentIntent = await stripe.paymentIntents.create({
      amount: 1099,
      currency: "cad",
      customer: customer.id,
      automatic_payment_methods: { enabled: true },
    });
    res.json({
      paymentIntent: paymentIntent.client_secret,
      ephemeralKey: ephemeralKey.secret,
      customer: customer.id,
      publishableKey: STRIPE_PUBLISHABLE_KEY,
    });
  } catch (err) {
    console.log(err);
    res.status(400).json({ error: err.message });
  }
});

// ── Wallet: Setup ────────────────────────────────────────────────────────────
app.post("/wallet/setup", authenticate, async (req, res) => {
  console.log("Setting up wallet for UID:", req.uid);
  try {
    const customerId = await getOrCreateCustomer(req.uid);
    const ephemeralKey = await stripe.ephemeralKeys.create(
      { customer: customerId },
      { apiVersion: "2024-06-20" }
    );
    const snap = await db.collection("users").doc(req.uid).get();
    const balance = (snap.data() ?? {}).walletBalance ?? 0;
    res.json({ customerId, ephemeralKey: ephemeralKey.secret, balance });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: err.message });
  }
});

// ── Wallet: Add Funds ────────────────────────────────────────────────────────
app.post("/wallet/add-funds", authenticate, async (req, res) => {
  try {
    const { amountCents } = req.body;
    if (!amountCents || amountCents < 1000) {
      return res.status(400).json({ error: "Minimum amount is $10 (1000 cents)" });
    }
    const customerId = await getOrCreateCustomer(req.uid);
    const ephemeralKey = await stripe.ephemeralKeys.create(
      { customer: customerId },
      { apiVersion: "2024-06-20" }
    );
    const paymentIntent = await stripe.paymentIntents.create({
      amount: amountCents,
      currency: "cad",
      customer: customerId,
      automatic_payment_methods: { enabled: true },
    });
    res.json({
      clientSecret: paymentIntent.client_secret,
      customerId,
      ephemeralKey: ephemeralKey.secret,
    });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: err.message });
  }
});

// ── Wallet: Confirm Payment ──────────────────────────────────────────────────
app.post("/wallet/confirm", authenticate, async (req, res) => {
  try {
    const { paymentIntentId } = req.body;
    if (!paymentIntentId) {
      return res.status(400).json({ error: "paymentIntentId is required" });
    }

    const paymentIntent = await stripe.paymentIntents.retrieve(paymentIntentId);
    if (paymentIntent.status !== "succeeded") {
      return res.status(400).json({ error: "Payment has not succeeded" });
    }

    const userRef = db.collection("users").doc(req.uid);
    const txRef = userRef.collection("transactions").doc();

    let newBalance;
    await db.runTransaction(async (t) => {
      // Check for duplicate credit
      const existing = await t.get(
        userRef.collection("transactions").where("stripePaymentIntentId", "==", paymentIntentId).limit(1)
      );
      if (!existing.empty) {
        const snap = await t.get(userRef);
        newBalance = (snap.data() ?? {}).walletBalance ?? 0;
        return;
      }

      const userSnap = await t.get(userRef);
      const currentBalance = (userSnap.data() ?? {}).walletBalance ?? 0;
      newBalance = currentBalance + paymentIntent.amount;

      t.update(userRef, { walletBalance: newBalance });
      t.set(txRef, {
        type: "topup",
        amount: paymentIntent.amount,
        status: "completed",
        description: `Top-up $${(paymentIntent.amount / 100).toFixed(2)}`,
        createdAt: new Date().toISOString(),
        stripePaymentIntentId: paymentIntentId,
      });
    });

    res.json({ balance: newBalance });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: err.message });
  }
});

// ── Wallet: Cash Out ─────────────────────────────────────────────────────────
app.post("/wallet/cashout", authenticate, async (req, res) => {
  try {
    const { amountCents } = req.body;
    if (!amountCents || amountCents < 1000) {
      return res.status(400).json({ error: "Minimum cashout is $10 (1000 cents)" });
    }

    const userRef = db.collection("users").doc(req.uid);
    const txRef = userRef.collection("transactions").doc();
    let newBalance;
    let transactionId = txRef.id;

    await db.runTransaction(async (t) => {
      const snap = await t.get(userRef);
      const currentBalance = (snap.data() ?? {}).walletBalance ?? 0;
      if (currentBalance < amountCents) {
        throw new Error("Insufficient balance");
      }
      newBalance = currentBalance - amountCents;
      t.update(userRef, { walletBalance: newBalance });
      t.set(txRef, {
        type: "cashout",
        amount: amountCents,
        status: "pending",
        description: `Cashout $${(amountCents / 100).toFixed(2)}`,
        createdAt: new Date().toISOString(),
      });
    });

    res.json({ balance: newBalance, transactionId });
  } catch (err) {
    console.error(err);
    const status = err.message === "Insufficient balance" ? 400 : 500;
    res.status(status).json({ error: err.message });
  }
});

// ── Wallet: Transactions ─────────────────────────────────────────────────────
app.get("/wallet/transactions", authenticate, async (req, res) => {
  try {
    const snap = await db
      .collection("users")
      .doc(req.uid)
      .collection("transactions")
      .orderBy("createdAt", "desc")
      .limit(20)
      .get();

    const transactions = snap.docs.map((doc) => ({ id: doc.id, ...doc.data() }));
    res.json({ transactions });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: err.message });
  }
});

// Export as a Firebase Function
// firebase deploy --only functions
exports.api = functions.https.onRequest(app);
