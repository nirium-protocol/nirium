# Audit forensic bridge

A small Express server that turns incoming webhook events into Audit Trail anchors. Each event
`POST`ed to `/webhook` is anchored through the `nirium` SDK, and, when a Stellar key is set, it
carries an ed25519 signature over `nirium-audit-v1:<sha256 of the record>` made with that key.
The response gives you the CID to keep.

Contributed by [Santia2004](https://github.com/Santia2004) in
[#69](https://github.com/nirium-protocol/nirium/pull/69) (Aug 2026).

```
src/server.ts        POST /webhook -> anchorAuditRecord({ record, tag: 'wave11-forensic-bridge', agent? })
src/attestation.ts   sha256 of the record, domain-prefixed message, sign and verify
src/anchors.ts       local, git-ignored receipt log (anchors.jsonl)
src/export.ts        verify each logged CID with the published Nirium CLI
test/*.test.ts       offline tests for signing, storage and export
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

The tests use placeholders and make no network calls. They cover signing, a changed record, an
invalid signature, the local receipt log, and export results.

## Export your own anchors

Each successful webhook appends its CID, `contentSha256`, and optional `attestedBy` to the local
`anchors.jsonl`. The file is git-ignored and stays on this machine. Back it up if you need a
lasting record of your anchors. The public Reporting export lists dates, sources and networks;
it does not return other people's CIDs.

```bash
pnpm export
```

Export invokes `npx nirium-cli@latest verify <cid> --json` for every locally logged CID. The CLI
retrieves the IPFS document and checks its record hash and any agent signature. The bridge also
compares the verified document's hash to the one it logged at anchor time. It writes
`audit-verified-report.json` locally, prints verified and failed counts and a reason for every
failure, and exits nonzero if any record fails. Neither the webhook nor export sends raw records
to the Reporting service.

A verified receipt proves that the record in the IPFS document has not changed since it was
anchored and, when an agent signature is present, which Stellar key signed it. It does **not**
prove that the record is true. `anchoredAt` is the Nirium node's clock, not a ledger timestamp.
Anchor only hashes or small non-personal records: nobody can guarantee that something is deleted from IPFS, since anyone with the CID may have kept a copy.

## Testnet run (21 November 2026)

I generated a new Stellar key locally for this run; its public key is
`GBBQIOW2ACAHEGY6QJ7Z64ZMT4RDTUYH5ZC5HUV3CD72CWXMGPD5GUO2`. The secret stays in the
git-ignored `.env`. Two non-personal placeholder events were posted to the local `/webhook`
against `https://nirium-agent.fly.dev`, using the `wave11-forensic-bridge` tag:

| CID | `nirium verify` |
|---|---|
| `QmdG5F3ZVF7WJHQzz9DUhcZSsCfRxbAn1cCWHVy36nb9B5` | `verified: true`, hash match, valid ed25519 signature |
| `QmTYLcQDYcbjd6FRtTX7F2LZqtP6wXUdrfEp5cNnnJcGAW` | `verified: true`, hash match, valid ed25519 signature |

Both were checked independently with `npx --yes nirium-cli@latest verify <cid> --json`.
The `pnpm export` output was:

```text
Verified: 2; failed: 0; total: 2
VERIFIED QmdG5F3ZVF7WJHQzz9DUhcZSsCfRxbAn1cCWHVy36nb9B5
VERIFIED QmTYLcQDYcbjd6FRtTX7F2LZqtP6wXUdrfEp5cNnnJcGAW
Report written to audit-verified-report.json
```
