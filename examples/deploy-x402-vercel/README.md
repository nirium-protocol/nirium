# x402-Protected API Template (Deploy to Vercel)

[![Deploy with Vercel](https://vercel.com/button)](https://vercel.com/new/clone?repository-url=https%3A%2F%2Fgithub.com%2Fnirium-protocol%2Fnirium-sdk%2Ftree%2Fmain%2Fexamples%2Fdeploy-x402-vercel&env=PAY_TO,NETWORK&envDescription=Stellar%20public%20key%20(G...)%20to%20receive%20payments%20and%20network&envLink=https%3A%2F%2Fnirium.xyz%2Fdocs)

A minimal, zero-config template for deploying pay-per-request APIs protected by the **x402 protocol** and **Nirium SDK** on Vercel.

---

## What Just Happened?

1. **One-Click Deployment**: Clicking the button above deploys a live Next.js API server directly to your Vercel account.
2. **Environment Configuration**: Prompts only for your Stellar wallet address (`PAY_TO`) and Stellar network (`NETWORK`).
3. **Automated Monetization**: The `/api/ascii` endpoint immediately enforces $0.01 USDC x402 micropayments per request without database or complex middleware setups.

---

## Demo Route

- **`GET /api/ascii`**: A fun ASCII art generator (Cat, Owl, Robot, Rocket) behind x402 payment protection.
- **Rules out financial data**: This template is designed purely for utility/demo services and contains no investment, trading, or market signal logic.

---

## Replay/rate-limit protection (on by default in this template)

`x402Serve()` on its own verifies and settles a payment; it does not stop the same payment proof from being replayed, and it does not rate-limit callers - see [nirium-protocol/nirium#91](https://github.com/nirium-protocol/nirium/issues/91). This template turns both on via `x402Serve()`'s `guard` config, using `lib/x402-guard-memory-store.ts` (a plain in-memory store):

```ts
const serveMiddleware = x402Serve({
  payTo, network,
  routes: { [resource]: { price: priceUsdc, description } },
  guard: {
    store: defaultGuardStore,                    // in-memory here, swap for Upstash below
    rateLimit: { max: 30, windowMs: 60_000 },     // 30 req/min per IP
  },
});
```

A reused `PAYMENT-SIGNATURE` header against the same route gets `409 payment_replayed`; too many requests from one IP get `429 rate_limited`; if the guard's store is down, requests with a payment proof get `503` rather than being let through unprotected.

**The in-memory store is a demo convenience, not production-durable**: Vercel serverless functions aren't guaranteed to reuse the same process between requests, so a replay hitting a different instance than the original won't be caught. For real production use, swap it for Upstash (the store `nirium` ships a reference adapter for):

```ts
import { createUpstashX402GuardStore } from "nirium";

const store = createUpstashX402GuardStore({
  url: process.env.UPSTASH_REDIS_REST_URL!,
  token: process.env.UPSTASH_REDIS_REST_TOKEN!,
});
```

Pass `guard: false` in a route's config to disable it entirely, or set `GUARD_STORE=none` to disable the template's default in-memory store globally.

---

## Testing Your Live Deployment

### 1. Request without payment (402 Payment Required)

```bash
curl -i https://<your-vercel-domain>.vercel.app/api/ascii
```

**Response:**
```http
HTTP/2 402
x-accept-payment: x402
content-type: application/json

{
  "x402Version": 1,
  "accepts": [
    {
      "scheme": "exact",
      "network": "stellar:testnet",
      "asset": "USDC",
      "payTo": "GBRPYHIL2CI3FNQ4BXLFMNDLFJUNPU2HY3ZMFXYSFZUKW3T2TRWECCHX",
      "maxAmountRequired": "$0.01",
      "resource": "/api/ascii",
      "description": "Paid ASCII Art Generator Endpoint"
    }
  ],
  "error": "Payment required via x402 protocol"
}
```

### 2. Request with x402 payment (200 OK)

Using Nirium CLI or TypeScript SDK to settle payment:

```bash
# Using Nirium CLI
nirium pay https://<your-vercel-domain>.vercel.app/api/ascii?style=cat

# Or attaching a valid PAYMENT-SIGNATURE header via x402 client
curl -i -H "PAYMENT-SIGNATURE: <valid_payment_signature>" https://<your-vercel-domain>.vercel.app/api/ascii?style=cat
```

**Response:**
```http
HTTP/2 200 OK
content-type: application/json

{
  "ok": true,
  "service": "x402 ASCII Art Generator",
  "style": "cat",
  "art": "\n /\\_/\\ \n( o.o )\n > ^ < \n",
  "timestamp": "2026-08-23T18:00:00.000Z"
}
```

---

## Running Locally

```bash
npm install
npm run test    # Run smoke tests
npm run dev     # Start Next.js local server on http://localhost:3000
```
