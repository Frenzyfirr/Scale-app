# TapPay — Stripe Tap to Pay on Android

Accept contactless card payments by tapping the customer's card/phone on **your** Android phone,
using Stripe Terminal's certified Tap to Pay. No extra hardware, no card data touched by your code —
Stripe's certified module handles the card; you just tell it the amount.

Poland (PLN) is supported. This repo has two parts:

```
payments/
  backend/   Node server that holds your Stripe secret key (deploy this)
  app/       Android merchant app (Stripe Terminal + Tap to Pay)
```

## How it fits together

```
 Android app  ──POST /connection_token──►  your backend ──►  Stripe
      │                                         │
      │◄──────── connection token ──────────────┘
      │
      │  (customer taps card — handled by Stripe's certified Tap to Pay module)
      │
      └──POST /create_payment_intent──► backend ──► Stripe ──► client_secret ──► SDK confirms
```

The secret key (`sk_...`) is **only** on the backend. The app only ever has your *publishable* key
context via the connection token, and never sees card data.

## Step‑by‑step

### 1. Stripe account
1. Create an account at dashboard.stripe.com and complete business activation (needed for live payments).
2. In the Dashboard, enable **Terminal** and request/enable **Tap to Pay on Android** for your account
   (Terminal → settings). Until Stripe enables Tap to Pay on your account, the SDK won't connect a reader.
3. Get your API keys (Developers → API keys). Use **test** keys (`sk_test_…`) first.

### 2. Backend
```bash
cd payments/backend
cp .env.example .env            # put STRIPE_SECRET_KEY=sk_test_... in it
npm install
npm start
```
Create your Location once and note the `id` (looks like `tml_…`):
```bash
curl -X POST http://localhost:4242/create_location \
  -H 'Content-Type: application/json' \
  -d '{"display_name":"My Shop"}'
```
Then **deploy** the backend somewhere with HTTPS (Render, Railway, Fly.io, a VPS). Note its public URL.

### 3. Android app
- Open `payments/app` in Android Studio (or let CI build it).
- Finalise the two Stripe Terminal 6.0.0 client calls against the official example
  (`github.com/stripe/stripe-terminal-android`, `example` module): the `Terminal` init and the
  Tap‑to‑Pay `connectReader` config (6.0.0 adds a `TapUseCase`). Everything else is wired.
- Install on a **compatible device** (see requirements below), open the app, enter your **backend URL**
  and **Location id**, tap **Connect**, then enter an amount and **Charge** — the customer taps their card.

### Device requirements (enforced by Stripe)
- Android **13+**, NFC, ARM‑based, **not rooted**, bootloader locked.
- **Developer options OFF**, Google Mobile Services (Play Store) present.
- Security patch within the last 12 months, stable internet.
- **Emulators are not supported** — you must test on a real, qualifying phone.
  (Most recent Samsung/Pixel/Xiaomi/Motorola models qualify.)

## Testing
- With **test** keys, use Stripe's test cards / test contactless flows (see
  docs.stripe.com/terminal/references/testing). Money isn't moved in test mode.
- Switch the backend to **live** keys only once the full flow works end to end.

## Fees & compliance
Stripe charges per‑transaction fees (see stripe.com/pricing for Poland). Stripe holds the PCI/EMV
certification for the Tap to Pay module, so you don't — but you're still a merchant handling payments,
so read Stripe's terms and your local tax/receipt obligations.
```
