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
      - run: test "${{ steps.audit.outputs.verified }}" = "true"
```

With no `gateway` or `gateways` input set, the action tries a default
fallback list in order: Filebase's dedicated gateway, then `ipfs.io`, then
`dweb.link`, moving to the next one on any HTTP error or timeout. This
fixes #185: a single shared public gateway (the old sole default,
`ipfs.io`) rate-limits under load and returns `429`, which failed
verification even for a perfectly healthy CID.

## Inputs

| Name | Required | Default | Description |
| --- | --- | --- | --- |
| `cid` | yes | | IPFS CID for the Nirium audit JSON document. |
| `gateway` | no | (unset) | A single IPFS gateway, overriding the default fallback list. Values ending in `/ipfs` or `/ipfs/` are used directly. |
| `gateways` | no | (unset) | Comma- or newline-separated list of gateways to try in order. Ignored if `gateway` is set. Defaults to `https://nirium.myfilebase.com/ipfs/,https://ipfs.io/ipfs/,https://dweb.link/ipfs/` when both are unset. |
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
