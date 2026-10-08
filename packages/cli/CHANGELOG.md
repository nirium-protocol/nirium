# Changelog

All notable changes to the `nirium-cli` package are documented here.

## Unreleased

### Added

- `nirium doctor --seller <url>` validates a remote x402 seller without paying ([#105](https://github.com/nirium-protocol/nirium/issues/105)). It checks for HTTP 402 with a decodable `PAYMENT-REQUIRED` header, that `network`, `asset`, `amount` and `payTo` are present and well formed, that `resource.url` is `https://`, and that a CORS preflight from a random origin does not return 5xx, exposes `PAYMENT-REQUIRED` and `PAYMENT-RESPONSE`, and allows `PAYMENT-SIGNATURE`. `--json` still prints the report for CI. The probe never sends a payment.
