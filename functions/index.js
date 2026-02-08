const functions = require("firebase-functions");
const express = require("express");
const stripe = require('stripe')('sk_test_51STT8xLp2qE85Ber5F37hcmYkBOyy3U9ysK3jhFgRDYapZNl35767q4ZErC6cMJeaj7RbLqGqkduk0CURk4RGHZZ00tNN92Gnc');

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
      currency: 'cad',
      customer: customer.id,
      automatic_payment_methods: { enabled: true },
    });

    // 4. Send secrets to mobile app
    res.json({
      paymentIntent: paymentIntent.client_secret,
      ephemeralKey: ephemeralKey.secret,
      customer: customer.id,
      publishableKey: 'pk_test_51STT8xLp2qE85BeryLOWyCzhPYDoRJDXOYpGcuJUG5aQsPfkQ4grzZgtiqxQJuNoxSEHEpaTYjkXJrpCvcHWnzQu00nZkvFDFD'
    });

  } catch (err) {
    console.log(err);
    res.status(400).json({ error: err.message });
  }
 
});

// Export as a Firebase Function 
// firebase deploy --only functions
exports.api = functions.https.onRequest(app);