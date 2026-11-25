# Changelog

All notable changes to the `nirium` (PyPI) package are documented here.

## Unreleased

## 0.13.0 - 2026-11-23

- `stellar-sdk` dependency moves to `>=17.0.1,<18.0.0` (was `>=15.0.0,<16.0.0`). 15.0.0 carried XDR from before Protocol 28, so it could not read Protocol 28 or 30 types such as CAP-71 address-bound credentials or CAP-84 muxed contract addresses (`W...`). 17.0.1 carries Protocol 30 XDR, and Protocol 30 is live on mainnet.
- From stellar-sdk 16 on, simulation records CAP-71 `ADDRESS_V2` credentials by default, so `x402_fetch()` now signs the address-bound preimage. The pre-sign policy already handled it: `ctx.authorization` reports `preimageType: "cap71"` and the bound address must equal the signer, as before.
- `setup.py` declared `stellar-sdk>=11.0.0,<16.0.0` while `pyproject.toml` declared `>=15.0.0`; both now declare the same range.
- Checked with real testnet payments to Nirium's own test endpoint (our own test, not usage): without a policy `6649626b8dd41b9690f74ce3bdc50f74e78fdfb7115bd65f684a817fa362bdbe`, with an ALLOW policy `f4185ab27a2f0facf0c5f003e71c97667878b7fc80bdb87946d68b46c215330c`, and a DENY policy that signed nothing.

## 0.12.9 - 2026-11-22

- Pre-sign policy hook (`init_x402(policy=...)`): parity with TypeScript SDK pre-sign policy hook (#355). Evaluates policy before signing; DENY and WAIT never call the signer; fail closed on exceptions; stale ALLOW invalidation via `current_version`.
- Raised `stellar-sdk` dependency floor to `>=15.0.0` for Soroban authorization preimage and payload hash support (`build_authorization_preimage`, `authorization_payload_hash`, and address envelope constants).
- Aligned `contextHash` wire formatting with the TypeScript SDK (`{"v":1,"url":"...","method":"...","payloadHash":"..."}` with exact key ordering and no whitespace separators).
- README: the Audit Trail note said IPFS content "cannot be deleted". Corrected: nobody can guarantee deletion from IPFS, because anyone with the CID may have kept a copy; the advice is unchanged (anchor a hash, not personal data).

## 0.12.8 - 2026-11-21

New `receipt_cid(document)`: recomputes a receipt's IPFS CID (CIDv0) locally, with no IPFS node and no new dependency, so a copy you kept can be shown to be the original. `anchor_audit_record()` returns the exact pinned `document` on nodes deployed after 21 Nov 2026; the README shows how to save it. Also: tests for every Treasury method (#370), and the README's hosted WebSocket note re-checked on 21 Nov.

## 0.12.7 - 2026-11-19

README: the hosted signal stream (wss://nirium-agent.fly.dev/ws/signals) did not accept connections when checked on 18 Nov 2026; the WebSocket section and the endpoint table now say so. No code change.

## 0.12.6 - 2026-11-17

README: a short note on what a receipt adds over the ledger, with a link to the design FAQ. No code change.

## 0.12.5 - 2026-11-17

Package description and keywords updated. No code change.
