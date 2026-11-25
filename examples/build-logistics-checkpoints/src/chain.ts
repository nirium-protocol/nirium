import { spawnSync } from 'node:child_process';
import { createRequire } from 'node:module';
import { dirname, join } from 'node:path';
import { hashRecord } from './record.js';
import type { CheckpointReceipt, CheckpointStore } from './store.js';

export interface VerifyResult {
  ok: boolean;
  output: string;
}

export type Verifier = (cid: string, sha256: string) => Promise<VerifyResult> | VerifyResult;

/**
 * Runs the standard `nirium-cli verify <cid> --hash <sha256>` CLI verifier.
 */
export const niriumCliVerify: Verifier = (cid, sha256) => {
  const require = createRequire(import.meta.url);
  const bin = join(dirname(require.resolve('nirium-cli/package.json')), 'bin', 'nirium.js');
  const r = spawnSync(
    process.execPath,
    [bin, 'verify', cid, '--hash', sha256, '--retries', '3'],
    { encoding: 'utf8' },
  );
  return {
    ok: r.status === 0,
    output: `${r.stdout ?? ''}${r.stderr ?? ''}`.trim(),
  };
};

export interface HandoffVerificationStatus {
  index: number;
  partyId: string;
  cid: string;
  sha256: string;
  attestedBy: string;
  verified: boolean;
  error?: string;
  cliOutput?: string;
}

export interface ChainVerificationResult {
  shipmentId: string;
  valid: boolean;
  totalHandoffs: number;
  errors: string[];
  handoffs: HandoffVerificationStatus[];
}

/**
 * Full provenance and cryptographic chain verification for a shipment.
 *
 * Verifies:
 * 1. At least 3 handoffs in the shipment chain.
 * 2. Sequential ordering: strictly consecutive index 0, 1, 2, ... (flags missing/out-of-order).
 * 3. Provenance linkage: previousHandoffCid matches the prior handoff's CID.
 * 4. Temporal progression: non-decreasing timestamps.
 * 5. Key uniqueness / non-repudiation: distinct key per party; no party signs for another.
 * 6. Audit Trail integrity: each receipt CID matches the recomputed record hash via nirium-cli verify.
 */
export async function verifyShipmentChain(
  shipmentId: string,
  store: CheckpointStore,
  verifier: Verifier = niriumCliVerify,
): Promise<ChainVerificationResult> {
  const receipts = store.loadShipmentReceipts(shipmentId);
  const errors: string[] = [];
  const handoffs: HandoffVerificationStatus[] = [];

  if (receipts.length === 0) {
    return {
      shipmentId,
      valid: false,
      totalHandoffs: 0,
      errors: [`No handoff receipts found for shipment '${shipmentId}'.`],
      handoffs: [],
    };
  }

  if (receipts.length < 3) {
    errors.push(
      `Chain incomplete: shipment has ${receipts.length} handoff(s); requires at least 3 handoffs for valid multi-party transit.`,
    );
  }

  const seenParties = new Set<string>();
  const seenKeys = new Set<string>();

  for (let i = 0; i < receipts.length; i++) {
    const current = receipts[i];
    const handoffErrors: string[] = [];

    // 1. Sequential index check
    if (current.handoffIndex !== i) {
      handoffErrors.push(
        `Out-of-order or missing handoff: expected index ${i}, found ${current.handoffIndex}.`,
      );
    }

    // 2. Previous CID linkage check
    if (i === 0) {
      if (current.previousHandoffCid !== null) {
        handoffErrors.push(
          `Origin handoff (index 0) must have previousHandoffCid null, got '${current.previousHandoffCid}'.`,
        );
      }
    } else {
      const prev = receipts[i - 1];
      if (current.previousHandoffCid !== prev.cid) {
        handoffErrors.push(
          `Broken chain at handoff ${i}: previousHandoffCid '${current.previousHandoffCid}' does not match prior handoff CID '${prev.cid}'.`,
        );
      }
    }

    // 3. Timestamp progression check
    if (i > 0) {
      const prevTime = new Date(receipts[i - 1].timestamp).getTime();
      const currTime = new Date(current.timestamp).getTime();
      if (currTime < prevTime) {
        handoffErrors.push(
          `Timestamp regression at handoff ${i}: ${current.timestamp} is earlier than previous ${receipts[i - 1].timestamp}.`,
        );
      }
    }

    // 4. Distinct party and key check (no party can sign for another)
    if (seenParties.has(current.partyId)) {
      handoffErrors.push(
        `Duplicate party '${current.partyId}' in chain: each handoff must be conducted by a distinct logistics party.`,
      );
    }
    seenParties.add(current.partyId);

    if (seenKeys.has(current.attestedBy)) {
      handoffErrors.push(
        `Duplicate signer key '${current.attestedBy}': each party must sign with their own distinct Stellar key.`,
      );
    }
    seenKeys.add(current.attestedBy);

    if (current.attestedBy !== current.record.partyPublicKey) {
      handoffErrors.push(
        `Signer mismatch: attestedBy key '${current.attestedBy}' does not match record partyPublicKey '${current.record.partyPublicKey}'.`,
      );
    }

    // 5. Recompute hash from stored record
    const recomputedHash = hashRecord(current.record);
    if (recomputedHash !== current.sha256) {
      handoffErrors.push(
        `Tampered record: recomputed hash '${recomputedHash}' differs from anchored hash '${current.sha256}'.`,
      );
    }

    // 6. Layer 1 verify with nirium-cli verify
    const verifyRes = await verifier(current.cid, recomputedHash);
    if (!verifyRes.ok) {
      handoffErrors.push(
        `Audit Trail verification failed for CID '${current.cid}': ${verifyRes.output || 'hash or signature mismatch'}`,
      );
    }

    if (handoffErrors.length > 0) {
      errors.push(...handoffErrors);
    }

    handoffs.push({
      index: current.handoffIndex,
      partyId: current.partyId,
      cid: current.cid,
      sha256: current.sha256,
      attestedBy: current.attestedBy,
      verified: handoffErrors.length === 0,
      error: handoffErrors.length > 0 ? handoffErrors.join('; ') : undefined,
      cliOutput: verifyRes.output,
    });
  }

  return {
    shipmentId,
    valid: errors.length === 0,
    totalHandoffs: receipts.length,
    errors,
    handoffs,
  };
}
