# Logistics Checkpoints: Multi-Party Signed Receipts at Each Handoff on Stellar Testnet

A shipment travels through 3 or more handoffs in a supply chain (e.g., Origin Manufacturer → Freight Carrier → Distribution Depot → Destination Retailer). At each checkpoint, the receiving party inspects the shipment, hashes the scan data with location and time, and signs the receipt with its **own distinct Stellar keypair**. Only the **SHA-256 hash** and the party's cryptographic attestation (`nirium-audit-v1:<sha256>`, tag `wave11-logistics-checkpoints`) are anchored to Nirium Audit Trail.

Physical shipping data, internal manifests, and private coordinates stay off-chain in private store `.checkpoints/`. Anyone with the sequence of receipts can verify:
1. **Receipt authenticity:** `npx nirium-cli verify <CID> --hash <sha256>` validates that each receipt was signed by that party's registered Stellar key and that the hash has not been altered.
2. **Chain of custody integrity:** `check-chain <shipment-id>` verifies that handoffs progressed in strict sequential order (`0, 1, 2, ...`), that every handoff's `previousHandoffCid` cryptographically anchors to the prior handoff, that timestamps are non-decreasing, and that each party signed with their own key.
3. **Broken chain detection:** If any handoff is omitted, re-ordered, signed by an unauthorized party, or tampered on disk, the verifier halts with explicit diagnostic errors.

---

## What a Receipt Proves — and What It Doesn't

A receipt (CID) proves:
- **Evidence immutability:** The SHA-256 hash of the canonical handoff record (shipment ID, index, party ID, location label, timestamp, scan hash, and previous CID) was anchored at the stated time. If anyone tampers with a record on disk or swaps the barcode scan, the recomputed hash diverges and `nirium-cli verify` fails.
- **Party non-repudiation:** The receiving party signed `nirium-audit-v1:<sha256>` with their own Stellar keypair. No party can sign on behalf of another party.
- **Sequential provenance:** By embedding `previousHandoffCid`, handoff $N$ directly commits to the immutable CID of handoff $N-1$, forming an unbroken cryptographic hash chain.

It does **not** prove:
- **Physical contents truth:** A party could scan an empty container or record an inaccurate location label. Nirium Audit Trail fixes *who stated what and when*, establishing accountability rather than physical omniscience.
- **Independent ledger time:** `anchoredAt` is the Nirium Audit Trail node's timestamp when the anchor was accepted.
- **Custody of funds:** This example anchors off-chain logistics provenance records only; it does not transfer tokens or custody on-chain.

---

## Layout

```text
src/record.ts            HandoffRecord schema, canonical JSON serialization, SHA-256 helpers, attestation
src/store.ts             Local storage for shipment handoffs and receipts (.checkpoints/)
src/checkpoint.ts        recordHandoff: signs attestation with party key and anchors hash to Audit Trail
src/chain.ts             verifyShipmentChain: sequence, CID linkage, signer isolation, nirium-cli verify
src/demo.ts              4-party logistics transit simulation (valid chain + broken chain scenarios)
src/cli.ts               CLI interface: demo | check-chain <id> | record-handoff | receipts [--new-key]
src/testnet-evidence.ts  Submits real on-chain Stellar testnet transactions and anchors live CIDs
test/                    Offline unit tests (mocked HTTP; zero network calls)
```

---

## Real Stellar Testnet Evidence

All 4 logistics parties were generated with their own distinct testnet keypairs, funded via Friendbot, and submitted real on-chain Stellar testnet transactions (`manageData` checkpoint evidence). Each handoff was anchored to live Nirium Audit Trail:

