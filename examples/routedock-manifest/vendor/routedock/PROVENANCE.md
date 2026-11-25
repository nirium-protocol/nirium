# Vendored from `winsznx/routedock`

**Why this exists:** this issue's acceptance criteria require `signManifest`,
`verifyManifestSignature`, and the manifest JSON Schema exactly as documented
at `packages/sdk/src/manifest/sign.ts` and
`packages/sdk/src/schemas/routedock.schema.json` in the RouteDock repo. As of
writing, the published npm package (`@routedock/routedock@0.1.2`, last
published 2026-04-13) predates all of that: it has no `manifest/sign.ts`
module at all, no `signature`/`signature_version` fields in its schema, no
`/schema` or `/testing` subpath exports, and `RouteDockClient` there has
neither `expectedPayee` nor `estimateCost()`. The `package.json` version was
never bumped alongside the additions, so there is no newer tag to install -
`npm install @routedock/routedock` today gives you the older shape.

Since the issue's acceptance criteria are written against the GitHub
source, this directory vendors exactly the files needed from it -
copied **verbatim, unmodified** - rather than reimplementing RouteDock's
signing/validation logic. Nothing under `src/` here has been edited.

- **Source:** <https://github.com/winsznx/routedock>
- **Commit:** `0fe7bb7f930eeae1fe059670e0f0db29201c644d`
- **Path:** `packages/sdk/src/`
- **License:** MIT (same as upstream)

## Files and why each is here

| File | Needed for |
| --- | --- |
| `src/manifest/sign.ts` | `signManifest` / `verifyManifestSignature` / `manifestDigest` |
| `src/schemas/routedock.schema.json` | ajv validation (acceptance criterion 3) |
| `src/types.ts`, `src/errors.ts` | Shared types/errors referenced by the above |
| `src/client/RouteDockClient.ts`, `ModeRouter.ts`, `x402Client.ts`, `NulthVault.ts` | `RouteDockClient.pay()` / `estimateCost()` / `fetchManifest` (acceptance criteria 2-3) |
| `src/internal/retry.ts`, `src/store/SpendStore.ts`, `src/store/FileSpendStore.ts` | Direct dependencies of `RouteDockClient.ts` |

**`src/client/MppChargeClient.ts` and `MppSessionClient.ts` are *not*
vendored** - each file says so at the top. The real versions import
`@stellar/mpp/charge/client`, `@stellar/mpp/channel/client`, and `mppx/client`
subpaths that don't exist in the `@stellar/mpp`/`mppx` versions `nirium`
(this example's other real dependency) pulls in - a genuine transitive
version conflict between two unrelated packages, for a mode (`mpp-charge` /
`mpp-session`) this example's manifest never declares. `RouteDockClient`'s
constructor instantiates both unconditionally, so each is replaced with a
minimal same-shape stub that throws if actually called - never exercised by
any test or script here, since the manifest only declares `modes: ['x402']`.

`provider/`, `react/`, and `registry/` were left out entirely - this example
only serves discovery + x402, per the issue's scope.

**Replace this vendor directory** with a plain `@routedock/routedock`
dependency once a release ships that includes the manifest-signing module -
at that point `src/manifest.ts` and `src/server.ts` only need their
`from '../vendor/routedock/src/...'` imports swapped for
`from '@routedock/routedock'` / `'@routedock/routedock/client'`.

## Patches on top of the verbatim copy

Everything above is unmodified. `src/client/x402Client.ts` has one real,
confirmed patch (search it for `PATCHED`):

RouteDock's `pay()` reads the 402 challenge from an `X-Payment-Requirements`
header and the settlement receipt from `X-Payment-Response`. The real
`@x402/core` server - the library `x402Serve()` and RouteDock's own
`ExactStellarScheme` both build on - actually sets `PAYMENT-REQUIRED` and
`PAYMENT-RESPONSE` (verified by reading `@x402/core`'s published
`server/index.js`, by a live probe of `nirium-agent.fly.dev`'s real 402
response, and by running the real, unmodified `x402Serve()` locally in this
example - all three agree). RouteDock's client therefore cannot complete a
payment against any standard `@x402/core`-based x402 server as published
today, including this one. The patch checks both header names, so it stops
mattering once RouteDock fixes it upstream. `scripts/testnet-proof.ts`
required this patch to get past its very first `402` response - without it,
`RouteDockClient.pay()` fails immediately.

**Also found, not patched (neither affects this example):**
- `@routedock/routedock`'s published `package.json` doesn't list
  `ajv-formats` as a dependency even though `client/ModeRouter.ts` imports it
  - a fresh `npm install @routedock/routedock` alone throws on first
  `fetchManifest()`/`pay()` call. (Fixed on `main`, unpublished - see the
  npm-vs-main gap above.)
- `client/RouteDockClient.ts`'s `ASSET_ISSUERS.USDC.testnet` constant,
  `GBQY2K7IZDSK5QN3OF6ZSOLQ6CWAH5Q5JXEG5Q3S4OD5B7LYO24B6B6L`, fails
  `StrKey.isValidEd25519PublicKey()` - it's not a valid Stellar address. The
  real testnet USDC issuer (verified by deriving
  `new Asset('USDC', issuer).contractId(Networks.TESTNET)` and confirming it
  equals `@x402/stellar`'s `USDC_TESTNET_ADDRESS`) is
  `GBBD47IF6LWK7P7MDEVSCWR7DPUWV3NY3DTQEVFL4NAT4AQH3ZLLFLA5`. This constant
  only feeds a non-fatal trustline-preflight remediation message, so it
  doesn't block anything here - `scripts/setup-testnet-accounts.ts` uses the
  correct issuer directly rather than importing this constant.

Worth reporting to `winsznx/routedock` as three separate issues.

## Real testnet proof (not simulated)

Running `scripts/testnet-proof.ts` against a demo payee/buyer produced a
real, independently-verifiable settlement:

- Transaction: [`5e042131847a2260ae3150359807ce43f56d8180ce1956413c63b2b8c1d66693`](https://stellar.expert/explorer/testnet/tx/5e042131847a2260ae3150359807ce43f56d8180ce1956413c63b2b8c1d66693)
  - `successful: true` per Horizon.
- The demo payee's USDC balance moved from `0` to exactly `0.0200000` -
  matching the manifest's declared `pricing.x402.amount` to the last digit.
- Settlement ran through the real OpenZeppelin Channels testnet facilitator
  (`https://channels.openzeppelin.com/x402/testnet`), the same one
  `x402Serve()` uses in production.
