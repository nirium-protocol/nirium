# Changelog

All notable changes to the `nirium` (PyPI) package are documented here.

## Unreleased

- Pre-sign policy hook (`init_x402(policy=...)`): parity with TypeScript SDK pre-sign policy hook (#355). Evaluates policy before signing; DENY and WAIT never call the signer; fail closed on exceptions; stale ALLOW invalidation via `current_version`.

## 0.12.7 - 2026-11-19

README: the hosted signal stream (wss://nirium-agent.fly.dev/ws/signals) did not accept connections when checked on 18 Nov 2026; the WebSocket section and the endpoint table now say so. No code change.

## 0.12.6 - 2026-11-17

README: a short note on what a receipt adds over the ledger, with a link to the design FAQ. No code change.

## 0.12.5 - 2026-11-17

Package description and keywords updated. No code change.
