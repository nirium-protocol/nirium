# MPP charge on Stellar testnet (WIP, #349)

Start the **upstream** `@stellar/mpp` Charge server (not a Nirium `x402Serve`) and make one paid request with `initMpp()` on `stellar:testnet`.

Status: **blocked** on [stellar/stellar-mpp-sdk#108](https://github.com/stellar/stellar-mpp-sdk/issues/108). npm `@stellar/mpp` is still 0.7.1, which is incompatible with stellar-sdk 17 XDR. This example does not change `packages/sdk` dependencies. `initMpp()` itself is already the canonical construction and stays as-is.

```
src/server.ts    upstream @stellar/mpp Charge server on 127.0.0.1
src/demo.ts      starts that server and pays once with agent.initMpp() / mppFetch()
src/env.ts       loads .env; never logs Stellar secret keys
```

## Root cause

A paid `initMpp()` request fails inside **npm `@stellar/mpp@0.7.1`**, in `charge/client/Charge.js` `createCredential`:

```
TypeError: prepared.toEnvelope(...).v1 is not a function
```

This is the stellar-sdk 17 XDR change: `toEnvelope().v1()` is no longer a function (`v1` is a property). The 402 challenge is accepted; the client then dies while building the payment credential. It is not a bug in the Nirium `initMpp()` wrapper and not a first-failure mppx handshake break.

The fix is already on upstream main (`95815ac` and later): `StellarXdr.expectUnionVariant(prepared.toEnvelope(), 'envelopeTypeTx').v1.tx` instead of `prepared.toEnvelope().v1().tx()`. That code is not on npm yet. Main also peers `mppx ^0.13.4` (0.13.x only, not 0.14+ or 0.22).

Until #108 publishes, a successful payment needs a **local, uncommitted** install of `@stellar/mpp` built from stellar-mpp-sdk main, plus `mppx@0.13.x`. Do not commit a git URL, a vendored tarball, or a lockfile that points at unpublished main.

## Recorded testnet evidence

Verified locally on 24 Nov 2026, 6:08:57 pm America/Mexico_City, with `@stellar/mpp` built from main (`95815ac`) + mppx 0.13.x, using the exact `initMpp()` construction against the upstream Charge server (not a Nirium server):

- Payer: `GBZTWFTZYUGQOVGEMKJ6JFG7EK4QXC4KAT7OJJGCPO5HS2W6DRB4DKKD`
- Seller / recipient: `GCVV2MS2BUSPMXTZ7W6AU7JZPUZ6BOQPEZQ7NOOX55MDEYZK66XMU3KC`
- HTTP 200 body: `{"ok":true,"message":"Payment verified — paid content from the upstream Charge server.","amount":"0.01","recipient":"GCVV2MS2BUSPMXTZ7W6AU7JZPUZ6BOQPEZQ7NOOX55MDEYZK66XMU3KC"}`
- Settlement: https://stellar.expert/explorer/testnet/tx/5fc8e32fb45c1fb1953739dc54e2ac823fb1bd377aabbcf508a25203d5578902
- Horizon: successful; `0.0100000` USDC from the payer to the seller.

`PAYMENT-RECEIPT` (decoded): method `stellar`, status `success`, reference `5fc8e32fb45c1fb1953739dc54e2ac823fb1bd377aabbcf508a25203d5578902`.

Once #108 publishes, bump `@stellar/mpp` and pin `mppx` 0.13.x in `packages/sdk`, then re-run this example with the published packages and record a new hash. Do not edit the root README MPP status line until a maintainer re-checks it.

## Package versions in this tree

Pinned in `package.json` (and `package-lock.json` after install). These are the **published** packages, so `npm install` and typecheck work today. A live payment with only these versions fails at `toEnvelope().v1()` as described above.

| Package | Version |
|---|---|
| `nirium` | `0.20.0` |
| `@stellar/mpp` | `0.7.1` (npm) |
| `@stellar/stellar-sdk` | `17.4.0` |
| `mppx` | `0.6.31` |

The SDK requires Node.js >= 22.12.0. A local build of `@stellar/mpp` from main wants Node.js >= 22.23.4.

## Run it

### 1. Install

```bash
cd examples/mpp-charge-testnet
npm install
cp .env.example .env
```

### 2. Own testnet keys

Create two testnet accounts you own: one **payer** (`initMpp`) and one **seller** (receives the USDC). Friendbot funds both:

```bash
stellar keys generate my-payer  --network testnet --fund
stellar keys generate my-seller --network testnet --fund
```

Put the payer secret in `PAYER_SECRET_KEY` and the seller public key in `SELLER_PUBLIC_KEY`. Never commit `.env`; it is gitignored. Never reuse a key someone gave you or a seed that has been printed or committed.

### 3. USDC trustlines and buyer balance

Settlement is testnet USDC SAC `CBIELTK6YBZJU5UP2WWQEUCYKLPU6AUNZ2BQ4WWFEIE3USCIHMXQDAMA` (`USDC:GBBD47IF6LWK7P7MDEVSCWR7DPUWV3NY3DTQEVFL4NAT4AQH3ZLLFLA5`). Both accounts need a trustline; the payer needs a small USDC balance (the demo charges `0.01`):

```bash
stellar tx new change-trust --line USDC:GBBD47IF6LWK7P7MDEVSCWR7DPUWV3NY3DTQEVFL4NAT4AQH3ZLLFLA5 \
  --source-account my-payer --network testnet
stellar tx new change-trust --line USDC:GBBD47IF6LWK7P7MDEVSCWR7DPUWV3NY3DTQEVFL4NAT4AQH3ZLLFLA5 \
  --source-account my-seller --network testnet
```

Fund the payer at the [Circle faucet](https://faucet.circle.com) (USDC, Stellar Testnet).

### 4. Until #108 publishes: install @stellar/mpp from main (local, do not commit)

```bash
git clone https://github.com/stellar/stellar-mpp-sdk.git
cd stellar-mpp-sdk
# install deps with the repo's package manager, then:
npm run build
npm pack    # writes stellar-mpp-0.7.1.tgz; version on main is still 0.7.1

cd /path/to/nirium/examples/mpp-charge-testnet
npm install --no-save /path/to/stellar-mpp-sdk/stellar-mpp-0.7.1.tgz mppx@0.13.4
```

Adjust the tarball path. Do not add that install to `package.json` or the lockfile, and do not vendor the tarball in this repository.

With only the published 0.7.1 packages, `npm start` will still start the Charge server and accept the 402, then fail with `prepared.toEnvelope(...).v1 is not a function`. The demo prints that diagnosis and exits non-zero.

### 5. Run the demo

```bash
npm start
```

That is the one-command run: it starts the Charge server on `http://127.0.0.1:3403`, pays `GET /resource` once with `initMpp({ network: 'stellar:testnet', mode: 'pull' })`, prints the HTTP status and settlement hash, and shuts the server down.

Optional: `npm run server` starts only the Charge server if you want to inspect the 402 yourself.

## Plan once published

1. Bump `@stellar/mpp` and pin `mppx` 0.13.x in `packages/sdk` (no `initMpp()` API change).
2. Point this example at those published versions.
3. Re-run `npm start` and record a new testnet hash.
4. Un-skip the paid-path test in `packages/sdk` if it can be done with a loopback stub and no outbound network (#126).
