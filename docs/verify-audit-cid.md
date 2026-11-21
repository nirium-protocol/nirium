# Verify an Audit Trail CID by Hand

This guide shows how to independently verify a Nirium Audit Trail record from its IPFS CID without calling the Nirium API. You will fetch the document from IPFS, recompute the SHA-256 hash of the original payload, and verify the optional ed25519 signature against the agent's public key.

## What You're Verifying

Every Nirium audit anchor contains:
- `record`: The original JSON payload (or omitted for hash-only anchors)
- `content_sha256`: SHA-256 hash of `JSON.stringify(record)` (or the pre-hashed evidence for hash-only anchors)
- `agent` (optional): Ed25519 signature over `nirium-audit-v1:<content_sha256>`, signed by the agent's Stellar keypair

The verification model reconstructs the signed statement from the **recomputed** record hash. It does not trust embedded `agent.statement` fields, which prevents statement-substitution attacks where a valid old signature is reused after the audit record is changed.

## Prerequisites

- Node.js >=22.12.0
- `@stellar/stellar-sdk` v16.x for Stellar Ed25519 public key decoding
- `curl` for the command-line example

## 1. Fetch the Audit Document from IPFS

Using `curl` with an IPFS gateway. Nirium's dedicated Filebase gateway is the most reliable; shared public gateways such as `ipfs.io` often answer `429` under load:

```bash
CID="QmSSZdtt3dQ8BqUm62zrKQ85E4BUHYiVfvDgZmHfJsqU1U"
curl -s "https://nirium.myfilebase.com/ipfs/${CID}" | jq
```

**Expected output:**

```json
{
  "version": "1.1.0",
  "node": "audit-external",
  "content_sha256": "ab44f8883af819f7496f2cef29eaea0651f6d97af78aa8088fd8ef4dc4b753c9",
  "agent": {
    "id": "arcusx-dispute-resolver",
    "key": "GD5AFNPTKVZPNWZWKLOULOE7BN4E7ZC73WV5YMBCULYQXWFCGDESUNOZ",
    "alg": "ed25519",
    "statement": "nirium-audit-v1:ab44f8883af819f7496f2cef29eaea0651f6d97af78aa8088fd8ef4dc4b753c9",
    "signature": "kQu3tK3ZsDR0HMo1EFB13qa/bLiJa4AuX1yJSZq9/2MEgGVGJImFrtXH2SItfBWHW3bWTbB8qFeBUf/QkSkGAw=="
  },
  "record": {
    "schema": "arcusx.dispute.resolution.v1",
    "dispute": "dispute-118",
    "outcome": "released_to_worker",
    "case_file_sha256": "1794c699bce4e06d33857cc34f2974ac2bfff500bdc41b002b219a154b698ac0",
    "note": "Hashes only — no personal data anchored."
  },
  "network": "mainnet",
  "tag": "arcusx-dispute",
  "anchoredAt": "2026-07-30T22:26:02.857Z"
}
```

## 2. Recompute the Record Hash

Compute `SHA-256(JSON.stringify(record))`:

```bash
printf '%s' '{"schema":"arcusx.dispute.resolution.v1","dispute":"dispute-118","outcome":"released_to_worker","case_file_sha256":"1794c699bce4e06d33857cc34f2974ac2bfff500bdc41b002b219a154b698ac0","note":"Hashes only — no personal data anchored."}' | shasum -a 256
```

**Output:**

```
ab44f8883af819f7496f2cef29eaea0651f6d97af78aa8088fd8ef4dc4b753c9  -
```

Compare this value to the `content_sha256` field from the audit document. If they match, the record has not been tampered with since anchoring.

**⚠️ Important:** the hash is over the exact bytes, so three things must match:

- **Key order:** keep the keys in the order they appear in the stored `record`. Do not sort them: sorting changes the hash.
- **No whitespace:** compact JSON, as `JSON.stringify(record)` produces.
- **UTF-8, not escapes:** this record's `note` contains an em dash (`—`). Written as `\u2014`, the hash changes.

In JavaScript, `JSON.stringify(doc.record)` on the parsed document gives the right 234 bytes.

