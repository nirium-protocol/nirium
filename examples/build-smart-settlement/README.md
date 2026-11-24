# Smart settlement: verified delivery then x402 payment (testnet)

A self-contained example of [issue #350](https://github.com/nirium-protocol/nirium/issues/350): a local
ed25519 delivery simulator signs each payload, an agent verifies that signature **before** paying,
and payment goes through `initX402()` behind the `DailyBudgetPolicy` from
[`examples/x402-policy-daily-budget`](../x402-policy-daily-budget). The seller is one x402-protected
route, built with `x402Serve()` the same way as [`examples/vercel-ai-sdk-x402`](../vercel-ai-sdk-x402)
and conceptually matching [`examples/express-x402`](../express-x402).

Testnet only: no real funds, no mainnet, no custody, no third-party payouts. Every key stays with
whoever owns it. This is not [`examples/build-proof-of-delivery`](../build-proof-of-delivery); that
example is Audit Trail receipts, which are out of scope here.

```
src/server.ts                 x402Serve seller: GET /paid/settle-delivery on stellar:testnet
src/delivery.ts               local ed25519 delivery simulator and verifier
src/agent.ts                  verify the delivery signature first, then pay
src/payment.ts                settlement hash from the PAYMENT-RESPONSE header
src/demo.ts                   one command: 3 paid, 1 bad signature skipped, 1 budget refusal
src/constants.ts              $0.02 × 3 = 600,000 atomic daily cap
src/policy/                   DailyBudgetPolicy + InMemoryBudgetStore (copied, self-contained)
test/settlement.test.ts       7 offline tests (no network)
```

## Package versions tested

Pinned in `package.json` and `package-lock.json`. The testnet evidence below was produced with these
exact versions on Node.js 24.22.1 (the SDK requires Node.js >= 22.12.0).

| Package | Version |
|---|---|
| `nirium` | `0.19.8` |
| `@x402/core` | `2.32.0` |
| `@x402/express` | `2.32.0` |
| `@x402/extensions` | `2.32.0` |
| `@x402/stellar` | `2.32.0` |
| `express` | `5.3.0` |

No SDK changes. The example depends on the published `nirium` package.

## How the flow works

1. The delivery simulator signs a canonical `{ deliveryId, orderId, deliveredAt }` payload with a
   local ed25519 key (Node.js `crypto`). That key is not a Stellar key.
2. `settleIfVerified()` checks the signature against the trusted public key. A bad signature returns
   immediately with `signerCalled: false` and never calls `x402Fetch`.
3. A valid signature is the only path that pays. The agent calls `agent.x402Fetch()` after
   `initX402({ network: 'stellar:testnet', policy: budget.hook() })`.
4. The seller exposes one paid route, `GET /paid/settle-delivery`, at `$0.02` testnet USDC.
5. The daily cap is `3 × 200,000 = 600,000` atomic units (0.06 USDC). A fourth payable delivery is
   refused by the policy **before anything is signed**.

`npm start` (also `npm run demo`) runs this in one process: it starts the seller, runs the five
steps, asserts the expected flow, and shuts the server down.

## Run it

### 1. Install

```bash
cd examples/build-smart-settlement
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
Never commit `.env`; it is gitignored. Never reuse a key someone gave you or a seed that has been
printed or committed.

### 3. USDC trustlines and buyer balance

x402 settles in testnet USDC
(`USDC:GBBD47IF6LWK7P7MDEVSCWR7DPUWV3NY3DTQEVFL4NAT4AQH3ZLLFLA5`). Both accounts need a
trustline; the payer needs a small balance (three payments are $0.02 each):

```bash
stellar tx new change-trust --line USDC:GBBD47IF6LWK7P7MDEVSCWR7DPUWV3NY3DTQEVFL4NAT4AQH3ZLLFLA5 \
  --source-account my-payer --network testnet
stellar tx new change-trust --line USDC:GBBD47IF6LWK7P7MDEVSCWR7DPUWV3NY3DTQEVFL4NAT4AQH3ZLLFLA5 \
  --source-account my-seller --network testnet
```

Fund the payer at the [Circle faucet](https://faucet.circle.com) (USDC, Stellar Testnet). If the
faucet is unavailable, testnet USDC also trades against XLM on the testnet DEX; the evidence run
below bought 32.66 USDC with a 50 XLM path payment instead.

### 4. Facilitator key (seller only)

`x402Serve()` needs a free testnet facilitator key from OpenZeppelin Channels:

```bash
curl -s https://channels.openzeppelin.com/testnet/gen
# {"apiKey":"..."}
```

Put it in `FACILITATOR_API_KEY`. The key is per network.

### 5. Run the demo

```bash
npm start
```

That is the one-command run. Optional: `npm run server` starts only the seller on
`http://localhost:3402` if you want to inspect `GET /paid/settle-delivery` yourself.

## What the evidence run shows

`npm start` on Stellar testnet (24 Nov 2026, 1:19–1:20 pm America/Mexico_City):

```text
seller on http://127.0.0.1:3402/paid/settle-delivery  $0.02  payTo GCH3GC4WSTK7WFHZUPRKSN4LZ7BVYXIXGVZQXS4MWXTTHJH3K2FZYPCK
daily budget: 600000 atomic units (3 × 200000)

step 1 PAID  delivery=del-001  http=200  tx=a20d187a9e6f3e26d96aa5410eaf0c11ce110dd80409ff6d4c595863e3b05ff5
step 2 PAID  delivery=del-002  http=200  tx=5055323a0bf820694298e815a7d7f4944ba636acf2735043b50744b4e7e6dee9
step 3 PAID  delivery=del-003  http=200  tx=1388bbaa5664fc3baa2ae5e97a955a31c15ebd5be24363ff36545b2b134b8eed
step 4 SKIPPED  delivery=del-004  invalid delivery signature; payment was not attempted
step 5 REFUSED  delivery=del-005  outcome=DENY  signerCalled=false
  daily cap 600000 exceeded: spent 600000, requested 200000
```

Step 4 produced no payment. Step 5 was refused before signing; the refusal output was:

```json
{
  "status": "refused",
  "deliveryId": "del-005",
  "outcome": "DENY",
  "reason": "daily cap 600000 exceeded: spent 600000, requested 200000",
  "signerCalled": false
}
```

Each paid settlement moved `0.0200000` testnet USDC from the payer to the seller. The seller's
balance went from `0.0000000` to `0.0600000`. The skipped and refused steps produced no further
transactions and no further balance change.

## Evidence (stellar:testnet, 2026-11-24)

| Item | Value |
|---|---|
| Payer account | [`GAGHZ6XOJE4BXQYPVBHTA3T5H5XSW6KMZQGRYVCBRPEZCRLCP7FYDPDE`](https://stellar.expert/explorer/testnet/account/GAGHZ6XOJE4BXQYPVBHTA3T5H5XSW6KMZQGRYVCBRPEZCRLCP7FYDPDE) |
| Seller account | [`GCH3GC4WSTK7WFHZUPRKSN4LZ7BVYXIXGVZQXS4MWXTTHJH3K2FZYPCK`](https://stellar.expert/explorer/testnet/account/GCH3GC4WSTK7WFHZUPRKSN4LZ7BVYXIXGVZQXS4MWXTTHJH3K2FZYPCK) |

The trustline, DEX, and settlement transactions carry the payer's signature (the settlement ones as
a signed Soroban authorization). Friendbot funded the two accounts. The facilitator submits the
settlement and sponsors the network fee.

| Step | Transaction |
|---|---|
| Fund payer (Friendbot) | [`aa26c20d...50b85f`](https://stellar.expert/explorer/testnet/tx/aa26c20d577486497776ee0261eb510ab48411dbc1f140df5932719dde50b85f) |
| Fund seller (Friendbot) | [`2e97f793...d94344`](https://stellar.expert/explorer/testnet/tx/2e97f7933be7c9234793ab797e0b4df357c060d732ea998bae2501b938d94344) |
| Payer USDC trustline | [`389edc7b...8615e9`](https://stellar.expert/explorer/testnet/tx/389edc7b738c15f8479cbbea1803ac0db3c452bd670fd027e54dbf0d578615e9) |
| Seller USDC trustline | [`fd4af138...33b8ca`](https://stellar.expert/explorer/testnet/tx/fd4af138c94cbf7338854d9ffbcd3be14071577b3f6c2e2bdf5b5d82ad33b8ca) |
| Payer buys USDC on the testnet DEX (50 XLM) | [`dc537cd8...5750f4`](https://stellar.expert/explorer/testnet/tx/dc537cd85a2375fdb0c66e7ba0bc0ff72f9debb3ee14b95505c538d8225750f4) |
| x402 settlement for `del-001` ($0.02) | [`a20d187a...b05ff5`](https://stellar.expert/explorer/testnet/tx/a20d187a9e6f3e26d96aa5410eaf0c11ce110dd80409ff6d4c595863e3b05ff5) |
| x402 settlement for `del-002` ($0.02) | [`5055323a...e6dee9`](https://stellar.expert/explorer/testnet/tx/5055323a0bf820694298e815a7d7f4944ba636acf2735043b50744b4e7e6dee9) |
| x402 settlement for `del-003` ($0.02) | [`1388bbaa...4b8eed`](https://stellar.expert/explorer/testnet/tx/1388bbaa5664fc3baa2ae5e97a955a31c15ebd5be24363ff36545b2b134b8eed) |

The bad-signature delivery (`del-004`) and the budget refusal (`del-005`) produced no transaction.

## Tests

```bash
npm test        # node:test via tsx, offline
npm run typecheck
```

The 7 tests cover:

1. a delivery signed by the trusted key verifies, and a mutated payload does not;
2. a signature from a different key is rejected;
3. a broken signature byte fails verification;
4. `settleIfVerified` skips a bad signature and never calls `pay`;
5. `settleIfVerified` calls `pay` only after a valid signature, and records the settlement hash;
6. the daily-budget policy allows three $0.02 payments and denies the fourth, without committing it;
7. signing a delivery is deterministic for the same payload and key.

No test opens a network connection. The payment tests use a mock `pay` function; the policy test
calls `evaluate` in memory.

Example typecheck is picked up automatically by
[`.github/workflows/examples-typecheck.yml`](../../.github/workflows/examples-typecheck.yml)
(`examples/*/tsconfig.json`).

## Limits

- The delivery simulator is local ed25519. It is not a real IoT device, and there is no UI.
- Audit Trail receipts are out of scope; do not reuse `examples/build-proof-of-delivery` here.
- The daily cap is in-process (`InMemoryBudgetStore`). Several processes need a shared store with a
  conditional write, as documented in `src/policy/budget-store.ts`.
- The cap is a UTC calendar day. Restarting the demo on the same UTC day against a fresh in-memory
  store starts the budget at zero again; the chain already has the three settlements above.
