# Build with Nirium: reproducible run records

Hashes a run's input files, code and output files into one run record, signs
`nirium-audit-v1:<sha256>` with your own Stellar testnet key, and anchors the
hash via the Nirium Audit Trail (testnet). Large files are hashed locally and
never uploaded; only the record hash is public.

## Usage
```bash
pip install stellar-sdk nirium          # nirium = published Python SDK
export STELLAR_TESTNET_SECRET=S...      # your own testnet key, never committed
python run_analysis.py data/run1.txt --out results/run1.json
python run_analysis.py data/run2.txt --out results/run2.json
python check_run.py receipts/<hash12>.json          # recompute + nirium verify
python -m unittest tests/test_all.py                # offline, HTTP mocked
```

## Receipts
| Run | Input | CID | Hash | Verify |
|-----|-------|-----|------|--------|
| 1 | data/run1.txt | _TODO_ | _TODO_ | _paste output_ |
| 2 | data/run2.txt | _TODO_ | _TODO_ | _paste output_ |

Tampered case (one input changed): _paste failing output_

## What a receipt proves, and what it doesn't
Proves: the record has not changed since it was anchored, and which key signed it.
Does not prove: that the content is true or the analysis correct. `anchoredAt`
is the Nirium node's clock, not a ledger time.
