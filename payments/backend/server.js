// Minimal Tap to Pay backend. The Android app NEVER sees the secret key — it only calls
// these endpoints. Deploy this anywhere (Render, Railway, Fly.io, a VPS) over HTTPS.
const express = require("express");
const Stripe = require("stripe");

const secret = process.env.STRIPE_SECRET_KEY;
if (!secret) { console.error("Set STRIPE_SECRET_KEY (see .env.example)"); }
const stripe = Stripe(secret || "sk_test_missing");
const app = express();
app.use(express.json());

// Health check
app.get("/", (_req, res) => res.send("Tap to Pay backend OK"));

// 1) The Terminal SDK calls this (via the app) to get a short-lived connection token.
app.post("/connection_token", async (_req, res) => {
  try {
    const token = await stripe.terminal.connectionTokens.create();
    res.json({ secret: token.secret });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

// 2) Create a PaymentIntent for an in-person (card_present) charge.
//    amount is in the minor unit (grosze for PLN): 10.00 PLN -> 1000.
app.post("/create_payment_intent", async (req, res) => {
  try {
    const amount = Math.round(Number(req.body.amount));
    const currency = (req.body.currency || "pln").toLowerCase();
    if (!Number.isFinite(amount) || amount <= 0) return res.status(400).json({ error: "bad amount" });
    const pi = await stripe.paymentIntents.create({
      amount,
      currency,
      payment_method_types: ["card_present"],
      capture_method: "automatic",
      description: req.body.description || undefined,
    });
    res.json({ id: pi.id, client_secret: pi.client_secret });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

// 3) Run ONCE to create the Location that Tap to Pay requires, then copy its id into the app.
app.post("/create_location", async (req, res) => {
  try {
    const loc = await stripe.terminal.locations.create({
      display_name: req.body.display_name || "My Shop",
      address: req.body.address || { line1: "ul. Przykladowa 1", city: "Warszawa", country: "PL", postal_code: "00-001" },
    });
    res.json({ id: loc.id, display_name: loc.display_name });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

const port = process.env.PORT || 4242;
app.listen(port, () => console.log("Tap to Pay backend listening on " + port));
