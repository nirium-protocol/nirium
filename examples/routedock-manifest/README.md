# RouteDock manifest for Nirium's x402 signals endpoint

Serves a signed [RouteDock](https://github.com/winsznx/routedock) discovery
manifest (`GET /.well-known/routedock.json`) for Nirium's real x402 endpoint:

```
GET https://nirium-agent.fly.dev/api/v1/premium/signals   ($0.02 USDC, Stellar testnet)
```

With this manifest served on the same origin, a RouteDock client needs zero
Nirium-specific code - `client.pay('https://nirium-agent.fly.dev/api/v1/premium/signals')`
auto-discovers the manifest, sees `modes: ["x402"]`, and pays it.

## This is discovery only - `x402Serve()` is unmodified

[`src/server.ts`](src/server.ts) mounts two independent things:

1. `x402Serve()` from the `nirium` package, imported and called exactly as
   documented in `packages/sdk/src/index.ts` - unmodified, still the thing
   that verifies and settles every payment.
2. `GET /.well-known/routedock.json` - a read-only route that *describes*
   endpoint (1). It never touches payment verification or settlement.

Both routes are signed by / paid to the same account. On the real deployment
that account is Nirium's production payee; here it's whichever secret
`NIRIUM_ROUTEDOCK_PAYEE_SECRET` points at.

## Manifest field provenance

Every field in [`src/manifest.ts`](src/manifest.ts) is sourced from Nirium's
or RouteDock's own real code/config, not guessed:

| Field | Source |
| --- | --- |
| `pricing.x402.facilitator` | `X402_FACILITATORS` in `packages/sdk/src/index.ts` (`x402Serve()`'s own default) |
| `asset_contract` | `USDC_TESTNET_ADDRESS` / `USDC_PUBNET_ADDRESS` exported by `@x402/stellar` - the same library `x402Serve()` loads at runtime |
| `endpoints.signals.path`, `pricing.x402.amount` | `examples/nextjs-x402/app/api/premium/signals/route.ts` (`$0.02`, `/api/v1/premium/signals`) - confirmed live: a probe of `GET https://nirium-agent.fly.dev/api/v1/premium/signals` returns a real `402` whose `payment-required` header decodes to `amount: "200000"` (0.02 USDC, 7dp) on the exact same asset contract above |
| `payee` | `x402Serve()`'s `payTo` config - read from `NIRIUM_ROUTEDOCK_PAYEE_SECRET` at startup, never hardcoded |

## Setup

```bash
npm install
cp .env.example .env
```

```bash
npm run typecheck
npm test
```

`npm test` runs against a real local HTTP server (loopback only) covering:
manifest discovery (`fetchManifest`), ajv validation against RouteDock's
*actual* published schema (`@routedock/routedock/schema`, not a local copy),
Ed25519 signature verification (`verifyManifestSignature`) including
rejection of a substituted payee and a tampered field, and RouteDock's
mode/pricing resolution (`RouteDockClient.estimateCost`).

`RouteDockClient.pay()`'s x402 path builds a Soroban `invoke_contract`
transaction that RouteDock's own client simulates against a live Soroban RPC
endpoint before signing - there's no seam to mock that without reimplementing
Soroban RPC, and Nirium's own `x402serve-smoke.test.ts` draws the same line
(mocking the chain-signing modules rather than exercising them). So `pay()`
itself is proven for real, against real Stellar testnet, below.

## Real testnet run (not this endpoint's production key - see "Scope" below)

```bash
node -e "console.log(require('@stellar/stellar-sdk').Keypair.random().secret())"   # → NIRIUM_ROUTEDOCK_PAYEE_SECRET
node -e "console.log(require('@stellar/stellar-sdk').Keypair.random().secret())"   # → BUYER_SECRET
```

Fill in `.env`, get a free `FACILITATOR_API_KEY` at
<https://channels.openzeppelin.com/testnet/gen>, then:

```bash
npm run testnet-proof:setup   # funds both accounts + opens USDC trustlines (real testnet txs)
```

`setup-testnet-accounts.ts` can't get the buyer actual testnet USDC itself -
Circle's public faucet (<https://faucet.circle.com>, network "Stellar
Testnet") gates that behind reCAPTCHA, so request 20 USDC there for the
buyer address the setup script prints. Then:

```bash
npm run testnet-proof
```

This starts the example server for real, fetches and ajv-validates the
manifest, calls `verifyManifestSignature()`, then runs a real
`RouteDockClient.pay()` - settling through the real OpenZeppelin Channels
testnet facilitator - and prints the resulting Stellar testnet transaction
hash with a `stellar.expert` link.

**Already run for this PR:** transaction
[`5e042131847a2260ae3150359807ce43f56d8180ce1956413c63b2b8c1d66693`](https://stellar.expert/explorer/testnet/tx/5e042131847a2260ae3150359807ce43f56d8180ce1956413c63b2b8c1d66693)
- `successful: true` per Horizon, and the demo payee's USDC balance moved
from `0` to exactly `0.0200000`, matching the manifest's declared price to
the last digit. Getting this far required one real, documented patch to the
vendored client - see "Patches on top of the verbatim copy" in
`vendor/routedock/PROVENANCE.md`: RouteDock's client reads the wrong 402
header name and cannot complete a payment against any standard
`@x402/core`-based server (including this one) without it.

## Scope: what a Nirium maintainer still needs to do

RouteDock requires the manifest to be signed by the account that actually
receives the money (`sign.ts`'s trust model) - an external contributor can't
hold that key. Everything in this PR runs against a demo payee I generated
myself; the code is otherwise byte-for-byte what production needs. To go
live on `nirium-agent.fly.dev`, a maintainer:

1. Mounts `GET /.well-known/routedock.json` (this package's route) on the
   existing service, next to the unmodified `x402Serve()` call.
2. Sets `NIRIUM_ROUTEDOCK_PAYEE_SECRET` to the same secret already configured
   as `x402Serve()`'s `payTo` account (`NIRIUM_X402_PAY_TO`'s keypair).

No other change to the live endpoint is required or made.

## Out of scope

- `mpp-charge` / `mpp-session` modes for Nirium (not implemented here).
- Mainnet (this targets testnet per the issue; `network: 'mainnet'` is
  supported by `buildSignalsManifest()` but not exercised).