## 3. Verify the Agent Signature (Optional)

If the audit document includes an `agent` block with a signature, verify that the agent signed the reconstructed statement.

The agent signs over:

```
nirium-audit-v1:<computed_content_sha256>
```

Using the **recomputed** hash, not the embedded `agent.statement` value (which could be substituted).

### Node.js Script

Create `verify-audit.ts`:

```ts
import crypto from 'node:crypto';
import { StrKey } from '@stellar/stellar-sdk';

// Values from the document above - replace with your own audit document
const agentKey = 'GD5AFNPTKVZPNWZWKLOULOE7BN4E7ZC73WV5YMBCULYQXWFCGDESUNOZ';
const signature = 'kQu3tK3ZsDR0HMo1EFB13qa/bLiJa4AuX1yJSZq9/2MEgGVGJImFrtXH2SItfBWHW3bWTbB8qFeBUf/QkSkGAw=='; // base64
const computedHash = 'ab44f8883af819f7496f2cef29eaea0651f6d97af78aa8088fd8ef4dc4b753c9'; // from step 2

function decodeStellarPublicKey(gAddress: string): Buffer {
  if (!/^G[A-Z2-7]{55}$/.test(gAddress)) {
    throw new Error(`Invalid Stellar public key format: ${gAddress}`);
  }
  const rawBytes = StrKey.decodeEd25519PublicKey(gAddress);
  return Buffer.from(rawBytes);
}

function verifyEd25519Signature(
  pubKeyGAddress: string,
  statement: string,
  base64Signature: string
): boolean {
  try {
    const rawPubKey = decodeStellarPublicKey(pubKeyGAddress);
    const spkiHeader = Buffer.from('302a300506032b6570032100', 'hex');
    const keyObject = crypto.createPublicKey({
      key: Buffer.concat([spkiHeader, rawPubKey]),
      format: 'der',
      type: 'spki',
    });

    const signatureBuf = Buffer.from(base64Signature, 'base64');
    return crypto.verify(null, Buffer.from(statement), keyObject, signatureBuf);
  } catch (err) {
    console.error('Verification error:', err);
    return false;
  }
}

const statement = `nirium-audit-v1:${computedHash}`;
const isValid = verifyEd25519Signature(agentKey, statement, signature);

console.log(`Statement: ${statement}`);
console.log(`Signature valid: ${isValid}`);
```

Install dependencies and run:

```bash
npm install --save-dev @stellar/stellar-sdk@16 tsx typescript
npx tsx verify-audit.ts
```

**Expected output:**

```
Statement: nirium-audit-v1:ab44f8883af819f7496f2cef29eaea0651f6d97af78aa8088fd8ef4dc4b753c9
Signature valid: true
```

### Using the Nirium CLI

The CLI provides a single command for full verification:

```bash
npm install -g nirium-cli
nirium verify QmSSZdtt3dQ8BqUm62zrKQ85E4BUHYiVfvDgZmHfJsqU1U --json
```

**Output** (`nirium-cli` 3.2.4, `attempts` trimmed):

```json
{
  "ok": true,
  "verified": true,
  "cid": "QmSSZdtt3dQ8BqUm62zrKQ85E4BUHYiVfvDgZmHfJsqU1U",
  "mode": "record",
  "hashMatch": true,
  "hashStatus": "match",
  "expectedHash": "ab44f8883af819f7496f2cef29eaea0651f6d97af78aa8088fd8ef4dc4b753c9",
  "computedHash": "ab44f8883af819f7496f2cef29eaea0651f6d97af78aa8088fd8ef4dc4b753c9",
  "signatureStatus": "valid",
  "signatureScheme": "ed25519",
  "signerKey": "GD5AFNPTKVZPNWZWKLOULOE7BN4E7ZC73WV5YMBCULYQXWFCGDESUNOZ",
  "statement": "nirium-audit-v1:ab44f8883af819f7496f2cef29eaea0651f6d97af78aa8088fd8ef4dc4b753c9",
  "declaredStatement": "nirium-audit-v1:ab44f8883af819f7496f2cef29eaea0651f6d97af78aa8088fd8ef4dc4b753c9",
  "agentId": "arcusx-dispute-resolver",
  "gateway": "https://nirium.myfilebase.com"
}
```

