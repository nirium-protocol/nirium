# Verify Nirium Audit CID Action

This action verifies a Nirium audit document fetched from IPFS. It recomputes
`SHA-256(JSON.stringify(doc.record))`, compares that value to
`content_sha256`, and verifies an optional Stellar Ed25519 agent attestation
over `nirium-audit-v1:<content_sha256>`.

The action does not call a Nirium API. The CID and gateway are the only network
inputs.

## Usage

```yaml
jobs:
  verify-audit:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
      - uses: nirium-protocol/nirium/actions/verify-audit-cid@main
        id: audit
        with:
          cid: QmSSZdtt3dQ8BqUm62zrKQ85E4BUHYiVfvDgZmHfJsqU1U
          gateway: https://ipfs.io/ipfs/
      - run: test "${{ steps.audit.outputs.verified }}" = "true"
```

## Inputs

| Name | Required | Default | Description |
| --- | --- | --- | --- |
| `cid` | yes | | IPFS CID for the Nirium audit JSON document. |
| `gateway` | no | `https://ipfs.io/ipfs/` | IPFS gateway. Values ending in `/ipfs` or `/ipfs/` are used directly. |
| `fail-on-error` | no | `true` | When `true`, failed verification marks the step failed. |

## Outputs

| Name | Description |
| --- | --- |
| `verified` | `true` when the content hash matches and no embedded agent signature is invalid. |
| `hash_match` | `true` when the recomputed record hash matches `content_sha256`. |
| `signature_valid` | `valid`, `invalid`, or `absent`. |
| `signer` | Stellar `G...` public key from the agent block, when present. |
| `content_sha256` | Recomputed SHA-256 hash of `doc.record`. |
| `cid` | Echo of the `cid` input. |
| `gateway` | Gateway used for the fetch. |
| `error` | Error detail when fetch or verification fails. |

## Verification model

The action intentionally reconstructs the signed statement from the recomputed
record hash. It does not trust embedded `valid` or `agent.statement` fields,
which prevents statement-substitution attacks where a valid old signature is
reused after the audit record is changed.
