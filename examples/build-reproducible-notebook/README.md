# Build with Nirium: reproducible run records

Hashes a run's input files, code and output files into one run record, signs
`nirium-audit-v1:<sha256>` with your own Stellar testnet key, and anchors the
hash via the Nirium Audit Trail (testnet). Large files are hashed locally and
never uploaded; only the record hash is public.

## Usage
```bash
pip install stellar-sdk nirium
export STELLAR_TESTNET_SECRET=S...   # your own testnet key, never committed
cd examples/build-reproducible-notebook
python run_analysis.py data/run1.txt --out results/run1.json
python run_analysis.py data/run2.txt --out results/run2.json
python check_run.py receipts/<hash12>.json   # recompute + nirium verify
python tests/test_all.py                     # offline, HTTP mocked
```

`check_run.py` recomputes the record from the files, compares its hash with the
receipt, then runs `npx nirium-cli verify <cid> --hash <sha256>`.

## Receipts
Signed by testnet key `GC3ADSZYQZWOQASTNZQ4PWA7GR6FAETSQBS4Q4EGZZXNZQYST3JXH5XT`,
tag `wave11-reproducible-notebook`.

| Run | Input | CID | Record hash |
|-----|-------|-----|-------------|
| 1 | data/run1.txt | `QmdvnYaQEtqrQQ19hZ7hphbU6GAKknnvS9aMGezq5iMNVK` | `c5f1ee188d9180c8d63497d29c7f88f8798f722ed8212044264774dbd092809a` |
| 2 | data/run2.txt | `QmYgs3Ae89A7jFf9mkZYfk97UEg7gTBPB2E2TcDd5EyaYQ` | `d8428bfa58dd6b1879472dbf09d1c2577f449fcd949eafab0b3cc31d754334de` |

Receipt files: `receipts/c5f1ee188d91.json`, `receipts/d8428bfa58dd.json`.

### Verify output (fresh clone)
```
--- RUN 1 ---
OK: record matches files and passes nirium verify
--- RUN 2 ---
OK: record matches files and passes nirium verify
```

### Tampered cases
Appending a line to `data/run1.txt`:
```
FAIL: files changed (expected c5f1ee188d9180c8d63497d29c7f88f8798f722ed8212044264774dbd092809a, got bfeab19880fb8c89cd13f7021203ae468abbd5684cadaf13e6ead4fadb248c3b)
```
Appending a line to `results/run2.json`:
```
FAIL: files changed (expected d8428bfa58dd6b1879472dbf09d1c2577f449fcd949eafab0b3cc31d754334de, got fab65ab10426f471132c0820f4eca4d16275efc460af561c4273242a1349a2b9)
```

## What a receipt proves, and what it doesn't
Proves: the record has not changed since it was anchored, and which key signed it.
Does not prove: that the content is true or the analysis correct. `anchoredAt`
is the Nirium node's clock, not a ledger time.

Do not edit `run_analysis.py` after anchoring: its hash is part of each record.