For hash-only anchors (where `record` is omitted and only `content_sha256` is stored), pass `--hash` to verify against your original evidence:

```bash
nirium verify QmHashOnlyCID --hash f3889ed882a1ef2205d42c33d5940268263b100ee51b474cfb28c19a433a2565 --json
```

Or pass `--evidence <file>` to compute the hash from a local file:

```bash
nirium verify QmHashOnlyCID --evidence ./original-evidence.json --json
```

An unsigned record still passes on its recomputed hash, with `signatureStatus: "absent"`. If you only trust receipts your agents signed, add `--require-signature` (nirium-cli 3.2.6 or newer, same rule as the Action's `require-signature` input): an unsigned document then fails.

```bash
nirium verify <CID> --require-signature --json
```

## A Hash-Only Example

```bash
nirium verify QmZDVSxEfi3TLmcK1wLNydUHgGebfnTQ8i2EaEYfg2RUD6 --json
```

A mainnet (`stellar:pubnet`) anchor signed with a demo key (`throwaway-demo-key`). It stores only `content_sha256`, so without the original evidence the CLI reports `signatureStatus: "valid"` and `hashStatus: "unchecked"`: the signature checks out, but the content can't be checked until someone presents the bytes with `--hash` or `--evidence`. That is how private evidence works: the receipt is public, the file is not.

## If IPFS Loses a Receipt

A CID is the hash of the document, so the document can come back from any copy.
Keep the receipt when you anchor it (`nirium anchor ... --save receipt.json`; the
API's `POST /api/audit/log` response also includes the exact `document`), then:

```bash
nirium cid receipt.json --expect <CID>   # recomputes the CID locally
ipfs add --cid-version=0 receipt.json    # puts it back on IPFS, same CID
```

Save the bytes as they are. `JSON.stringify(document)` with no trailing newline
is exactly what was pinned; any reformatting changes the CID.

## What This Proves

- **Hash match**: The record has not been altered since anchoring.
- **Valid signature** (if present): The agent with the specified Stellar public key declared this specific content hash at anchor time.
- **Content addressing**: The CID is derived from the document's bytes, so a changed document gets a different CID. The change shows; it is not prevented (tamper-evident, not tamper-proof).

## What This Does NOT Prove

- **When** the anchor was created (the `anchoredAt` timestamp is self-asserted, not verified by this process).
- **Legal proof** of the event: this is an integrity seal, not notarization.
- **Who controls the agent key**: the signature proves the key signed the statement, not that a specific entity controls that key.

## Next Steps

- Automate verification in CI with the [verify-audit-cid GitHub Action](../actions/verify-audit-cid)
- See [`actions/verify-audit-cid/src/verify.ts`](../actions/verify-audit-cid/src/verify.ts) for the reference implementation
- Use `anchorAuditRecord()` in the SDK to create your own audit anchors: [`packages/sdk/README.md`](../packages/sdk/README.md)

## Troubleshooting

| Problem | Fix |
| --- | --- |
| IPFS gateway timeout or `429` | Try another gateway. With no `--gateway`, `nirium verify` already tries Filebase, Pinata, ipfs.io and dweb.link in that order; to pick one: `--gateway https://nirium.myfilebase.com` or `--gateway https://gateway.pinata.cloud` |
| Hash mismatch | Hash `JSON.stringify(record)` with the keys in their stored order (not sorted), no extra whitespace, and non-ASCII characters as UTF-8 rather than `\u` escapes |
| Invalid signature | Verify the agent's public key (`G...` Stellar address) and that you are reconstructing the statement from the **recomputed** hash, not `agent.statement` |
| CID not found | The CID may not have propagated to all gateways yet; wait a few minutes or try the node's own IPFS gateway |

---

*This guide was written as part of Niriumtober 2026. Issue: [nirium-protocol/nirium#173](https://github.com/nirium-protocol/nirium/issues/173)*