| Step | Party | Public Key | Transaction Hash | Stellar Expert Link | Nirium CID |
|---|---|---|---|---|---|
| **Handoff 0** (Origin) | `origin-manufacturer` | `GDTWMTILHQRKVGPFALJLO2IJRUIDQKNK7WF472GCI2YFRHSCXZ5KTHUZ` | `d23065b0f6ca8354da0fe86747224376152b7c9f7f794d0ab83865130ae8f24d` | [View on Stellar Expert](https://stellar.expert/explorer/testnet/tx/d23065b0f6ca8354da0fe86747224376152b7c9f7f794d0ab83865130ae8f24d) | `QmRCNTPUQB8smQHFnXvqSGF2eQZpn9eGKw6oaQi3rx9Scz` |
| **Handoff 1** (Carrier) | `freight-carrier` | `GB4SYLEVSRWDDGJDQ6NOQPC54ZIX6WUSS6SKNFURUDABRZX545Z3BJOM` | `aea07ed633338649669b9474d56fd4ff3c91f83ece3b97bda7ae44b5ce4be4f6` | [View on Stellar Expert](https://stellar.expert/explorer/testnet/tx/aea07ed633338649669b9474d56fd4ff3c91f83ece3b97bda7ae44b5ce4be4f6) | `QmVfw6vdzh8n1crJaHG7ZiVa6mPx5JpjMh2uKuw7MeVx5z` |
| **Handoff 2** (Depot) | `distribution-depot` | `GAE4HOO5QMA554RXAEVYQBJCBXNIZ2S5XBPCNSFW3HT6KO3H3AGTSSMA` | `b0fbfe518d40f5f3449af69241263ed11c3939b5374e5fef4d0c71b0bcf35f60` | [View on Stellar Expert](https://stellar.expert/explorer/testnet/tx/b0fbfe518d40f5f3449af69241263ed11c3939b5374e5fef4d0c71b0bcf35f60) | `Qma4BTqGseei8UcUERSMjAjghDhbNch7exAfj1MYyx6k21` |
| **Handoff 3** (Retail) | `destination-retailer` | `GCQMASGKBGHEZRYXOWLQVVQEFUNWB3BAC3PV7AWB7WBUD4ISVYQCCPEI` | `897f74e1e45a63db82d6621054aab4ee4b1e3090918ee43d6280e4266ed04659` | [View on Stellar Expert](https://stellar.expert/explorer/testnet/tx/897f74e1e45a63db82d6621054aab4ee4b1e3090918ee43d6280e4266ed04659) | `QmRX7SjLBbsPHnGVR3vrxrmi3MBdAeKa4b19KEWtBy4VMR` |

---

## Verification & Broken Chain Catching

### 1. Live Chain Verification

Running `npm run demo` executes a valid 4-party transit followed by broken chain simulation:

```text
=== NIRIUM LOGISTICS CHECKPOINTS: MULTI-PARTY DEMO ===

Participating Logistics Parties:
- origin-manufacturer      (Austin Electronics Fab): GDYKRJJ7S5JGEKPKOMXC4J23WFBE27BNTF2TGJBAQQZXTKM4JKGBY5OU
- freight-carrier          (Midwest Intermodal Carrier): GCENQCETENTS4ZHK52UJQVGJRPQRUV4BFK3ORRPTNZH3VC25RWDHINQN
- distribution-depot       (Coastal Distribution Center): GALMGPPQ52YWZ6PCLJ56H7PD7SHWPBP3X2IINTWR7ZFJWDI5A44LCQ5M
- destination-retailer     (Metro Flagship Store #42): GCOXYKUCHBXZH6XGALQD64MQSOL6VQ4JTYDB5A4SPWZVPIISSMRTWIAB

Audit Trail Tag: wave11-logistics-checkpoints

--- Scenario 1: Valid 4-Party Chain (SHP-VALID-8288) ---
[Handoff 0] origin-manufacturer    @ Austin, TX Facility (Bay 4)    -> CID: QmT1iUqC6JBsEgJcb9zUmrjgizvVV3X9QzEHVkT9vVZwQA
[Handoff 1] freight-carrier        @ Chicago Hub (Dock 12)          -> CID: QmdXUbpeCA3DSwa794W5pTAggJAv7wvH3Fc888Gwykq8bE
[Handoff 2] distribution-depot     @ Newark Logistics Park (Bldg C) -> CID: QmZ8NRJSAp4V2B8nWnKvDYnnxymdjhc2SvdGzfokLQWX7h
[Handoff 3] destination-retailer   @ Brooklyn, NY Storefront        -> CID: QmTKkxrkmg8PumwnsTmpqB1BBx89hxrt9yWVZ7DQPGVa44

Verifying chain integrity with 'nirium-cli verify' & provenance rules...
Chain Valid: YES (PASSED)
```

### 2. Broken Chain Caught & Flagged (Missing Handoff #1)

When a shipment jumps from origin (index 0) to distribution depot (index 2) skipping freight carrier (index 1), the verifier immediately halts and flags the chain breach:

```text
--- Scenario 2: Broken Chain - Missing Handoff (SHP-BROKEN-1752) ---
Verifying broken chain integrity...
Chain Valid: CAUGHT & FLAGGED (EXPECTED)
Flagged Integrity Errors:
 ❌ Chain incomplete: shipment has 2 handoff(s); requires at least 3 handoffs for valid multi-party transit.
 ❌ Out-of-order or missing handoff: expected index 1, found 2.
```

### 3. Individual Receipt Verification via CLI

Every anchored CID can also be independently validated using `npx nirium-cli verify <CID>`:

```bash
npx nirium-cli verify QmRCNTPUQB8smQHFnXvqSGF2eQZpn9eGKw6oaQi3rx9Scz
```

Output:
```text
MODE: hash-only
HASH: NOT CHECKED (supply --hash <sha256> or --evidence <file> to check it)
SIGNATURE: VALID (ed25519)
STATEMENT: nirium-audit-v1:44605928a6f6dfeb7297e55957b16503c8b4ecf554625b96791e87d853e8e7fa
SIGNER: GDTWMTILHQRKVGPFALJLO2IJRUIDQKNK7WF472GCI2YFRHSCXZ5KTHUZ
CID: QmRCNTPUQB8smQHFnXvqSGF2eQZpn9eGKw6oaQi3rx9Scz
VERIFICATION PASSED
```

---

## Run It

Requires Node.js `>=22.12.0`.

```bash
cd examples/build-logistics-checkpoints
npm install
cp .env.example .env

# Run end-to-end multi-party demo
npm run demo

# Verify an existing shipment
npm run check-chain -- SHP-LIVE-8020

# Run offline unit test suite (no network required)
npm test
```
