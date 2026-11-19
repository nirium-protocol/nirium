# Fastify x402 example

One paid [Fastify](https://fastify.dev) route on Stellar testnet, charged by nirium's `x402Serve()`. It is the same route as [`examples/express-x402`](../express-x402) (`GET /paid/market-summary`, `0.02` USDC):

- no payment: HTTP `402 Payment Required` with the x402 payment requirements
- a paid request from `initX402`/`x402Fetch`: the payment settles on Stellar testnet and the route returns HTTP `200`

Testnet only. No real funds, no mainnet, no custody: every key stays with whoever owns it.

## Why there is an adapter

`x402Serve()` returns **Express middleware**, `(req, res, next)`. It reads Express's `req` (`path`, `originalUrl`, `header()`, `protocol`, `query`...) and writes through Express's `res` (`status().json()`, `setHeader`, `getHeaders`, `writeHead/write/end`). Fastify has its own `request`/`reply` objects, and its hook and handler lifecycle is not Express's `next()` chain. So `x402Serve()` cannot be registered with `app.addHook()` or used as a plugin as it is.

Rewriting the payment logic for Fastify would risk drifting from what `x402Serve()` guarantees. Instead, [`src/express-shim.ts`](./src/express-shim.ts) (about 150 lines, no x402 logic in it) does two things:

1. builds just enough of an Express `req`/`res` from the Fastify request (converted to a web `Request`);
2. turns what the middleware writes back into a `Response`, which is then sent with `reply`.

The part that matters is the second one. The payment guard in `@x402/express` does not just answer `402`. After a valid payment it **temporarily replaces `res.writeHead/write/end`** to hold your handler's response back, settles the payment on the facilitator, and only then releases the response (and skips settlement if the handler answers with a 4xx/5xx). The adapter's `res` therefore behaves like Node's, and your handler's response is written *through* the middleware instead of around it. That is how `x402Serve()`'s exact guard and settlement behavior are preserved.

`x402Paywall()` in [`src/server.ts`](./src/server.ts) is the Fastify side. It wraps a route handler that returns the JSON body:

```ts
app.get('/paid/market-summary', paid(async () => ({ ... })))
```

It wraps the handler (rather than being a `preHandler` hook) because settlement has to happen between your handler producing its response and that response being sent.

Good to know:

- Responses on the paid route are buffered until settlement, exactly as with `@x402/express` on Express. Do not put streaming responses behind it.
- The adapter is scoped to the route you wrap (like the Express example's route-level middleware), so `/health` stays free.
- `x402Serve()` itself is untouched. This example imports it from the published `nirium` package.

## Files

- `src/server.ts` - Fastify app, `x402Paywall()` and the `x402Serve()` setup.
- `src/express-shim.ts` - the adapter.
- `test/server.test.ts` - offline tests for the `402` and `200` paths.
- `scripts/setup-testnet-accounts.ts` - generates and funds your own testnet accounts.
- `scripts/testnet-proof.ts` - the live testnet run.
- `.env.example` - configuration template.

## Setup

Needs Node.js >= 22.12.

```bash
cd examples/fastify-x402
cp .env.example .env
npm install
```

### Your own testnet keys (no committed secrets)

```bash
npm run testnet:setup
```

This generates a seller and a buyer keypair (only if `SELLER_SECRET`/`BUYER_SECRET` are empty in `.env`), writes them to your local, gitignored `.env`, fills in `X402_SELLER_ADDRESS` with the seller's public address, funds both accounts with XLM through [Friendbot](https://friendbot.stellar.org), and opens a USDC trustline on both. It never prints secret keys. Then two manual steps:

1. Get testnet USDC for the **buyer** address at <https://faucet.circle.com> (USDC, network: Stellar Testnet). It is behind a captcha, so the script cannot do it.
2. Get a free testnet facilitator key at <https://channels.openzeppelin.com/testnet/gen> and put it in `.env` as `FACILITATOR_API_KEY`. `x402Serve()` requires one even on testnet.

Never use a key someone gave you, never use a mainnet key, and never commit `.env`.

## Run

```bash
npm run dev
```

The server starts on `http://localhost:3402`.

| Variable | Default | Purpose |
| --- | --- | --- |
| `PORT` | `3402` | Local port. |
| `X402_PRICE` | `0.02` | Price for the protected request, in USDC. |
| `X402_NETWORK` | `stellar:testnet` | x402 network identifier. |
| `X402_SELLER_ADDRESS` | (from `testnet:setup`) | Public address that receives payments. |
| `FACILITATOR_API_KEY` | (required) | OpenZeppelin Channels testnet key. Server-side only. |
| `X402_FACILITATOR_URL` | OpenZeppelin Channels testnet | Optional facilitator override. |

### Check the unpaid response

```bash
curl -i http://localhost:3402/paid/market-summary
```

Expected: HTTP `402` with a `payment-required` header carrying the x402 payment requirements.

### Paid request with `initX402`

```ts
import { Agent } from 'nirium'

const agent = new Agent({ apiKey: 'demo', baseUrl: 'http://localhost:3402' })
agent.initX402({ secretKey: process.env.BUYER_SECRET!, network: 'stellar:testnet' })

const response = await agent.x402Fetch('http://localhost:3402/paid/market-summary')
console.log(response.status, await response.json())
```

Expected: HTTP `200` and the protected JSON. Or let the script do the whole flow (starts the server, checks the `402`, pays, checks the `200`, prints the transaction link):

```bash
npm run testnet:proof
```

## Tests (offline)

```bash
npm test
```

No socket and no network. Requests go through `app.inject()`, and `fetch` is replaced with a stub that only answers a mock facilitator and throws for anything else. `x402Serve()`, `@x402/express` and `@x402/core` run for real, so the tests exercise the actual guard and settlement code; only the facilitator's HTTP answers are mocked. They cover:

- unpaid request -> `402`, correct payment requirements, no paid body
- paid request -> `200`, paid body, `verify` then `settle`, receipt in the `payment-response` header
- facilitator rejects the payment -> `402`, no paid body, never settled
- settlement fails -> paid body withheld
- free routes stay free; bad `payTo` still throws at mount

The real signed payment is what `npm run testnet:proof` is for.

## Testnet evidence

> **TODO before merging:** run `npm run testnet:proof` with your own keys and replace the placeholders below with the real values. Delete this note afterwards.

| Step | Network | Transaction |
| --- | --- | --- |
| Paid `GET /paid/market-summary` via `initX402`, HTTP `200` | `stellar:testnet` | [`REPLACE_WITH_TX_HASH`](https://stellar.expert/explorer/testnet/tx/REPLACE_WITH_TX_HASH) |

- Buyer (payer): `REPLACE_WITH_BUYER_PUBLIC_ADDRESS` ([account](https://stellar.expert/explorer/testnet/account/REPLACE_WITH_BUYER_PUBLIC_ADDRESS))
- Seller (`payTo`): `REPLACE_WITH_SELLER_PUBLIC_ADDRESS` ([account](https://stellar.expert/explorer/testnet/account/REPLACE_WITH_SELLER_PUBLIC_ADDRESS))

Both accounts are self-generated testnet keys; no secret is committed.
