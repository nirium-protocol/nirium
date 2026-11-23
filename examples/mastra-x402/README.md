# Mastra x402 tool (TypeScript)

A [Mastra](https://mastra.ai) tool that pays x402 endpoints through the Nirium
TypeScript SDK. It wraps `x402Fetch()` with a per-payment cap: when a server asks
for more than the cap, the SDK refuses before signing, and the tool returns that
refusal as a normal tool result so the agent can report it and stop instead of
crashing.

Testnet only. The seller is one you run, with your own `payTo`; no Nirium address
is involved and no key is ever sent anywhere.

## Files

| Path | What it is |
|---|---|
| `src/nirium-payer.ts` | `createNiriumPayer()`: builds an SDK `Agent` and calls `initX402({ maxAmountPerPayment })`. The cap lives here. |
| `src/nirium-tool.ts` | `createNiriumPayTool()`: the Mastra `createTool` wrapper around `payer.x402Fetch()`. |
| `src/agent.ts` | A Mastra `Agent` with the tool, and the instructions that tell it never to raise the cap. |
| `src/demo.ts` | Calls the tool twice with no LLM: one call under the cap, one over it. |
| `server/server.ts` | The seller: `x402Serve()` on Express with your own `payTo` and two routes, $0.02 and $2.00. |
| `test/nirium-tool.test.ts` | Offline tests. No network. |

## Versions tested

Pinned in `package.json`. Tested on Node.js 24.22.2 (the SDK requires >= 22.12).

| Package | Version |
|---|---|
| `@mastra/core` | 1.85.0 |
| `nirium` | 0.19.8 (`file:../../packages/sdk`) |
| `@stellar/stellar-sdk` | 16.3.0 |
| `@x402/core`, `@x402/express`, `@x402/stellar`, `@x402/extensions` | 2.28.0 |
| `zod` | 4.6.7 |
| `express` | 5.2.1 |
| `tsx` | 4.21.0 |
| `typescript` | 5.9.3 |

## Setup

```bash
# The example links the SDK from this checkout, so build it once.
cd ../../packages/sdk && npm install --legacy-peer-deps && npm run build && cd -

npm install --legacy-peer-deps
cp .env.example .env
```

Fill `.env` with **your own** `stellar:testnet` key (`STELLAR_SECRET_KEY`, funded
by [Friendbot](https://friendbot.stellar.org) and holding testnet USDC), your own
receiving address (`NIRIUM_X402_PAY_TO`), and a free testnet facilitator key from
[channels.openzeppelin.com/testnet/gen](https://channels.openzeppelin.com/testnet/gen)
(`NIRIUM_X402_FACILITATOR_API_KEY`). Never commit `.env`.

## Run

```bash
npm run server   # the seller, on http://127.0.0.1:3404
npm start        # the tool, twice: the $0.02 call pays, the $2.00 call is refused
npm run agent    # the same tool driven by a Mastra agent (needs MASTRA_MODEL + provider key)
```

`npm start` needs no LLM. It prints two results.

### The paid call

`GET /premium/signals` asks $0.02 and the cap is $0.05, so the SDK signs and the
facilitator settles. The shape (the `transaction` value is filled in by a real
settlement when you run it):

```json
{
  "ok": true,
  "paid": true,
  "refused": false,
  "status": 200,
  "url": "http://127.0.0.1:3404/premium/signals",
  "data": {
    "ok": true,
    "route": "/premium/signals",
    "price": "0.02 USDC",
    "signals": [{ "pair": "XLM/USDC", "confidence": 0.71, "note": "example payload, not financial advice" }]
  },
  "transaction": "<settlement hash from the PAYMENT-RESPONSE header>"
}
```

The `transaction` value is read from the server's `PAYMENT-RESPONSE` header, so it
is the hash that settled on testnet. Open it at
`https://stellar.expert/explorer/testnet/tx/<hash>`.

### The refused call

`GET /premium/report` asks $2.00 against the same $0.05 cap. This is the real
output, from a local x402 challenge (the SDK and `@x402/core` run unmodified):

```json
{
  "ok": false,
  "paid": false,
  "refused": true,
  "status": 402,
  "url": "http://127.0.0.1:3404/premium/report",
  "refusal": {
    "code": "X402_SPEND_CAP_EXCEEDED",
    "reason": "x402Fetch refused to pay http://127.0.0.1:3404/premium/report: the server asked for 2 USDC (20000000 atomic units) and the per-payment cap is $0.05. The signer was not called; nothing was signed or sent. The cap is enforced by @x402/core; raise it explicitly with initX402({ maxAmountPerPayment }).",
    "amount": "20000000",
    "formattedAmount": "2 USDC",
    "cap": "$0.05"
  }
}
```

Nothing was signed and no transaction exists for it. The agent sees a normal tool
result and reports the amount and the cap; the run continues.

## Use it in an agent

```typescript
import { Agent } from '@mastra/core/agent';
import { createNiriumPayer } from './src/nirium-payer.ts';
import { createNiriumPayTool } from './src/nirium-tool.ts';

const payer = createNiriumPayer({
    secretKey: process.env.STELLAR_SECRET_KEY,
    network: 'stellar:testnet',
    maxAmountPerPayment: '$0.05',   // required; no unbounded mode
});
const payTool = createNiriumPayTool({ payer });

export const agent = new Agent({
    id: 'nirium-payer',
    name: 'Nirium payer',
    instructions: 'Buy data with pay_x402_endpoint. Never ask for a higher cap. '
        + 'If a payment is refused, report the amount and the cap, then stop.',
    model: 'openai/gpt-5-mini',
    tools: { payTool },
});
```

The cap is enforced by `@x402/core` while it selects payment requirements, which
happens before the Stellar auth entry is built. `X402SpendCapError` carries
`amount`, `formattedAmount`, `cap` and `signerCalled: false`; the tool maps it to
`refused: true` and rethrows every other error.

## Tests

```bash
npm test          # node:test via tsx, no network
npm run typecheck
```

Five tests, no external network:

1. **Over the cap.** A real `node:http` seller answers a real x402 v2 challenge for
   2 USDC. The real SDK, `@x402/core` and `@x402/fetch` run unmodified. The tool
   returns `refused: true` with the amount and the cap, the signer is never
   called, and the seller sees exactly one request with no `PAYMENT-SIGNATURE`.
2. **Under the cap.** The same challenge for 0.01 USDC does not trigger the cap:
   the payment proceeds past selection and fails later, at the (deliberately
   unreachable) RPC. The error is not `X402_SPEND_CAP_EXCEEDED`.
3. **Paid mapping.** A stub transport returns 200 with a `PAYMENT-RESPONSE`
   header; the tool returns the body and the transaction hash. A real settlement
   needs a facilitator and a funded account, so this one does not go on-chain.
4. **Other failures** are rethrown, not swallowed.
5. **The cap is required** and validated before any payment.

## Evidence

The issue asks for transaction hashes signed by the contributor's own keys, on
`stellar:testnet`. **No hash is listed here yet:** a live payment needs a funded
testnet key and a facilitator API key, and neither is in this repository. Run
`npm run server` and `npm start` with your own keys, then fill this table from the
`transaction` field of the paid call (each link is
`https://stellar.expert/explorer/testnet/tx/<hash>`):

| Call | Amount | Transaction |
|---|---|---|
| `GET /premium/signals` | 0.02 USDC | _pending live run_ |
| `GET /premium/report` | 2.00 USDC, refused | none, by design: nothing was signed |

Do not merge with the first row empty.

## What this does not solve

- **The cap is a buyer-side check.** It stops `x402Fetch` from signing an
  over-cap payment. Any code in the same process that holds the raw key (or
  replaces the signer) can sign without asking it. Nothing on-chain enforces it.
- **No spend total.** This is a per-payment cap, not a daily or per-task budget.
  For that, see [`../x402-policy-daily-budget`](../x402-policy-daily-budget).
- **Untrusted content reaches the model.** The paid body is returned to the agent
  as data. Treat it as untrusted input: it can contain instructions.
- **No idempotency or reconciliation.** If the payment settles and the response is
  lost, the tool reports the failure and there is no retry that reuses the same
  payment.
- **The seller is yours.** `x402Serve()` runs on your machine, the facilitator
  verifies and settles, and Nirium is not in the path.
