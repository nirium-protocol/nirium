# SDP Audit Bridge

A reusable, read-only TypeScript adapter that turns a completed Stellar
disbursement batch into a small Nirium audit record. It resolves the actual
payment operations from Horizon, aggregates them without anchoring recipient
addresses, and calls `anchorAuditRecord({ record, agent })`. A separate command
starts with only the resulting CID and independently rebuilds the aggregate
from every cited Testnet transaction.

This example never creates accounts, signs payment transactions, submits
payments, reads an SDP database, or takes custody of funds.

## Requirements

- Node.js >=22.12.0 (`@stellar/stellar-sdk` 16.x requires it)
- A completed batch identified by transaction hashes or a distribution account
  and UTC time window
- Testnet only
- A Nirium API key if the configured Audit Trail node requires one
- An optional, dedicated Stellar Ed25519 secret key for agent attestation

Install the example independently, like the other integrations in this
repository:

```bash
cd examples/sdp-audit-bridge
npm install
cp .env.example .env
```

## Anchor a completed batch

Pass transaction hashes explicitly:

```bash
npm run anchor -- \
  --tx bef28fdf5ebacc86fbf1f0a0814cda6736e7204c7a85307c7e01695a4a3cf2ac \
  --tx 539aad89debbd03081b515ad4c85c3ac41797f62e3d437ea33763be0e987b464 \
  --tx d199253093ef46e9c6619d37221579fc270d52ec803c0c0d1f834d883ac37caf
```

Or discover outgoing payments from an operation-level source account in the
half-open interval `[from, to)`:

```bash
npm run anchor -- \
  --source GDEAVYFKV3NUH76ES2SV2CCKMWY4HR2OYAIUHRQ6E46JOI6UE5X3CMDR \
  --from 2026-08-26T22:34:50Z \
  --to 2026-08-26T22:35:20Z
```

`HORIZON_URL` may point to a self-hosted Horizon instance, but the bridge reads
its root metadata and refuses to continue unless `network_passphrase` is the
Stellar Testnet passphrase. A URL that happens to contain the word `testnet` is
not treated as proof of the network.

If `AUDIT_AGENT_SECRET_KEY` is configured, the bridge signs exactly:

```text
nirium-audit-v1:<sha256(JSON.stringify(record))>
```

The secret is only an audit attestation key. Do not reuse an SDP distribution
account key. If the variable is absent, the audit document is anchored unsigned
and verification reports the signature as `absent`.

## Verify from only the CID

```bash
npm run verify -- QmPBR9r3ax7u9smk6H7w7AjSciNh2AZKHwUB5sTyxwCSQD
```

The verification command does not ask Nirium for the original batch. It:

1. fetches the audit document from the configured IPFS gateway;
2. recomputes SHA-256 over the embedded `record`;
3. reconstructs `nirium-audit-v1:<computed hash>` and verifies the optional
   Ed25519 signature without trusting the document's `agent.statement`;
4. confirms that the configured Horizon server is Testnet;
5. fetches every cited transaction and its payment records from Horizon;
6. checks transaction success and rebuilds recipient count, amount, asset and
   sorted hash set; and
7. fails with a non-zero exit code if the rebuilt record differs.

The functions `createAuditRecord()`, `anchorDisbursementBatch()` and
`verifyAuditCid()` are also exported from `src/index.ts` for embedding in an SDP
self-hoster's own workflow. This directory remains a private example package;
it is not a separately published SDK.

## Record and payment semantics

The anchored record has one versioned shape:

```json
{
  "schema": "nirium.sdp-audit.v1",
  "network": "testnet",
  "selection": { "type": "tx_hashes" },
  "recipientCount": 3,
  "totalAmount": "6.6000000",
  "asset": { "type": "native" },
  "txHashes": ["...", "...", "..."]
}
```

- `recipientCount` is the number of distinct on-chain destinations, not the
  number of operations. Classic and SAC forms of the same muxed destination
  are canonicalized to one `M...` address for counting. Destinations are used
  in memory and are not anchored.
- Amounts are parsed and summed as integer stroops, then formatted with exactly
  seven decimal places. JavaScript floating-point arithmetic is never used for
  monetary totals.
