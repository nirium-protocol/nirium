# Vulnerability Disclosure Commitment

A tool for security researchers and auditors to commit to a vulnerability report before coordinated disclosure. It computes a cryptographic commitment over the report (salted with random entropy so short reports cannot be brute-forced or guessed), anchors the signed commitment hash on the Stellar testnet through Nirium's free Audit Trail node, and allows full public verification upon disclosure.

Only the salted SHA-256 commitment hash is anchored. The vulnerability report itself remains confidential on the researcher's local machine until coordinated disclosure.

---

## What a Receipt Proves (and What It Doesn't)

Honesty about cryptographic guarantees is a core requirement of the Nirium protocol:

- **What it proves:**
  - **Prior Existence:** The exact report text existed at or before `anchoredAt`.
  - **Immutability:** The report content has not been altered, backdated, or rewritten after anchoring.
  - **Attribution:** The commitment was authored and signed by the holder of the specific Stellar public key (`attestedBy`).
- **What it does NOT prove:**
  - **Truth of Content:** Anchoring a receipt does not prove that the reported vulnerability is valid, reproducible, or correctly assessed.
  - **Clock Authority:** The `anchoredAt` timestamp reflects the Nirium node's system clock, not a consensus ledger time or legally binding notary seal.

---

## Quickstart

### 1. Install Dependencies

Install this example independently:

```bash
cd examples/build-disclosure-commitment
npm install
```

### 2. Configure Researcher Key

Anchoring a new disclosure commitment requires a Stellar testnet secret key that you own. The key remains local and is never committed:

```bash
export RESEARCHER_SECRET_KEY="S..."
```

*(Optional environment variables)*:
- `NIRIUM_AUDIT_URL`: Audit Trail endpoint (default: `https://nirium-agent.fly.dev`)
- `NIRIUM_AUDIT_TAG`: Audit tag (default: `wave11-disclosure-commitment`; must start with `wave11-`)

---

## Usage

### Step 1: Commit to a Vulnerability Report (Pre-Disclosure)

```bash
npm run commit reports/sample-vulnerability-report.md
```

**What happens:**
1. Computes `reportSha256 = sha256(reportContent)`.
2. Generates a 256-bit cryptographic random salt to protect confidentiality against dictionary attacks.
3. Derives `commitmentSha256 = sha256(reportSha256 + ":" + salt)`.
4. Signs `nirium-audit-v1:<commitmentSha256>` with the researcher's Stellar key.
5. Anchors the hash via `anchorAuditRecord()` from the published `nirium` SDK.
6. Writes the receipt (CID, salt, commitment hash) to `commitments.json`.

**Sample Output:**
```text
Anchoring vulnerability disclosure commitment on Nirium Audit Trail...
- Report: reports/sample-vulnerability-report.md
- Signer: GCQRPVYI7XOIBRCMGJIUIGD5V3G3ZHB75DLL4DFD64QQPYV4CLCWFDGK
- Tag:    wave11-disclosure-commitment
- Node:   https://nirium-agent.fly.dev

✅ Commitment Anchored Successfully!

Commitment ID:   cmt-6hzivv5h
Report SHA-256:  38a96cc7c0eaf499c5e23df188c24a6987dd9e4a17fc08bdea64d3b7ef868548
Random Salt:     33acd220980be3678d78ff215632ca8a491034bf639b4be6c639420d4fe3b826
Commitment Hash: e89a07e91a6f466de568899677b8a9ac04ea0f9dc07f362589f90fd8541b7087
IPFS CID:        QmXBFNkCoWaYvDMiMWoi2kSqDaSjkDhi8ivyNy3GbwinFH
Anchored At:     2026-11-22T20:59:05.978Z
Attested By:     GCQRPVYI7XOIBRCMGJIUIGD5V3G3ZHB75DLL4DFD64QQPYV4CLCWFDGK
Verify Online:   https://nirium.xyz/verify?cid=QmXBFNkCoWaYvDMiMWoi2kSqDaSjkDhi8ivyNy3GbwinFH&hash=e89a07e91a6f466de568899677b8a9ac04ea0f9dc07f362589f90fd8541b7087
```

