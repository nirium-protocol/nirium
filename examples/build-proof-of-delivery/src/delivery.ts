import { Keypair } from '@stellar/stellar-sdk';
import { Agent as NiriumAgent, type AgentAttestationInput, type AuditAnchor } from 'nirium';
import { buildRecord, hashRecord, statementFor, type DeliveryDetails } from './record.js';
import type { DeliveryStore, Receipt } from './store.js';

export interface Anchorer {
  anchor(sha256: string, agent: AgentAttestationInput, tag: string): Promise<AuditAnchor>;
}

/** Anchors through the published SDK: only `hash`, `tag` and the signed attestation are sent. */
export function niriumAnchorer(baseUrl: string, apiKey = ''): Anchorer {
  const client = new NiriumAgent({ apiKey, baseUrl });
  return { anchor: (hash, agent, tag) => client.anchorAuditRecord({ hash, tag, agent }) };
}

/** The courier signs `nirium-audit-v1:<sha256>` with their own Stellar key. */
export function attest(sha256: string, keypair: Keypair, id = 'courier-app'): AgentAttestationInput {
  return {
    key: keypair.publicKey(),
    signature: keypair.sign(Buffer.from(statementFor(sha256), 'utf8')).toString('base64'),
    id,
  };
}

export interface DeliverOptions {
  store: DeliveryStore;
  anchorer: Anchorer;
  keypair: Keypair;
  tag: string;
}

/**
 * At the door: keep the photo and details privately, hash them together,
 * anchor only the hash, signed by the courier.
 */
export async function recordDelivery(details: DeliveryDetails, photo: Buffer, o: DeliverOptions): Promise<Receipt> {
  if (!o.tag.startsWith('wave11-')) throw new Error('tag must start with wave11-');
  const record = buildRecord(details, photo);
  const kept: DeliveryDetails = { orderId: record.orderId, deliveredAt: record.deliveredAt, lat: record.lat, lon: record.lon };
  o.store.saveDelivery(kept, photo);
  const sha256 = hashRecord(record);
  const res = await o.anchorer.anchor(sha256, attest(sha256, o.keypair), o.tag);
  const anchored = String(res.contentSha256 ?? (res as Record<string, unknown>).content_sha256 ?? '').toLowerCase();
  if (anchored !== sha256) throw new Error(`node anchored ${anchored || 'nothing'}, expected ${sha256}`);
  if (res.attestedBy && res.attestedBy !== o.keypair.publicKey()) {
    throw new Error(`node attested ${res.attestedBy}, expected ${o.keypair.publicKey()}`);
  }
  const receipt: Receipt = {
    orderId: record.orderId, sha256, cid: res.cid, anchoredAt: res.anchoredAt, tag: o.tag,
    ...(res.attestedBy ? { attestedBy: res.attestedBy } : {}),
  };
  o.store.addReceipt(receipt);
  return receipt;
}
