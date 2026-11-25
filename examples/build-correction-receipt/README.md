# Correction receipt: fix a mistake without rewriting the original

An anchored receipt can't be edited, so what happens when an invoice was wrong? The issuer anchors a second document that names the first one by CID and hash, says what changed and why, and signs it with the same key. Both stay visible. Testnet, with Nirium Audit Trail.

This is a demo by the Nirium team with a fake invoice and a throwaway key. It is our own test, not usage.

## What the receipts prove, and what they don't

- **Prove:** neither document has changed since it was anchored, the same key signed both, and the correction names that exact original. The order doesn't depend on a clock: the correction contains the original's CID and hash, so it was written after the original's content existed.
- **Don't prove:** that the new total is right, that the customer agreed, or that a tax authority accepts it. This is not a tax document. The receipts' times are the Nirium node's clock, not a ledger time.
- **Limit:** someone who holds only the first CID can't tell that a correction exists. The issuer has to share the whole chain, and could leave out the last one.

## Run it

Node.js 22.12 or newer.

```bash
npm install
npm test          # no network
npm run check -- A-12
```

To make your own (a testnet key made only for this; it needs no funds):

```bash
export ISSUER_SECRET_KEY=S...
npm run issue -- B-01 --total 120.00 --currency USD
npm run correct -- B-01 --total 100.00 --reason "Shipping was charged twice"
```

## Evidence (testnet, 25 Nov 2026, our own key)

| Document | CID | SHA-256 |
|---|---|---|
| [`A-12.0.json`](records/A-12.0.json), invoice, 120.00 | [`QmWDQGzF2naWgrP1uh5BNSBMKs7d6Az6Lgy2aVJ3dcKjB3`](https://nirium.xyz/verify?cid=QmWDQGzF2naWgrP1uh5BNSBMKs7d6Az6Lgy2aVJ3dcKjB3) | `fcca808ac859043d1bfdf64b51afbcbbfef3459faab8d42575725df81761a539` |
| [`A-12.1.json`](records/A-12.1.json), correction, 100.00 | [`QmaquPQ3g6ArzET9A7uuxJgVqpR5zwYLkaXqMDSpf3J5Q6`](https://nirium.xyz/verify?cid=QmaquPQ3g6ArzET9A7uuxJgVqpR5zwYLkaXqMDSpf3J5Q6) | `042705a71758d8f1593bb5e5635541f327bc2cb34bbefb4f76bf7fda8902aee3` |

Signer of both: `GCSJVDW2EAXHB6QEBR5VVHTPCRBQ2YA5DIBRME3GT52G7XEACFYVZ4TP`.

```text
$ npm run check -- A-12
OK: every document verifies and each correction points to the one before it. Current total: 100.00
```

After rewriting the original total to 100.00 in `A-12.0.json`:

```text
FAIL: Document 0 is not the one in its receipt.
FAIL: nirium verify did not pass for document 0.
FAIL: Document 1 starts from the wrong total.
```