---

### Step 2: Reveal & Verify upon Coordinated Disclosure

When coordinating with the protocol team or publishing the finding, reveal the report and verify it against the earlier anchor:

```bash
npm run reveal cmt-6hzivv5h reports/sample-vulnerability-report.md
```

**Verification Output:**
```text
Revealing and verifying commitment for "cmt-6hzivv5h"...
- Target CID:     QmXBFNkCoWaYvDMiMWoi2kSqDaSjkDhi8ivyNy3GbwinFH
- Anchored Hash:  e89a07e91a6f466de568899677b8a9ac04ea0f9dc07f362589f90fd8541b7087
- Checking File:  reports/sample-vulnerability-report.md

🎉 VERIFICATION PASSED: Genuine Pre-Disclosure Commitment Confirmed!
[VERIFIED] Report matches anchored commitment! Proves this exact report existed at 2026-11-22T20:59:05.978Z anchored by GCQRPVYI7XOIBRCMGJIUIGD5V3G3ZHB75DLL4DFD64QQPYV4CLCWFDGK.

nirium-cli output:
🔍 Nirium Audit Verifier
CID:            QmXBFNkCoWaYvDMiMWoi2kSqDaSjkDhi8ivyNy3GbwinFH
--------------------------------------------------
✔ HASH:        MATCH (e89a07e91a6f466d...) [hash-only]
✔ SIGNATURE:   VALID (Signed by GCQRPVYI7XOIBRCMGJIUIGD5V3G3ZHB75DLL4DFD64QQPYV4CLCWFDGK)
   Statement:  nirium-audit-v1:e89a07e91a6f466de568899677b8a9ac04ea0f9dc07f362589f90fd8541b7087
   Agent ID:   disclosure-commitment
--------------------------------------------------
✅ VERIFICATION PASSED
```

---

### Tamper Proof Verification

If any party attempts to modify the report (even by a single byte) and claims the earlier receipt:

```bash
# Attempting to reveal a modified report
npm run reveal cmt-6hzivv5h reports/tampered-report.md
```

**Refusal Output:**
```text
❌ VERIFICATION FAILED: Tampering or mismatch detected!
[TAMPERED] Report content has been modified after commitment! Recomputed hash (af9f43f2b0240532...) differs from anchored commitment (e89a07e91a6f466d...).
```

---

## Live Stellar Testnet Anchors

These are real `stellar:testnet` anchors published for this example:

| Commitment ID | Report | IPFS CID | Anchored Hash | Signer Public Key |
| :--- | :--- | :--- | :--- | :--- |
| `cmt-6hzivv5h` | `sample-vulnerability-report.md` | [`QmXBFNkCoWaYvDMiMWoi2kSqDaSjkDhi8ivyNy3GbwinFH`](https://nirium.xyz/verify?cid=QmXBFNkCoWaYvDMiMWoi2kSqDaSjkDhi8ivyNy3GbwinFH&hash=e89a07e91a6f466de568899677b8a9ac04ea0f9dc07f362589f90fd8541b7087) | `e89a07e91a6f466de568899677b8a9ac04ea0f9dc07f362589f90fd8541b7087` | `GCQRPVYI7XOIBRCMGJIUIGD5V3G3ZHB75DLL4DFD64QQPYV4CLCWFDGK` |

Verify independently at any time with `nirium-cli`:

```bash
npx nirium-cli verify QmXBFNkCoWaYvDMiMWoi2kSqDaSjkDhi8ivyNy3GbwinFH --hash e89a07e91a6f466de568899677b8a9ac04ea0f9dc07f362589f90fd8541b7087
```

---

## Testing

The automated test suite runs completely offline with zero network requests (external HTTP interactions are fully mocked):

```bash
npm test
npm run typecheck
```
