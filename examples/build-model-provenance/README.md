# Build with Nirium: provenance for a model or dataset (Audit Trail, testnet)

Keep the details of how a model or dataset was made **private**, and publish only a **signed public receipt** that proves that exact record existed at a point in time.

- **Private record** (stays on your disk): SHA-256 of the weights or dataset file, training config, data source names, code commit.
- **Public receipt** (IPFS, via the Nirium Audit Trail node): the SHA-256 *of that record*, a timestamp, and your Stellar testnet signature over `nirium-audit-v1:<sha256>`.

This example only calls the public HTTP API (`POST https://nirium-agent.fly.dev/api/audit/log`) and the published CLI. No core Nirium package is modified.

## Quick start

```bash
npm install
npm run keygen                      # prints a throwaway testnet signer; needs no funds
export PROVENANCE_SIGNER_SECRET=S...   # paste it (see .env.example)

npm run demo-data                   # synthetic demo/model-v1.bin and model-v2.bin
echo '{"architecture":"tiny-mlp","epochs":3,"learning_rate":0.001,"seed":42}' > demo/train-config.json

for v in v1 v2; do
  npm run -s record -- demo/model-$v.bin --name demo-classifier --version $v \
    --config demo/train-config.json \
    --data-source public-sample-corpus --data-source synthetic-augmentations
  npm run -s anchor -- .provenance/demo-classifier-$v.record.json   # tag: wave11-model-provenance-demo-classifier-$v
done
```

`record` works on any local file (`--kind dataset` for datasets). The code commit defaults to `git rev-parse HEAD`; override with `--code-commit`. Tags always start with `wave11-` (override with `--tag wave11-...`).

## Check two versions of the same model

```bash
P=.provenance
# matching weights: passes
npm run -s check-model -- demo/model-v1.bin --record $P/demo-classifier-v1.record.json --receipt $P/demo-classifier-v1.receipt.json
npm run -s check-model -- demo/model-v2.bin --record $P/demo-classifier-v2.record.json --receipt $P/demo-classifier-v2.receipt.json
# swapped weights: v2 file against v1's record and receipt, exits 1
npm run -s check-model -- demo/model-v2.bin --record $P/demo-classifier-v1.record.json --receipt $P/demo-classifier-v1.receipt.json
```

`check-model` runs three checks and exits non-zero if any fails:

1. the file's SHA-256 equals the one in the private record (**fails on swapped weights**);
2. the record's SHA-256 equals the receipt's hash (fails if the record was edited);
3. `npx nirium-cli verify <cid> --hash <sha256>` passes: the IPFS document exists, its hash matches, and the signature is valid (`--offline` skips this one).

Real output from a run on 19 Nov 2026 (swapped weights):

```
PASS  record parses  (nirium-model-provenance/v1)
FAIL  weights match record  (file is 02681bf4…e13e, record says db98ddb9…a138)
PASS  record matches receipt
PASS  receipt verifies (cid, hash, signature)

FAILED: these weights are NOT covered by the receipt
```

Note that the receipt itself still verifies. It is the weights that don't match, which is the point.

## Verify a receipt yourself (no access to the record needed)

```bash
npx nirium-cli verify QmQ7CZAnvsLkx8LgJbkBmTBqDtzfiR65a2Gkzzed19pcnn \
  --hash 37c6a088d46289b2a04492b9a3581afebcc865f51eaf57cc06de27e8f9bc783b
```

Testnet receipts from this example's demo run (synthetic weights, throwaway signer `GDPY5IHP…H3CQZ`):

| Version | CID | Record sha256 |
|---|---|---|
| v1 | `QmQ7CZAnvsLkx8LgJbkBmTBqDtzfiR65a2Gkzzed19pcnn` | `37c6a088d46289b2a04492b9a3581afebcc865f51eaf57cc06de27e8f9bc783b` |
| v2 | `QmaCgf9dV61YoJ5BHJ2ezxDBShxB8PoPKhN3CduJfQCmaQ` | `7eb839f2f0eb0cb63c1eb7b28e47edcf6099523c7b40cccd84a793c8fc233b2a` |

> **Node version:** on 19 Nov 2026, `npx nirium-cli verify` (nirium-cli 3.2.4) crashed on Node 22.14 with `ERR_REQUIRE_CYCLE_MODULE` from a transitive `@stellar/stellar-sdk` dependency, before reaching any verification logic. It ran correctly on Node 24. If you hit that error, use a newer Node for the verify step.

## Sample record (v1)

This is the whole private record. It contains no personal data, and it is what gets hashed:

```json
{
  "artifact": { "bytes": 16384, "file": "model-v1.bin", "sha256": "db98ddb9f0fa24be8fec4c0e780848d8e54a6d613f84754d9ad5926fe723a138" },
  "code": { "commit": "07f90db000000000000000000000000000000000" },
  "created_at": "2026-11-19T09:44:50.486Z",
  "data_sources": ["public-sample-corpus", "synthetic-augmentations"],
  "kind": "model",
  "name": "demo-classifier",
  "schema": "nirium-model-provenance/v1",
  "training": { "config": { "architecture": "tiny-mlp", "epochs": 3, "learning_rate": 0.001, "seed": 42 } },
  "version": "v1"
}
```

(The commit above is a placeholder for the demo; `record` uses your real `HEAD` by default.)

The record is written with sorted keys, so its bytes, and therefore its hash, are reproducible. `npx nirium-cli verify <cid> --evidence <record.json>` works too.

## Why the record stays private

Once published, you can't take a receipt back: anyone may have copied it. Don't anchor anything you wouldn't want public. Training configs, dataset names and commits often reveal unreleased work, licensing arrangements, or the people and communities behind a dataset. So only a 64-character hash is published. The receipt reveals nothing about the record by itself, and you choose later, per auditor or partner, whether to hand over the record. They hash it and compare. Never put personal data in a record you intend to anchor, and treat dataset *names* as sensitive if the name itself is.

## What the receipt proves, and what it doesn't

**It proves**
- A record with this exact hash existed no later than the anchor time.
- The holder of the signing key produced or endorsed that hash (`nirium-audit-v1:<sha256>`, ed25519).
- Together with the private record, that a specific weights file, config, data source list and commit were declared together. Change any byte and a check fails.

**It does not prove**
- That the record is *true*. Nobody verified that the model was actually trained on those sources with that config, or that the commit produced the weights. It is a signed claim, fixed in time.
- Who the signer is. A key is not an identity; you must separately tell people which key is yours. This demo uses a throwaway key.
- That the model is good, safe, unbiased, or licensed for its data.
- That nobody else has the same weights, or that an earlier version didn't exist. It only gives a latest-possible date.
- Anything about mainnet. This is testnet and free-beta, rate-limited; don't treat it as a durability guarantee.

## Tests

```bash
npm test   # offline: hashing, signing statement, tag rule, matching/swapped/tampered cases
```

## Files

| Path | Purpose |
|---|---|
| `src/provenance.mjs` | hash, record, anchor, and check logic |
| `src/cli.mjs` | `keygen`, `demo-data`, `record`, `anchor`, `check-model` |
| `test/provenance.test.mjs` | offline tests (network mocked) |
| `.provenance/`, `demo/` | generated, git-ignored (private records live here) |
