# Changelog

All notable changes to the `nirium` package are documented here.

## Unreleased

### Added

- `initX402({ maxAmountPerPayment })` ([#106](https://github.com/nirium-protocol/nirium/issues/106)): sets the `@x402/core` 2.28 per-payment cap (`spendControls.maxAmountPerPayment`) so APIs priced above $1 can be paid. Accepts `'$5'`, `'5'` or `5`; validated at `initX402()` time (positive amounts only, `false` is rejected). Without the option, behavior is unchanged: the default stays `$1`. Works with and without `policy`. The `X402SpendCapError` message now points to the option.

## 0.16.1 - 2026-10-11

Documentation and package metadata only. `dist/` is identical to 0.16.0.

### Changed

- `package.json` `repository` now points to `nirium-protocol/nirium` with `directory: packages/sdk`, and `bugs.url` to `nirium-protocol/nirium/issues` (both pointed to the old `nirium-sdk` repo). `nirium-mcp` gets the same change in its own next release.
- README: documents the `x402Serve()` replay and rate-limit guard (`guard`, `X402GuardStore`, `createUpstashX402GuardStore`) with a tested example, credit to Edgadafi, and rewrites the "known limitation" text: without `guard` there is still no replay protection or rate limit. Documents `ResilientSignalClient`.
- README: `/premium/signals` exists only on testnet (mainnet answers 501). Removed two dead links (`/docs/api`, `/docs/mcp`), fixed the GitHub link, removed long dashes.

## 0.16.0 - 2026-10-02

### Added

- `initX402({ policy })` (experimental): pre-sign policy hook for `x402Fetch()` ([#96](https://github.com/nirium-protocol/nirium/issues/96)). The policy is asked after the Stellar authorization is built and before anything is signed; only an `ALLOW` bound to that exact authorization (`contextHash`) and still valid reaches the signer. Optional `currentVersion` re-reads the policy version right before signing and refuses a stale `ALLOW` (not atomic with signing). Refusals throw `X402PolicyError` with an `outcome`. A clock that is not a finite number refuses with `CLOCK_INVALID`. The `onDecision` receipts are `ALLOWED` (notice), then `SIGNED` only once the signer returned a signature or `SIGNER_ERROR` if it did not; the observer runs before the final clock and identity checks, and a promise it returns is not awaited and its rejection is swallowed. Without `policy`, behavior is unchanged. New exports: `X402PolicyError` and the `X402Policy*` types.
- `x402Fetch()` throws `X402SpendCapError` when `@x402/core` (2.23.0 and later) refuses a payment for being above its default per-payment cap of $1. It states the amount asked for, the cap and that the signer was not called, instead of the generic `Failed to create payment payload: ... rejected by spendControls.maxAmountPerPayment` error. Other `spendControls` rejections are unchanged. The cap itself is not exposed in `initX402()` yet. New export: `X402SpendCapError`.
- The gate accepts both auth preimage variants stellar-sdk 16 can produce, the legacy one and CAP-71 (`...WithAddress`), the latter only when bound to the signer's address.

### Fixed

- `initMpp()` threw `TypeError: Mppx.create is not a function` in 0.15.0: it called the wrong export of `mppx` with a configuration the library does not take. It now builds the client the way `mppx` and `@stellar/mpp` document (`Mppx` from `mppx/client`, `stellar.charge()` from `@stellar/mpp/charge/client`) with `polyfill: false`, so it never replaces `globalThis.fetch` (which would also have intercepted the 402s of `x402Fetch`). `MppConfig.network` is still accepted but no longer used: the network comes from the server's challenge. Checked against the agent's own MPP middleware on testnet in `pull` and `push` mode. MPP Charge is still **not** verified end to end against Nirium's hosted endpoints: the testnet one rejected the payment when tested on 2026-10-01, and the mainnet one was not tested; see the README.

### Changed

- `@stellar/stellar-sdk` ^16.3.0 and `@x402/fetch`/`@x402/stellar`/`@x402/core` ^2.28.0. Node.js >= 22.12.0 is now required, and `nirium` declares it in `engines.node` so npm warns up front. The two packages declare `>=22.0.0`, but stellar-sdk 16 pulls in the ESM-only `@noble/hashes` 2.x, and `require()` of an ES module works without a flag only from Node 22.12.0 (on 22.11 `require('nirium')` throws `ERR_REQUIRE_ESM`).

## 0.15.0 - 2026-09-24

### Added

- `x402Serve()`: optional `guard` config for replay protection and rate limiting, off by default. Providing `guard.store` turns on single-use protection against a replayed payment proof (`X-PAYMENT`/`PAYMENT-SIGNATURE`); adding `guard.rateLimit` also turns on a sliding-window rate limit per caller IP. Fails closed (503) for replay protection and open for rate limiting if the store is unavailable, matching the design already proven in a real production `x402Serve()` deployment. New exports: `X402GuardStore`, `X402GuardConfig`, `createUpstashX402GuardStore()` (a reference Upstash-backed store). See [#91](https://github.com/nirium-protocol/nirium/issues/91).

  The store interface and this feature's fail-closed/fail-open split are generalized from - and credited to - a real production integrator's own implementation: **Edgadafi/remesa-liquidez** (commit `1e0cbd5902cb224d3c6a2320cc009cf4df84f513`, `backend/src/middleware/paymentGuard.ts` and `backend/src/middleware/rateLimit.ts`). The code in this package is our own, not copied from theirs.
