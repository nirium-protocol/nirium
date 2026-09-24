# Changelog

All notable changes to the `nirium` package are documented here.

## Unreleased

### Added

- `x402Serve()`: optional `guard` config for replay protection and rate limiting, off by default. Providing `guard.store` turns on single-use protection against a replayed payment proof (`X-PAYMENT`/`PAYMENT-SIGNATURE`); adding `guard.rateLimit` also turns on a sliding-window rate limit per caller IP. Fails closed (503) for replay protection and open for rate limiting if the store is unavailable, matching the design already proven in a real production `x402Serve()` deployment. New exports: `X402GuardStore`, `X402GuardConfig`, `createUpstashX402GuardStore()` (a reference Upstash-backed store). See [#91](https://github.com/nirium-protocol/nirium/issues/91).

  The store interface and this feature's fail-closed/fail-open split are generalized from - and credited to - a real production integrator's own implementation: **Edgadafi/remesa-liquidez** (commit `1e0cbd5902cb224d3c6a2320cc009cf4df84f513`, `backend/src/middleware/paymentGuard.ts` and `backend/src/middleware/rateLimit.ts`). The code in this package is our own, not copied from theirs.
