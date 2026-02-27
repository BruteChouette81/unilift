const functions = require("firebase-functions");
const express = require("express");

const STRIPE_SECRET_KEY = process.env.STRIPE_SECRET_KEY;
const STRIPE_PUBLISHABLE_KEY = process.env.STRIPE_PUBLISHABLE_KEY;

if (!STRIPE_SECRET_KEY || !STRIPE_PUBLISHABLE_KEY) {
  throw new Error(
    "Missing Stripe function env vars: STRIPE_SECRET_KEY and STRIPE_PUBLISHABLE_KEY",
  );
}

const stripe = require("stripe")(STRIPE_SECRET_KEY);

const app = express();

// Your old server.js routes here
app.get("/hello", (req, res) => {
  res.send("Hello world!");
});

// This example sets up an endpoint using the Express framework.

app.post('/payment-sheet', async (req, res) => {
  // Use an existing Customer ID if this is a returning customer.
  try {
    // 1. Create or fetch a customer
    const customer = await stripe.customers.create();

    // 2. Create ephemeral key (required for mobile)
    const ephemeralKey = await stripe.ephemeralKeys.create(
      { customer: customer.id },
      { apiVersion: "2024-06-20" }   // must match stripe-react-native SDK version
    );

    // 3. Create PaymentIntent
    const paymentIntent = await stripe.paymentIntents.create({
      amount: 1099,
      currency: "cad",
      customer: customer.id,
      automatic_payment_methods: { enabled: true },
    });

    // 4. Send secrets to mobile app
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

// Export as a Firebase Function 
// firebase deploy --only functions
exports.api = functions.https.onRequest(app);
