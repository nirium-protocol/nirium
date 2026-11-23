import { Keypair } from '@stellar/stellar-sdk';
import { Agent as NiriumAgent, type AgentAttestationInput, type AuditAnchor } from 'nirium';
import { attest, buildRecord, hashRecord, type HandoffDetails } from './record.js';
import type { CheckpointReceipt, CheckpointStore } from './store.js';

export interface Anchorer {
  anchor(sha256: string, agent: AgentAttestationInput, tag: string): Promise<AuditAnchor>;
}

/**
 * Anchors through Nirium's Audit Trail API: only `hash`, `tag` and `agent` (Stellar signature) are sent.
 */
export function niriumAnchorer(baseUrl: string, apiKey = ''): Anchorer {
  const client = new NiriumAgent({ apiKey, baseUrl });
  return {
    anchor: (hash, agent, tag) => client.anchorAuditRecord({ hash, tag, agent }),
  };
}

export interface RecordHandoffOptions {
  store: CheckpointStore;
  anchorer: Anchorer;
  keypair: Keypair;
  tag: string;
}

/**
 * Records a logistics handoff at a checkpoint:
 * - Builds canonical handoff record containing location, time, scan, and previous CID.
 * - Signs attestation statement with the receiving party's Stellar key.
 * - Anchors only the SHA-256 hash + signature to Nirium Audit Trail.
 * - Saves receipt in local store.
 */
export async function recordHandoff(
  details: HandoffDetails,
  options: RecordHandoffOptions,
): Promise<CheckpointReceipt> {
  if (!options.tag.startsWith('wave11-')) {
    throw new Error(`tag must start with 'wave11-', got '${options.tag}'`);
  }

  const partyPublicKey = options.keypair.publicKey();
  const record = buildRecord(details, partyPublicKey);
  const sha256 = hashRecord(record);
  const agent = attest(sha256, options.keypair, details.partyId);

  const res = await options.anchorer.anchor(sha256, agent, options.tag);

  const anchoredHash = String(
    res.contentSha256 ?? (res as Record<string, unknown>).content_sha256 ?? '',
  ).toLowerCase();

  if (anchoredHash !== sha256) {
    throw new Error(`node anchored '${anchoredHash || 'nothing'}', expected '${sha256}'`);
  }

  if (res.attestedBy && res.attestedBy !== partyPublicKey) {
    throw new Error(`node attested signer '${res.attestedBy}', expected '${partyPublicKey}'`);
  }

  const receipt: CheckpointReceipt = {
    shipmentId: record.shipmentId,
    handoffIndex: record.handoffIndex,
    partyId: record.partyId,
    locationLabel: record.locationLabel,
    timestamp: record.timestamp,
    scanHash: record.scanHash,
    previousHandoffCid: record.previousHandoffCid,
    sha256,
    cid: res.cid,
    anchoredAt: res.anchoredAt,
    attestedBy: res.attestedBy ?? partyPublicKey,
    tag: options.tag,
    record,
  };

  options.store.saveReceipt(receipt);
  return receipt;
}
