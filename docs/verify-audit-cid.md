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

Using `curl` with a public IPFS gateway:

```bash
CID="QmSSZdtt3dQ8BqUm62zrKQ85E4BUHYiVfvDgZmHfJsqU1U"
curl -s "https://ipfs.io/ipfs/${CID}" | jq
```

**Expected output** (example):

```json
{
  "version": "nirium-audit-v1",
  "node": "nirium-agent.fly.dev",
  "content_sha256": "3f15aaabd2177199e01e442b67a573d7eef74ad259121768e0195049a75d7f0e",
  "record": {
    "event": "treasury_rebalance_proposed",
    "timestamp": "2026-09-15T18:30:00Z",
    "vault": "CBTWMZCG3P72EHFAQ4ZLSEBIOFYJC244H5J6DHZIJ56FHFWJ2CFAWSZU"
  },
  "agent": {
    "id": "nirium-treasury-agent",
    "key": "GBMZGU4K3E7K5NWMR3YYF3NIFXAAKV5KXJD4Y6AFZZ6IMXVQP7F7PJWY",
    "alg": "ed25519",
    "statement": "nirium-audit-v1:3f15aaabd2177199e01e442b67a573d7eef74ad259121768e0195049a75d7f0e",
    "signature": "dGVzdHNpZ25hdHVyZWRhdGFoZXJl..."
  },
  "network": "stellar:testnet",
  "tag": "treasury",
  "anchoredAt": "2026-09-15T18:30:05.123Z"
}
```

## 2. Recompute the Record Hash

Compute `SHA-256(JSON.stringify(record))`:

```bash
echo -n '{"event":"treasury_rebalance_proposed","timestamp":"2026-09-15T18:30:00Z","vault":"CBTWMZCG3P72EHFAQ4ZLSEBIOFYJC244H5J6DHZIJ56FHFWJ2CFAWSZU"}' | shasum -a 256
```

**Output:**

```
3f15aaabd2177199e01e442b67a573d7eef74ad259121768e0195049a75d7f0e  -
```

Compare this value to the `content_sha256` field from the audit document. If they match, the record has not been tampered with since anchoring.

**⚠️ Important:** The exact `JSON.stringify()` output matters for hash verification. Whitespace, key ordering, and escaping must match exactly. The node serializes with no extra spaces and lexicographic key order.

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

// Example values - replace with your audit document
const agentKey = 'GBMZGU4K3E7K5NWMR3YYF3NIFXAAKV5KXJD4Y6AFZZ6IMXVQP7F7PJWY';
const signature = 'dGVzdHNpZ25hdHVyZWRhdGFoZXJl...'; // base64
const computedHash = '3f15aaabd2177199e01e442b67a573d7eef74ad259121768e0195049a75d7f0e';

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
Statement: nirium-audit-v1:3f15aaabd2177199e01e442b67a573d7eef74ad259121768e0195049a75d7f0e
Signature valid: true
```

### Using the Nirium CLI

The CLI provides a single command for full verification:

```bash
npm install -g nirium-cli
nirium verify QmSSZdtt3dQ8BqUm62zrKQ85E4BUHYiVfvDgZmHfJsqU1U --json
```

**Output:**

```json
{
  "ok": true,
  "verified": true,
  "cid": "QmSSZdtt3dQ8BqUm62zrKQ85E4BUHYiVfvDgZmHfJsqU1U",
  "mode": "record",
  "hashMatch": true,
  "hashStatus": "match",
  "expectedHash": "3f15aaabd2177199e01e442b67a573d7eef74ad259121768e0195049a75d7f0e",
  "computedHash": "3f15aaabd2177199e01e442b67a573d7eef74ad259121768e0195049a75d7f0e",
  "signatureStatus": "valid",
  "signatureScheme": "ed25519",
  "signerKey": "GBMZGU4K3E7K5NWMR3YYF3NIFXAAKV5KXJD4Y6AFZZ6IMXVQP7F7PJWY",
  "statement": "nirium-audit-v1:3f15aaabd2177199e01e442b67a573d7eef74ad259121768e0195049a75d7f0e"
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

## Real Testnet Example

Verify a real mainnet audit anchor from production:

```bash
nirium verify QmZDVSxEfi3TLmcK1wLNydUHgGebfnTQ8i2EaEYfg2RUD6 --json
```

This CID is from a real Nirium mainnet deployment and can be verified independently.

## What This Proves

- **Hash match**: The record has not been altered since anchoring.
- **Valid signature** (if present): The agent with the specified Stellar public key declared this specific content hash at anchor time.
- **IPFS immutability**: The CID cryptographically binds to the content; you cannot change the document without changing its CID.

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
| IPFS gateway timeout | Try another gateway: `--gateway https://gateway.pinata.cloud` or `https://ipfs.io/ipfs/` |
| Hash mismatch | Check that you are computing `SHA-256(JSON.stringify(record))` with exact key order and no extra whitespace |
| Invalid signature | Verify the agent's public key (`G...` Stellar address) and that you are reconstructing the statement from the **recomputed** hash, not `agent.statement` |
| CID not found | The CID may not have propagated to all gateways yet; wait a few minutes or try the node's own IPFS gateway |

---

*This guide was written as part of Niriumtober 2026. Issue: [nirium-protocol/nirium#173](https://github.com/nirium-protocol/nirium/issues/173)*
