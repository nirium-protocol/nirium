# Monthly Contractor Payroll: Nirium Payouts + Signing-Free Dry Run

Example for [issue #456](https://github.com/nirium-protocol/nirium/issues/456).
**Stellar TESTNET only.** Contractor/service invoices, not salaried employee payroll. No custody: the payer signs locally.

## Workflow

The monthly CSV contains `contractor_id,wallet,amount`, one invoice recipient per line (up to 100). Amounts are XLM with at most seven decimal places. A unique wallet and contractor ID per month are required. This example deliberately uses native **XLM**, avoiding external USDC issuers and recipient trustlines.

```sh
npm install --no-audit --no-fund
npm run dry-run -- --month 2026-11 --file fixtures/2026-11.csv
npm run typecheck
npm test
```

The fixture wallets are **illustrative public addresses from an existing testnet example**. They are NOT evidence of your own testnet accounts and MUST be replaced by wallets that you generated/own before a real payout.

### Dry-run output (illustrative fixture)

```text
MONTH 2026-11 | ASSET XLM | RECIPIENTS 2
1. C-001 | GAP6R5XPNHSUIIIJGXRGRRKTJT4YPXQQIUWRQ37PXDGSAJVMRDNBCNZG | 1.0000000 XLM
2. C-002 | GD5GYULPOANDMTMIMZ3SNPJAWMAGF4XM5MJ3ZLFL3FSDXSPHHXD3VJFC | 1.5000000 XLM
TOTAL 2.5000000 XLM
```

The dry run prints the same plan rows as a real run, with a deterministic SHA-256 digest and an explicit `DRY RUN` notice. It never reads private keys, invokes Nirium, signs or writes a ledger.

### Real testnet run (not performed in this README)

1. Generate **your own** payer and recipient Stellar testnet keypairs and fund them through [Friendbot](https://friendbot.stellar.org). Store all seeds securely outside source control. Use those recipient G-addresses in a new month's CSV and verify funded accounts.
2. Copy `.env.example` to ignored `.env`, set the payer's **own** `STELLAR_SECRET_KEY` and a legitimate `NIRIUM_API_KEY`. Verify `NIRIUM_BASE_URL` targets the testnet node.
3. Preview **exactly the same input** before executing:

```sh
npm run dry-run -- --month 2026-11 --file payroll-2026-11.csv
npm start -- --execute --month 2026-11 --file payroll-2026-11.csv
```

A real run first prints the same `MONTH`, numbered rows and `TOTAL`, then records a month-level pending ledger and asks Nirium's Payouts node for unsigned XDR. Before any signature, it verifies the payer's source account and **every** XLM payment's destination and amount, refusing additional operations or changed transactions. The signer additionally rejects excessive transaction fees (more than 10,000 stroops per payment operation). Only the payer's private seed signs locally. The API receives signed XDR, never the seed.

Expected additional real-run lines **after a successful testnet transaction**:

```text
Nirium run: <run id returned by the node>
Testnet tx: https://stellar.expert/explorer/testnet/tx/<real 64-character hash>
Receipt CID: <CID if supplied by the node>
```

**Evidence status:** No transaction is claimed here until a real testnet run has returned a hash and that hash is verified on Stellar Expert. The PR requires the actual transaction hash(es) linked to the payer's own testnet transactions, plus a demo screen recording of **2 minutes or less**. The PR description must explicitly say whether Nirium can share the video with credit to the author. Never invent hashes or reuse another contributor's transactions.

## Verified local testnet preparation (2026-11-23)

The following accounts were freshly generated with random keys on the contributor's own Mac. Their secret seeds are saved only in ignored `.local/testnet-keys.json` (mode 0600), not in this repository. Friendbot returned HTTP 200 for payer and both recipients:

- Payer: `GCUV5CMMWG4NNAHA42N2TVKBZWRSYW2GYXIMAQOX6E3CWRUAZ3O3C57T` — [Friendbot funding transaction](https://stellar.expert/explorer/testnet/tx/297507698a88f61ecd58016fdc3ce7db19e8b91c8f496a96312bc300f08e932a)
- Recipient C-001: `GAOIMKTOOQAQBN5TT2QNOHHJY3ICCWF2MSZ7SBL7E45ZXI3MNGRKLHBB` — [funding transaction](https://stellar.expert/explorer/testnet/tx/b580768fff6cd8c64849df78f8dec24e057bb82344dddf2e0b0cb2d53e44f227)
- Recipient C-002: `GDAOO3P4T5G53ZSS3AXBXK4RQ5DMI5WBCIAIUST52D44V24F7JGDUC5W` — [funding transaction](https://stellar.expert/explorer/testnet/tx/dc8b45b813bbc677e0b2374e5d60cb359e25871b2d8626994b41d9da16532deb)

Observed own-key **dry-run** (PASS), using `.local/payroll-2026-11.csv`:

```text
MONTH 2026-11 | ASSET XLM | RECIPIENTS 2
1. C-001 | GAOIMKTOOQAQBN5TT2QNOHHJY3ICCWF2MSZ7SBL7E45ZXI3MNGRKLHBB | 1.0000000 XLM
2. C-002 | GDAOO3P4T5G53ZSS3AXBXK4RQ5DMI5WBCIAIUST52D44V24F7JGDUC5W | 1.5000000 XLM
TOTAL 2.5000000 XLM
SHA256 plan digest: ceacea123986595db08c9251db270716c4c4c5810724b0e67938b5aecb163580
DRY RUN: no keys read, no network requests, no ledger writes.
```

**These three Friendbot hashes are account-funding transactions, NOT contractor payout transactions.** The payer-signed Nirium payout remains **NOT RUN** after the execution tool's security restriction. The real-run output, payout hash, and screen recording are pending. [Draft PR #498](https://github.com/nirium-protocol/nirium/pull/498) is open for early review; the bounty is **not completed**. Offline suite after the fee guard: `npm run typecheck` PASS, `npm test` 6/6 PASS.
## Duplicate-payment protection and recovery

`ledger/YYYY-MM.json` (ignored by Git) is written **before** any network request. Any second invocation for the same month fails closed, regardless of CSV modifications. A `pending` record (including timeouts and unknown submission outcomes) blocks all automatic retries; reconcile the transaction on testnet using the local run ID and your payer's transaction history before a deliberate operator-controlled recovery. The lock file protects concurrent runs; a crash may leave a lock, which also blocks automatic repeat payments. Do not delete or reset a pending ledger/lock to retry blindly. Back up your local ledger: losing it also loses this client-side protection. This is local, single-host idempotency, not a blockchain-wide payment registry.

## Offline verification

```sh
npm test
npm run typecheck
```

The tests create test-only ephemeral Stellar keypairs and XDR locally; they stub both Nirium SDK calls and require **zero network**. They cover stable dry-run rows, rejected malformed payroll files, local signing, transaction tampering, successful ledger recording, duplicate prevention and ambiguous submission failures.

## Testnet evidence / maintainers

- [x] Payer and recipient keypairs generated locally, Friendbot returned HTTP 200 for all three funding requests
- [ ] Same numbered rows from dry run and actual Nirium real run shown in README, with command outputs
- [ ] Actual payer-signed payout transaction hash(es) linked on Stellar Expert (testnet)
- [x] Local offline tests and typecheck pass, results recorded (6/6 tests)
- [ ] Demo recording <=2 minutes attached or linked in PR description; permission to share is currently **not granted**
- [x] [Draft PR #498](https://github.com/nirium-protocol/nirium/pull/498) links `Closes #456` and the AI-assistance commit trailer is present
The program keeps all seed keys out of tracked files and will never send them to a Nirium node.
