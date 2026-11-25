# Vercel AI SDK x402 tool (testnet)

A [Vercel AI SDK](https://ai-sdk.dev/) tool that lets a model call a paid x402 endpoint through the
[Nirium SDK](../../packages/sdk). The tool wraps `agent.x402Fetch()` behind `initX402()` with a
per-payment spend cap, so an over-cap request is refused **before anything is signed** and the model
gets a readable reason instead of an exception.

Testnet only: no real funds, no mainnet, no custody. Every key stays with whoever owns it.

```
src/x402-tool.ts       AI SDK tool() + x402Fetch, settlement tx extraction, readable refusals
src/scripted-model.ts  deterministic model for the tool loop when no model API key is set
src/server.ts          your own x402Serve seller: one route below the cap, one above it
src/demo.ts            generateText() + the tool, against the seller you run
test/                  8 offline tests (no network, no model API calls)
```

## Package versions tested

Pinned in `package.json` and `package-lock.json`. The testnet evidence below was produced with these
exact versions on Node.js 24.22.2 (the SDK requires Node.js >= 22.12.0).

| Package | Version |
|---|---|
| `ai` | `7.0.179` |
| `@ai-sdk/openai` | `4.0.122` (only needed for a real model call) |
| `nirium` | `0.19.8` |
| `zod` | `4.6.7` |
| `@x402/core` | `2.32.0` |
| `@x402/express` | `2.32.0` |
| `@x402/extensions` | `2.32.0` |
| `@x402/stellar` | `2.32.0` |
| `express` | `5.3.0` |

## How the tool works

`src/x402-tool.ts` exposes one AI SDK tool, `payForUrl`:

```ts
const agent = new Agent({ apiKey: 'unused-x402-only' });
agent.initX402({
  secretKey: process.env.STELLAR_SECRET_KEY!,
  network: 'stellar:testnet',
  maxAmountPerPayment: '$1',
});

const payForUrl = createX402PaidFetchTool({
  x402Fetch: (url, init) => agent.x402Fetch(url, init),
  maxAmountPerPayment: '$1',
});

const result = await generateText({
  model,
  tools: { payForUrl },
  stopWhen: stepCountIs(4),
  prompt: 'Pay the market summary, then try the full report.',
});
```

The model sees a normal tool result:

- on success: `{ ok: true, status, body, settlementTx }`, where `settlementTx` is read from the
  x402 v2 `PAYMENT-RESPONSE` header and can be linked on Stellar Expert;
- on an over-cap 402: `{ ok: false, refused: true, reason, requestedAmount, cap, signerCalled: false }`.
  The reason says what the server asked for, which cap refused it, and that nothing was signed;
- on any other failure: `{ ok: false, reason }`.

The secret key is used only to initialize the SDK. It never enters the tool schema, the prompt, or the
tool result.

## Run it

### 1. Install

```bash
npm install
cp .env.example .env
```

### 2. Own testnet keys

Create two testnet accounts you own: one **payer** (the agent) and one **seller** (receives the
payments). Friendbot funds both:

```bash
stellar keys generate my-payer  --network testnet --fund
stellar keys generate my-seller --network testnet --fund
```

Put the payer secret in `STELLAR_SECRET_KEY` and the seller public key in `SELLER_PUBLIC_KEY`.
Never commit `.env`; it is gitignored.

### 3. USDC trustlines and buyer balance

x402 settles in testnet USDC
(`USDC:GBBD47IF6LWK7P7MDEVSCWR7DPUWV3NY3DTQEVFL4NAT4AQH3ZLLFLA5`). Both accounts need a
trustline; the payer needs a small balance:

```bash
stellar tx new change-trust --line USDC:GBBD47IF6LWK7P7MDEVSCWR7DPUWV3NY3DTQEVFL4NAT4AQH3ZLLFLA5 \
  --source-account my-payer --network testnet
stellar tx new change-trust --line USDC:GBBD47IF6LWK7P7MDEVSCWR7DPUWV3NY3DTQEVFL4NAT4AQH3ZLLFLA5 \
  --source-account my-seller --network testnet
```

Fund the payer at the [Circle faucet](https://faucet.circle.com) (USDC, Stellar Testnet). If the
faucet is unavailable, testnet USDC also trades against XLM on the testnet DEX; the evidence run below
bought 69.93 USDC with a 100 XLM path payment instead.

### 4. Facilitator key (seller only)

`x402Serve()` needs a free testnet facilitator key from OpenZeppelin Channels:

```bash
curl -s https://channels.openzeppelin.com/testnet/gen
# {"apiKey":"..."}
```

Put it in `FACILITATOR_API_KEY`. The key is per network.

### 5. Run the seller

```bash
npm run server
# x402Serve on http://localhost:3402 (stellar:testnet)
#   GET /paid/market-summary  $0.02
#   GET /paid/full-report     $2
```

`/paid/market-summary` is below the agent's `$1` cap. `/paid/full-report` is above it.

### 6. Run the agent

In another terminal:

```bash
npm run demo
```

Without `OPENAI_API_KEY`, the demo uses `src/scripted-model.ts`, a deterministic model that makes the
same two tool calls and writes its answer from the real tool results. With `OPENAI_API_KEY` set, it
uses the real model (`OPENAI_MODEL`, default `gpt-4o-mini`).

## What the evidence run shows

`npm run demo` against the seller above, on Stellar testnet:

**Paid call (below the cap):**

```text
step 1 tool call: payForUrl {"url":"http://localhost:3402/paid/market-summary","method":"GET"}
step 1 tool result: {
  "ok": true,
  "status": 200,
  "body": "{\"ok\":true,\"route\":\"market-summary\",...}",
  "settlementTx": "89e7880901499675b3b350c33b9766a22994808a3639837cb5ea98dcb2bfb623"
}
```

**Refused call (above the cap):**

```text
step 2 tool call: payForUrl {"url":"http://localhost:3402/paid/full-report","method":"GET"}
step 2 tool result: {
  "ok": false,
  "refused": true,
  "reason": "Payment refused before signing: http://localhost:3402/paid/full-report asked for
             2 USDC (20000000 atomic units), above the $1 per-payment cap. Nothing was signed and
             nothing was sent. If this payment is intended, the operator must raise the cap with
             initX402({ maxAmountPerPayment: ... }).",
  "requestedAmount": "2 USDC",
  "cap": "$1",
  "signerCalled": false
}
```

The seller's USDC balance changed from `0.0000000` to `0.0200000` after the paid call, and did not
change after the refused one.

## Evidence (stellar:testnet, 2026-11-22)

| Item | Value |
|---|---|
| Payer account | [`GCQUHBTSXMDP5DW2MCC37HE42KXZP4DYHHBRP42FVLZ47P4P3ZCU2IMW`](https://stellar.expert/explorer/testnet/account/GCQUHBTSXMDP5DW2MCC37HE42KXZP4DYHHBRP42FVLZ47P4P3ZCU2IMW) |
| Seller account | [`GDV6L5AE6MNC7JTZZIIAI7WJ4YTK2HFNNZSZWIIE4CJKS4LMC3VCKNXX`](https://stellar.expert/explorer/testnet/account/GDV6L5AE6MNC7JTZZIIAI7WJ4YTK2HFNNZSZWIIE4CJKS4LMC3VCKNXX) |

Transactions for these accounts. The trustline, DEX, and settlement transactions carry the payer's
signature (the settlement one as a signed Soroban authorization); Friendbot funded the two accounts:

| Step | Transaction |
|---|---|
| Fund payer (Friendbot) | [`ca24c791...e551d`](https://stellar.expert/explorer/testnet/tx/ca24c7910e571ad967b311748bd17b7ceb57ee85ec7ac95461e91f8ea1ce551d) |
| Fund seller (Friendbot) | [`4b6b8f51...d7570`](https://stellar.expert/explorer/testnet/tx/4b6b8f51cb35ddeee9394694c5512bddfb477a601c08a25bc7432442415ad757) |
| Payer USDC trustline | [`98e77e84...e9b04a`](https://stellar.expert/explorer/testnet/tx/98e77e84fed1f309c49f40dd88aef5b07fa09963402b8b577d3d2a5d51e9b04a) |
| Seller USDC trustline | [`62ed8fb7...3851dc`](https://stellar.expert/explorer/testnet/tx/62ed8fb7d731ec32372a32f8e0ade13ec04b205e396c918c3bde0d03c23851dc) |
| Payer buys USDC on the testnet DEX (100 XLM) | [`730c5a74...57ecb`](https://stellar.expert/explorer/testnet/tx/730c5a747972a8109a8a53bef4d79129c07f6a62031a7e3810cccd8f3d957ecb) |
| x402 settlement for `/paid/market-summary` ($0.02) | [`89e78809...fb623`](https://stellar.expert/explorer/testnet/tx/89e7880901499675b3b350c33b9766a22994808a3639837cb5ea98dcb2bfb623) |

The facilitator submits the settlement and sponsors the network fee. The refused
`/paid/full-report` call produced no transaction.

## Tests

```bash
npm test        # node:test via tsx, offline
npm run typecheck
```

The 8 tests cover:

1. reading the settlement hash from `PAYMENT-RESPONSE`;
2. the wording of a spend-cap refusal;
3. a successful tool result with body and settlement hash;
4. an over-cap refusal returned as a readable tool result, not thrown;
5. any other failure returned as a readable tool result;
6. the real AI SDK tool loop (`generateText` + `stepCountIs`) making both calls and writing a final
   answer from the tool results;
7. the Nirium SDK refusing an over-cap 402 against a local `x402Serve` seller **before signing**,
   with a mocked facilitator and an assertion that `/verify` and `/settle` were never called;
8. an unpaid request getting a 402 with the advertised price, network and `payTo`.

No test opens a network connection or calls a model API. The SDK cap test replaces `globalThis.fetch`
with a router that answers the facilitator origin locally.

## Limits

- The cap is **per payment**, not per session or per day. A model can make many payments that are each
  below the cap. For a daily budget, combine this with the SDK's pre-sign policy hook; see
  [`examples/x402-policy-daily-budget`](../x402-policy-daily-budget).
- The scripted model is deterministic. A real model may choose different URLs or stop after one call;
  the tool still enforces the cap either way.
- `x402Serve()` does not replay-protect or rate-limit by default. Add its optional `guard` for a
  public seller; see the [SDK README](../../packages/sdk/README.md#replay-and-rate-limit-guard-optional).
- Testnet only. The same code works on mainnet with `network: 'stellar:pubnet'`, a mainnet facilitator
  key, and real USDC, but that would spend real funds and was not tested here.
