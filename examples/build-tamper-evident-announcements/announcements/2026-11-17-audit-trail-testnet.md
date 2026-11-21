---
title: Audit Trail receipts are live on Stellar testnet
date: 2026-11-17
kind: changelog
---

Project announcements can now be published with a receipt that readers can
check without an account. Each announcement is hashed locally, and only the
SHA-256 hash is anchored through Nirium's free testnet Audit Trail endpoint.

The receipt does not put the announcement text on IPFS. It proves that this
exact file has not changed since the hash was anchored and which Stellar key
declared it. The text stays in the project's repository and on the static site.

## What changed

- `anchorAuditRecord()` sends the hash, a `wave11-` tag and a local signature.
- The static site lists the CID and hash beside every announcement.
- Readers verify with `npx nirium-cli verify` or at `nirium.xyz/verify`.
