# Changelog

All notable changes to the `nirium` (PyPI) package are documented here.

## Unreleased

## 0.12.8 - 2026-11-21

New `receipt_cid(document)`: recomputes a receipt's IPFS CID (CIDv0) locally, with no IPFS node and no new dependency, so a copy you kept can be shown to be the original. `anchor_audit_record()` returns the exact pinned `document` on nodes deployed after 21 Nov 2026; the README shows how to save it. Also: tests for every Treasury method (#370), and the README's hosted WebSocket note re-checked on 21 Nov.

## 0.12.7 - 2026-11-19

README: the hosted signal stream (wss://nirium-agent.fly.dev/ws/signals) did not accept connections when checked on 18 Nov 2026; the WebSocket section and the endpoint table now say so. No code change.

## 0.12.6 - 2026-11-17

README: a short note on what a receipt adds over the ledger, with a link to the design FAQ. No code change.

## 0.12.5 - 2026-11-17

Package description and keywords updated. No code change.
