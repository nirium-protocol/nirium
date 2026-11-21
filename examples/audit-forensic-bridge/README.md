# Audit forensic bridge

A small Express server that turns incoming webhook events into Audit Trail anchors. Each event
`POST`ed to `/webhook` is anchored through the `nirium` SDK, and, when a Stellar key is set, it
carries an ed25519 signature over `nirium-audit-v1:<sha256 of the record>` made with that key.
The response gives you the CID to keep.

Contributed by [Santia2004](https://github.com/Santia2004) in
[#69](https://github.com/nirium-protocol/nirium/pull/69) (Aug 2026).

```
src/server.ts        POST /webhook -> anchorAuditRecord({ record, tag: 'webhook-event', agent? })
src/attestation.ts   sha256 of the record, domain-prefixed message, sign and verify
src/export.ts        reporting export + re-check (see the limit below)
test/bridge.test.ts  offline tests for the signing and verification
```

## Setup

The example depends on the SDK in this repo (`"nirium": "file:../../packages/sdk"`), so build it
first. The lockfile is pnpm 10.

```bash
cd packages/sdk && npm install && npm run build && cd ../..
cd examples/audit-forensic-bridge
pnpm install
```

Environment (all optional):

| Variable | Default | What it does |
|---|---|---|
| `NIRIUM_BASE_URL` | `http://localhost:3002` | Agent that anchors the record, e.g. `https://nirium-agent.fly.dev` for the hosted testnet agent |
| `NIRIUM_API_KEY` | `nrm_test_key` | Sent as the SDK's API key |
| `STELLAR_SECRET_KEY` | none | If set, every record is signed with this key before anchoring. Use your own testnet key; never commit it |
| `PORT` | `3000` | Port for the webhook server |

## Run

```bash
pnpm dev
curl -X POST http://localhost:3000/webhook \
  -H 'Content-Type: application/json' \
  -d '{"eventId":"evt_1","amount":5}'
```

The answer has `cid`, `contentSha256` and, when signed, `attestedBy`. Check the CID independently
with `npx nirium-cli@latest verify <CID>` or at [nirium.xyz/verify](https://nirium.xyz/verify).

## Tests

```bash
pnpm test
```

Four offline tests: the hash is computed over the record as sent (key order matters), a signature
verifies, a changed record fails verification, and the message carries the `nirium-audit-v1:`
prefix. No network.

## Limit: `pnpm export` does not work against the hosted agent

`src/export.ts` reads the anchors export and re-checks each CID. It was written when the export
returned a CID and hash per row. The Reporting export no longer returns CIDs (a CID belongs to
whoever anchored it): today each row has only `anchored_at`, `source` and `network`, so there is
nothing to fetch. It also hashes the whole IPFS document and compares that with the record's
`content_sha256`, which would not match even with a CID. To re-check what you anchored, keep the
CIDs from the `/webhook` responses and run `nirium verify` on them.
