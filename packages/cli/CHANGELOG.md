# Changelog

All notable changes to the `nirium-cli` package are documented here.

## Unreleased

### Fixed

- `nirium pay` no longer fails with `NiriumAgent is not a constructor` on a clean install ([#147](https://github.com/nirium-protocol/nirium/issues/147)). `nirium` ships as CommonJS, so the default import was the whole exports object, not the `Agent` class. Fixed to import the named `Agent` export.
- `nirium serve` no longer fails every real payment with `x402 payments unavailable` / `the facilitator could not be reached`. `x402Serve()` loads `@x402/express` with a dynamic `import()`, deliberately optional in the SDK so consumers who only buy via `x402Fetch()` don't need Express, and it fails with a clear, actionable error rather than crashing — not an SDK bug. But `serve` always calls `x402Serve()`, with no path that doesn't need it, so it should have declared `@x402/express` itself, the same way it already declares `express`. Found while doing the manual testnet smoke test for [#137](https://github.com/nirium-protocol/nirium/issues/137); the existing `serve` tests never caught it because they only check CLI validation and kill the process as soon as it starts listening, before any payment is attempted. Added `@x402/express` as a direct dependency.
- `packages/cli` had drifted from the SDK ([#137](https://github.com/nirium-protocol/nirium/issues/137)): `nirium` was pinned at `^0.16.0` (SDK: `0.16.1`), `@stellar/stellar-sdk` at `^14.5.0` (SDK: `^16.3.0`, not `17`: `@x402/stellar` requires `^16.3.0`), and the version was hardcoded twice (`.version('2.0.1')` in `bin/nirium.js` and `"version"` in `package.json`). Bumped both dependencies to match the SDK and `engines.node` to `>=22.12.0` (stellar-sdk 16 pulls in the ESM-only `@noble/hashes` 2.x; `require()` of an ES module only works unflagged from Node 22.12.0). `.version()` now reads `package.json` at runtime, the same file `nirium-doctor`'s user agent already read, so there is one source instead of two. The `@stellar/mpp@0.7.1` peer warning for `@stellar/stellar-sdk@^15.1.0` (upstream, unrelated to this package) persists, but `stellar-sdk` is now a single shared copy (`nirium`, `@x402/stellar` and the root project all resolve to the same install) instead of two separate ones.
- `nirium status` no longer exits 0 when the agent is down ([#138](https://github.com/nirium-protocol/nirium/issues/138)). It printed `Agent unreachable` or `Agent returned error` but always exited 0, so it could not be used in a script or a CI health check. Now exits 1 if the agent is unreachable, times out, or `/health` is not 2xx. Added `--json` (the raw `/health` fields plus `ok`) and `--timeout <ms>` (default 5000) so an unreachable host does not hang.
- `nirium verify` no longer reports `VERIFICATION PASSED` when nothing was actually checked ([#149](https://github.com/nirium-protocol/nirium/issues/149)). A pass was computed as "no check failed", which is also true when both the hash and the signature check were skipped (an unsigned hash-only anchor with no `--hash` or `--evidence`). A pass now requires at least one check to have run and succeeded. When both are skipped, `verify` prints `NOTHING VERIFIED`, exits non-zero, and sets `verified: false` in `--json`. A hash-only anchor with a valid signature and no `--hash`, or an unsigned one with a matching `--hash`, is still a pass.
- `nirium pay` no longer reports a failed request as a success ([#148](https://github.com/nirium-protocol/nirium/issues/148)). It always printed `Payment Negotiated & Request Completed` and exited 0 after a successful payment, even when the request that followed answered 4xx or 5xx. Success (text and `--json`, exit 0) now requires `response.ok`; otherwise it prints the failure and the response body and exits 1.
- `nirium pay`'s `--amount` was removed: it was declared on the command and documented, but `options.amount` was never read, so it did nothing. Replaced with `--max-amount <usd>`, a per-payment cap. `nirium` does not publish `initX402({ maxAmountPerPayment })` yet, so the cap is enforced with the SDK's pre-sign policy hook (`initX402({ policy })`, published since 0.16.0), which runs before anything is signed. `--max-amount` rejects zero, negative and non-numeric values before any network call.
- `nirium verify` no longer fails every hash-only anchor ([#139](https://github.com/nirium-protocol/nirium/issues/139)). Without a `record` it compared `content_sha256` against `sha256("")` and built the signed statement from that same empty hash, so both checks always failed. Hash-only documents now verify the agent signature over `nirium-audit-v1:<content_sha256>`, and the hash is reported as not checked unless you pass `--hash <hex>` or `--evidence <file>`. Record documents behave as before.
- `nirium verify` accepts hex as well as base64 signatures, and SEP-53 signed messages (Freighter `signMessage`) after raw ed25519, matching the anchoring node.

### Added

- `nirium verify --hash <hex>` and `--evidence <file>` to compare a hash-only anchor with your original evidence.

## 2.0.1 - 2026-10-11

Documentation only. No behavior changes.

### Changed

- README: the secret key section no longer suggests `nirium config set secretKey S...`, which is refused since 2.0.0. It lists the three safe ways instead.
- README: `nirium status` is now documented, including that its default URL is `http://localhost:3001` and not the Nirium agent.
- README and `nirium doctor` help text: the MPP check only validates configuration, and Nirium does not charge MPP payments on mainnet today.
- README: the `x402Serve()` usage telemetry is off by default and only sent when `NIRIUM_X402SERVE_TELEMETRY=true` (as in `nirium` 0.16.0). The text said it was on by default.
- README: fixed the `nirium verify` options table and removed long dashes.

## 2.0.0 - 2026-10-11

Breaking: three ways of passing a secret on the command line are gone. A key typed as an argument stays in your shell history and shows up in `ps` for anyone on the machine. The safe ways to supply a key are the environment variable (`NIRIUM_SECRET_KEY`, `FACILITATOR_API_KEY`) or the hidden prompt.

### Removed (breaking)

- `nirium pay --secret <key>` ([#108](https://github.com/nirium-protocol/nirium/pull/108)). Use `NIRIUM_SECRET_KEY`, or run `nirium config set secretKey` and type the key at the hidden prompt.
- `nirium config set secretKey <key>` and `nirium config set facilitatorApiKey <key>` ([#111](https://github.com/nirium-protocol/nirium/pull/111)). Run the same command with no value: in a terminal it asks for the key without echoing it, and without a terminal it reads the key from stdin. A key passed as an argument is refused and not saved.
- `nirium serve --api-key <key>` and `-k` ([#111](https://github.com/nirium-protocol/nirium/pull/111)). Use `FACILITATOR_API_KEY`, `nirium config set facilitatorApiKey`, or the hidden prompt. Without a terminal and without the variable, `serve` waits up to 10 seconds for the key on stdin and then exits with the missing-key error.

### Changed

- Depends on `nirium` `^0.16.0` ([#109](https://github.com/nirium-protocol/nirium/pull/109)). The scaffolds written by `nirium create` pin the same range.

### Added

- `nirium doctor --seller <url>` validates a remote x402 seller without paying ([#105](https://github.com/nirium-protocol/nirium/issues/105)) ([#110](https://github.com/nirium-protocol/nirium/pull/110)). Thanks to [@Edgadafi](https://github.com/Edgadafi). It checks for HTTP 402 with a decodable `PAYMENT-REQUIRED` header, that `network`, `asset`, `amount` and `payTo` are present and well formed, that `resource.url` is `https://`, and that a CORS preflight from a random origin does not return 5xx, that the 402 response exposes `PAYMENT-REQUIRED` and `PAYMENT-RESPONSE` (a preflight that lists them does not count), and that `PAYMENT-SIGNATURE` is allowed. `--json` still prints the report for CI. The probe never sends a payment. The `User-Agent` is `nirium-doctor/<version>` from this package's `package.json`.