- Asset identity includes type, code and issuer. A mixed-asset batch is rejected
  instead of producing a meaningless combined total.
- Hashes must be unique and are stored in deterministic lowercase sort order.
- Each cited transaction must contain at least one selected, supported payment.
- Classic `payment` operations are supported.
- For an `invoke_host_function` payment record, every explicit `transfer` in
  Horizon's `asset_balance_changes` is treated as a separate payment; unrelated
  balance changes are ignored. A cited transaction with no supported transfer
  fails closed, as do path payments and mixed-asset aggregates.
- The operation's `from`/balance-change source is authoritative. SDP can use a
  channel account as the transaction envelope source while the payment operation
  originates from its distribution account.

Nirium caps the embedded record at 8 KiB. The bridge measures the exact UTF-8
serialization before signing or anchoring and asks the caller to narrow or split
an oversized batch manually. It does not introduce chunking, Merkle trees or
multiple-CID manifests beyond this issue's one-record scope.

To bound work before that exact preflight, one record accepts at most 119
transaction hashes: even the smallest valid record with 120 hashes exceeds 8
KiB. This is an early upper bound, not guaranteed capacity: the exact 8 KiB
check remains authoritative and can reject fewer hashes when other fields are
larger. Horizon pagination is also bounded to 100 pages by default (configurable
from 1 to 1000 through the library's `maxPages` option); a source window that
exceeds either limit fails explicitly and must be narrowed.

## Prior art: Providencia Onchain

The issue identifies [Providencia Onchain / VIIO](https://github.com/itrmachines/viio_poc)
as the deployment-specific prior art that motivated this work. The linked public
VIIO POC documents an
[`external_transfer`](https://github.com/ITRMachines/viio_poc/tree/master/external_transfer)
flow that returns a blockchain transaction hash and a project-specific
[`movements`](https://github.com/ITRMachines/viio_poc/tree/master/movements)
view. The public repository does not independently document every deployment
detail stated in the issue, so this README does not repeat those details as
verified facts.

This example credits that reconciliation pattern rather than claiming it as
original. It does not fork VIIO's code and is not a competing bespoke dashboard.
The actual difference is packaging: this is a generic, reusable read-and-anchor
adapter that an SDP self-hoster or another Stellar disbursement product can call
for its own completed batch.

## Real Testnet end-to-end evidence

On 2026-08-26 a self-hosted SDP v7.0.0 instance, built from official backend
commit [`d36cfaa`](https://github.com/stellar/stellar-disbursement-platform-backend/commit/d36cfaa490e5f3683440a53d5a3e5142f84418e3),
created disbursement `8ffa4b5e-d19e-4524-96c6-3707db2b2696`. SDP's own database
and Transaction Submission Service reported all three payments as `SUCCESS`,
with a total of `6.6000000` XLM from distribution account
`GDEAVYFKV3NUH76ES2SV2CCKMWY4HR2OYAIUHRQ6E46JOI6UE5X3CMDR`.
All three public transactions carry SDP-generated text memo
`sdp-728e51ea424a`; their envelope source is SDP channel account
`GBCU566MPPJ5FYGTMBQNH3IIY3VGVMX4DRGXCRNMDWJ36YH2JXABSPMX`, while Horizon's
payment `from` field identifies the distribution account above.

The bridge then accepted SDP's three resulting hashes, independently resolved
the public payments through Horizon, anchored the aggregate, fetched it back
from IPFS, recomputed its content hash, and re-read all three transactions from
Horizon. No receiver email, SDP receiver ID or destination address is included
in the audit record or in this evidence.

- CID: [`QmPBR9r3ax7u9smk6H7w7AjSciNh2AZKHwUB5sTyxwCSQD`](https://gateway.pinata.cloud/ipfs/QmPBR9r3ax7u9smk6H7w7AjSciNh2AZKHwUB5sTyxwCSQD)
- Recomputed content SHA-256:
  `7c7e6ad1ed8d13e6fafb4e9757046bb58889df661fd126b12b226edb95629f24`
- Payment operations: 3
- Aggregate: 3 recipients, `6.6000000` XLM
- Independently checked hashes:
  - [`539aad89…b464`](https://stellar.expert/explorer/testnet/tx/539aad89debbd03081b515ad4c85c3ac41797f62e3d437ea33763be0e987b464)
  - [`bef28fdf…f2ac`](https://stellar.expert/explorer/testnet/tx/bef28fdf5ebacc86fbf1f0a0814cda6736e7204c7a85307c7e01695a4a3cf2ac)
  - [`d1992530…37caf`](https://stellar.expert/explorer/testnet/tx/d199253093ef46e9c6619d37221579fc270d52ec803c0c0d1f834d883ac37caf)
- Agent signature: absent; no attestation key was configured for this run

Testnet is periodically reset and its Horizon transaction history is cleared.
After a reset, the CID can remain retrievable while Horizon correctly reports
these historical hashes as unavailable. That is an availability limitation, not
evidence that a previously verified transaction changed.

## Trust boundaries and privacy

- The bridge verifies on-chain facts for the cited hashes. A caller-provided hash
  list does not prove that the operator included every payment in a business
  batch. Source-window creation discovers the complete visible interval, but the
  CID verifier intentionally rechecks the cited transactions rather than making
  a stronger business-completeness claim.
- A normal HTTP IPFS gateway performs content-address validation on behalf of the
  client. The verifier does not embed an IPFS node or independently reconstruct
  the UnixFS DAG. Use a gateway you trust operationally or a local IPFS setup if
  your threat model requires a different retrieval boundary.
- A CID and matching hash prove integrity, not truth, authorship, notarization or
  legal validity. The optional agent signature adds authorship for the specific
  record hash.
- Raw recipient PII, SDP rows, memos and destination addresses are not anchored
  or printed. Transaction hashes are public references and allow an auditor to
  recover public on-chain destinations from Horizon; this bridge does not promise
  recipient anonymity.
- IPFS content cannot be deleted. Do not add personal data to the record schema.

## Development

```bash
npm run typecheck
npm test
npm run build
```

Tests use deterministic Horizon/IPFS fixtures and cover pagination, rate limits,
network mismatch, failed transactions, exact arithmetic, duplicate hashes,
mixed assets, multi-transfer SAC payments, muxed recipients, the 8 KiB cap,
content tampering,
forged signatures and the statement-substitution regression fixed by Nirium
[PR #60](https://github.com/nirium-protocol/nirium/pull/60).

## Official technical references

- [Horizon: retrieve a transaction's payments](https://developers.stellar.org/docs/data/apis/horizon/api-reference/retrieve-a-transactions-payments)
- [Horizon payment object](https://developers.stellar.org/docs/data/apis/horizon/api-reference/resources/payments/object)
- [Horizon operation object](https://developers.stellar.org/docs/data/apis/horizon/api-reference/resources/operations/object)
- [Horizon pagination](https://developers.stellar.org/docs/data/apis/horizon/api-reference/structure/pagination/page-arguments)
- [Horizon rate limiting](https://developers.stellar.org/docs/data/apis/horizon/api-reference/structure/rate-limiting)
- [Stellar Testnet resets](https://developers.stellar.org/docs/build/guides/basics/automate-reset-data)
- [Stellar Disbursement Platform architecture](https://developers.stellar.org/docs/platforms/stellar-disbursement-platform/admin-guide/design-and-architecture)
- [SDP embedded wallets and SAC transfers](https://developers.stellar.org/docs/platforms/stellar-disbursement-platform/admin-guide/embedded-wallets)
- [Sending and receiving payments with contract accounts](https://developers.stellar.org/docs/build/guides/transactions/send-and-receive-c-accounts)
- [Stellar muxed accounts](https://developers.stellar.org/docs/build/guides/transactions/pooled-accounts-muxed-accounts-memos)
- [IPFS content addressing and CIDs](https://docs.ipfs.tech/concepts/content-addressing/)
- [IPFS HTTP gateway trust model](https://docs.ipfs.tech/reference/http/gateway/)
- [TypeScript strict mode](https://www.typescriptlang.org/tsconfig/strict.html)
