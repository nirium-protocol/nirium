import { createHash } from 'node:crypto';
import { Keypair } from '@stellar/stellar-sdk';
import type { AgentAttestationInput } from 'nirium';

/**
 * Details collected during an in-person handoff between parties.
 * Held privately by the parties in off-chain checkpoint stores.
 */
export interface HandoffDetails {
  shipmentId: string;
  handoffIndex: number;
  partyId: string;
  locationLabel: string;
  timestamp: string; // ISO 8601
  scanHash: string; // SHA-256 of physical barcode/manifest scan
  previousHandoffCid: string | null; // CID of previous handoff receipt in chain (null for origin)
}

/**
 * Canonical record anchored to Nirium Audit Trail.
 * Includes the receiving party's public key and schema version.
 */
export interface HandoffRecord extends HandoffDetails {
  version: 'logistics-checkpoint-v1';
  partyPublicKey: string;
}

export function sha256Hex(data: Buffer | string): string {
  return createHash('sha256').update(data).digest('hex');
}

/**
 * Produces deterministic, sorted canonical JSON representation.
 */
export function canonicalJson(value: unknown): string {
  if (value === null || typeof value !== 'object') {
    return JSON.stringify(value);
  }
  if (Array.isArray(value)) {
    return `[${value.map(canonicalJson).join(',')}]`;
  }
  const obj = value as Record<string, unknown>;
  const keys = Object.keys(obj).filter((k) => obj[k] !== undefined).sort();
  return `{${keys.map((k) => `${JSON.stringify(k)}:${canonicalJson(obj[k])}`).join(',')}}`;
}

/**
 * Assembles a structured handoff record with version and receiving party's public key.
 */
export function buildRecord(details: HandoffDetails, partyPublicKey: string): HandoffRecord {
  return {
    version: 'logistics-checkpoint-v1',
    shipmentId: details.shipmentId,
    handoffIndex: details.handoffIndex,
    partyId: details.partyId,
    locationLabel: details.locationLabel,
    timestamp: details.timestamp,
    scanHash: details.scanHash,
    previousHandoffCid: details.previousHandoffCid,
    partyPublicKey,
  };
}

/**
 * The cryptographic anchor hash: SHA-256 of canonical JSON record.
 */
export function hashRecord(r: HandoffRecord): string {
  return sha256Hex(canonicalJson(r));
}

/**
 * Audit Trail attestation statement: `nirium-audit-v1:<sha256>`.
 */
export function statementFor(sha256: string): string {
  return `nirium-audit-v1:${sha256}`;
}

/**
 * Party taking the shipment signs the attestation statement with their own Stellar keypair.
 */
export function attest(sha256: string, keypair: Keypair, partyId = 'logistics-party'): AgentAttestationInput {
  return {
    key: keypair.publicKey(),
    signature: keypair.sign(Buffer.from(statementFor(sha256), 'utf8')).toString('base64'),
    id: partyId,
  };
}
