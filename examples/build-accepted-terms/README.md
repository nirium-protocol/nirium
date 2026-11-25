# Accepted terms: which version the customer agreed to before paying

A payment shows who paid and how much. It doesn't show which version of the terms the customer had agreed to. Here the customer signs that acceptance with their own Stellar key and anchors only its hash with Nirium Audit Trail, on testnet.

This is a demo by the Nirium team with fake terms and a throwaway key. It is our own test, not usage.

## What the receipt proves, and what it doesn't

- **Proves:** the acceptance file hasn't changed since it was anchored, which key signed it, and the exact terms file it names (by SHA-256).
- **Doesn't prove:** who holds that key, that the customer read or understood the terms, or that the acceptance is legally valid. `acceptedAt` is declared by the signer, and the receipt's own time is the Nirium node's clock, not a ledger time.
- **Privacy:** the node receives the hash, the tag and the signature. The file keeps a salted hash of the customer id. In a real shop, keep the file and the salt private. They are in `records/` only because this is a demo.

## Run it

Node.js 22.12 or newer.

```bash
npm install
npm test          # no network
npm run check -- order-1001 --terms terms/terms-v2.md
```

To make your own (a testnet key made only for this; it needs no funds):

```bash
export CUSTOMER_SECRET_KEY=S...
npm run accept -- --terms terms/terms-v2.md --terms-version v2 --order order-2001 --customer demo-customer
```

## Evidence (testnet, 25 Nov 2026, our own key)

| | |
|---|---|
| CID | [`QmfZv34X8zBcvTSJyrqL1CGmjtkwNsH3Tzm1mdu46Nn3n9`](https://nirium.xyz/verify?cid=QmfZv34X8zBcvTSJyrqL1CGmjtkwNsH3Tzm1mdu46Nn3n9) |
| File | [`records/order-1001.json`](records/order-1001.json), SHA-256 `68013babd68d0edaea734632870b2b3746f208c72c07e2aacc7fcf8e1b2e252c` |
| Signer | `GDTX4G4LGEX6KYSSKXYCSYVZWDQ44PKQGRTXQHDU6H7BDNQJZ6C5NIFB` |

You can also open the CID on nirium.xyz/verify and choose `records/order-1001.json` under "Compare with your file".

The accepted terms:

```text
$ npm run check -- order-1001 --terms terms/terms-v2.md
OK: the key named in the file signed an acceptance of these exact terms for order-1001.
```

Another version of the terms:

```text
$ npm run check -- order-1001 --terms terms/terms-v1.md
FAIL: These are not the terms that were accepted (version v2).
```

An edited acceptance (the order changed to `order-1002`):

```text
FAIL: The acceptance file is not the one in the receipt: it changed, or it belongs to another receipt.
FAIL: nirium verify did not pass for this file and CID.
```
