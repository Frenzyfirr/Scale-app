# Tap to Pay backend

Tiny server that holds your Stripe **secret key** and gives the Android app what it needs.
The app never sees the secret key.

## Run locally
```bash
cd payments/backend
cp .env.example .env         # put your sk_test_... in it
npm install
npm start                    # listens on :4242
```

## Endpoints
- `POST /connection_token` → `{ "secret": "..." }` (the Terminal SDK needs this)
- `POST /create_payment_intent` body `{ "amount": 1000, "currency": "pln", "description": "..." }`
  → `{ "id": "...", "client_secret": "..." }`  (amount is in **grosze**: 1000 = 10.00 PLN)
- `POST /create_location` → run **once** to make the Location Tap to Pay requires; copy the `id`.

## Deploy (so the phone can reach it over HTTPS)
Any Node host works — Render, Railway, Fly.io, or your own VPS behind HTTPS.
Set the env var `STRIPE_SECRET_KEY`. Note the public URL; you'll paste it into the app.

Use **test keys** (`sk_test_…`) until everything works, then switch to live keys.
