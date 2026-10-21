# Changelog

All notable changes to the `nirium-cli` package are documented here.

## Unreleased

### Fixed

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
