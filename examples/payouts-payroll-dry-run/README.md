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

### Real testnet run (verified below)

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

**Evidence status:** The real testnet run and its on-chain transaction hash were verified on 2026-11-23; see below. The PR requires the actual transaction hash(es) linked to the payer's own testnet transactions, plus a demo screen recording of **2 minutes or less**. The PR description must explicitly say whether Nirium can share the video with credit to the author. Never invent hashes or reuse another contributor's transactions.

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

**These three Friendbot hashes are account-funding transactions, NOT contractor payout transactions.** The separately verified real payout is documented below. [PR #498](https://github.com/nirium-protocol/nirium/pull/498) includes the video evidence and remains open pending final maintainer approval. Offline suite: `npm run typecheck` PASS, `npm test` 6/6 PASS.

## Historical authentication blocker (resolved 2026-11-23)

- Rechecked on the original Mac worktree: `npm run typecheck` PASS; `npm test` **6/6 PASS**; own-key dry run PASS with identical digest `ceacea123986595db08c9251db270716c4c4c5810724b0e67938b5aecb163580`.
- Nirium agent health endpoint `https://nirium-agent.fly.dev/` returned HTTP 200 and online status. Public Payouts terms/history were reachable.
- Authentication was initially blocked: `.local/nirium-api-key` contained a **one-hour JWT** (issued 2026-11-23 16:54 UTC; expired 17:54 UTC), **not** a persistent `sk_free_…` API key. A protected SDK `getMarket()` request returned HTTP **401** with `Valid JWT token or API key required`.
- The official [API Keys console](https://nirium.xyz/keys) initially displayed **Not connected**. The owner subsequently verified wallet ownership and issued a persistent `sk_free_…` API key, saved privately (never committed). The replacement key passed the authenticated Nirium SDK API check.
- No payout was attempted while the credential was invalid. The blocker was subsequently resolved and a real testnet payout completed, with independently verified on-chain evidence below.

## Verified real Nirium Payouts testnet run (2026-11-23)

The contributor manually executed the real Payouts batch from the original Mac worktree using the locally held payer secret and an authenticated `sk_free_…` API key (both ignored by Git). The prior short-lived JWT authentication blocker was resolved. The real-run plan rows and SHA-256 digest **match the preceding dry run** exactly:

```text
MONTH 2026-11 | ASSET XLM | RECIPIENTS 2
1. C-001 | GAOIMKTOOQAQBN5TT2QNOHHJY3ICCWF2MSZ7SBL7E45ZXI3MNGRKLHBB | 1.0000000 XLM
2. C-002 | GDAOO3P4T5G53ZSS3AXBXK4RQ5DMI5WBCIAIUST52D44V24F7JGDUC5W | 1.5000000 XLM
TOTAL 2.5000000 XLM
SHA256 plan digest: ceacea123986595db08c9251db270716c4c4c5810724b0e67938b5aecb163580
Nirium run: payroll-2026-11-ceacea123986
Testnet tx: https://stellar.expert/explorer/testnet/tx/cc5bd7be470702994fe271da30577edd40d3426afa8fbaed343c7e858be8edfb
Receipt CID: QmTnncskA1Pe6o3yVLfE3Boi8hu2oRWGNZnE3XUdwX1VhU
```

**Receipt verification note (2026-11-27):** This CID identifies an unsigned, hash-only record returned by Nirium, not a cryptographically verified receipt. As reported in the [maintainer review](https://github.com/nirium-protocol/nirium/pull/498#pullrequestreview-6044984721), `nirium-cli verify` returns `verified: false` because the signature is absent. This does not affect the independent on-chain verification of the Stellar testnet payout below.

**Independent on-chain verification:** Stellar Horizon testnet reports the transaction `cc5bd7be470702994fe271da30577edd40d3426afa8fbaed343c7e858be8edfb` **successful** at 2026-11-23 18:33:57 UTC, signed/submitted from payer `GCUV5CMMWG4NNAHA42N2TVKBZWRSYW2GYXIMAQOX6E3CWRUAZ3O3C57T`. It contains exactly **two native XLM payment operations**: 1.0000000 XLM to C-001 and 1.5000000 XLM to C-002. Total fees: 200 stroops. The ignored local ledger `ledger/2026-11.json` records `state: completed` and the matching run ID, digest, tx hash and CID.

**Live ledger replay-guard check (no second broadcast):** Calling `executePayroll()` for the same month with a client spy and existing ledger rejects with `Payroll 2026-11 already submitted (...); no duplicate payment.` **Zero** client method calls were made; the ledger remained completed and the lock was removed. The offline test suite also covers replay protection. Do not reset or delete the month ledger.

**Screen recording:** Captured locally on the Mac as a 36.15-second MOV on 2026-11-23. Duration is within the required 2-minute limit. Video frames were visually reviewed for readable dry-run/real-run output and absence of exposed secrets. Uploaded and posted as [PR #498 comment](https://github.com/nirium-protocol/nirium/pull/498#issuecomment-7110539564), with the [GitHub video asset](https://github.com/user-attachments/assets/df1fad7f-6d5d-4c29-8edb-b11721379ca1). Sharing permission for Nirium's external channels is **not granted**. The maintainer's 2026-11-24 review confirmed the payout, replay guard, tests, video and green CI; final approval remains pending.

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
- [x] Same numbered rows from dry run and actual Nirium real run shown in README, with command outputs
- [x] Actual payer-signed payout transaction hash linked on Stellar Expert (testnet), operations independently verified via Horizon
- [x] Local offline tests and typecheck pass, results recorded (6/6 tests)
- [x] 36-second demo recording attached in [PR comment](https://github.com/nirium-protocol/nirium/pull/498#issuecomment-7110539564) and linked from the PR description; external sharing permission **not granted**
- [x] [PR #498](https://github.com/nirium-protocol/nirium/pull/498) links `Closes #456` and includes the AI-assistance commit trailer; maintainer review confirmed green CI on 2026-11-24.
- [x] Review follow-up (2026-11-27): README clarifies that the optional receipt is unsigned and not verified; payout verification remains independent.
- [ ] Final maintainer approval and merge.

The program keeps all seed keys out of tracked files and will never send them to a Nirium node.
