import { Keypair } from '@stellar/stellar-sdk';
import { Agent as NiriumAgent, type AgentAttestationInput, type AuditAnchor } from 'nirium';
import { sha256Hex, statementFor } from './canonical.js';
import { verifyReading, type SignedReading } from './sensor.js';
import type { LocalStore, Receipt } from './store.js';

export interface Anchorer {
  anchor(sha256: string, agent: AgentAttestationInput, tag: string): Promise<AuditAnchor>;
}

/** Anchors through the published SDK: only `hash`, `tag` and the signed attestation are sent. */
export function niriumAnchorer(baseUrl: string, apiKey = ''): Anchorer {
  const client = new NiriumAgent({ apiKey, baseUrl });
  return { anchor: (hash, agent, tag) => client.anchorAuditRecord({ hash, tag, agent }) };
}

export function attest(sha256: string, keypair: Keypair, id = 'iot-gateway'): AgentAttestationInput {
  return {
    key: keypair.publicKey(),
    signature: keypair.sign(Buffer.from(statementFor(sha256), 'utf8')).toString('base64'),
    id,
  };
}

export interface BatchFile {
  version: 'iot-batch-v1';
  batchId: string;
  windowStart: string;
  windowEnd: string;
  /** The gateway's Stellar public key (the signer of the receipt). */
  gateway: string;
  /** Sensors that contributed at least one reading, with their ed25519 public keys. */
  sensors: { id: string; publicKey: string }[];
  readings: SignedReading[];
}

export class Gateway {
  private pending: SignedReading[] = [];
  private seen = new Set<string>();

  constructor(
    private readonly store: LocalStore,
    private readonly anchorer: Anchorer,
    private readonly keypair: Keypair,
    private readonly tag: string,
  ) {
    if (!tag.startsWith('wave11-')) throw new Error('tag must start with wave11-');
  }

  /** Accept a reading only if the (already pinned) sensor key verifies its signature. */
  ingest(r: SignedReading): void {
    const key = this.store.registry()[r.sensorId];
    if (!key) throw new Error(`unknown sensor ${r.sensorId}`);
    if (!verifyReading(r, key)) throw new Error(`bad signature on ${r.sensorId}#${r.seq}`);
    const id = `${r.sensorId}#${r.seq}`;
    if (this.seen.has(id)) throw new Error(`duplicate reading ${id}`);
    this.seen.add(id);
    this.pending.push(r);
  }

  get pendingCount(): number {
    return this.pending.length;
  }

  /** Close the current window: store the batch file locally, anchor only its hash. */
  async flush(windowStart: Date, windowEnd: Date): Promise<Receipt | null> {
    if (this.pending.length === 0) return null;
    const registry = this.store.registry();
    const readings = [...this.pending].sort((a, b) => a.sensorId.localeCompare(b.sensorId) || a.seq - b.seq);
    const ids = [...new Set(readings.map((r) => r.sensorId))].sort();
    const batchId = this.store.nextBatchId();
    const batch: BatchFile = {
      version: 'iot-batch-v1',
      batchId,
      windowStart: windowStart.toISOString(),
      windowEnd: windowEnd.toISOString(),
      gateway: this.keypair.publicKey(),
      sensors: ids.map((id) => ({ id, publicKey: registry[id]! })),
      readings,
    };
    const bytes = this.store.saveBatch(batchId, batch);
    const sha256 = sha256Hex(bytes);
    const res = await this.anchorer.anchor(sha256, attest(sha256, this.keypair), this.tag);
    const anchored = String(res.contentSha256 ?? (res as Record<string, unknown>).content_sha256 ?? '').toLowerCase();
    if (anchored !== sha256) throw new Error(`node anchored ${anchored || 'nothing'}, expected ${sha256}`);
    if (res.attestedBy && res.attestedBy !== this.keypair.publicKey()) {
      throw new Error(`node attested ${res.attestedBy}, expected ${this.keypair.publicKey()}`);
    }
    const receipt: Receipt = {
      batchId, sha256, cid: res.cid, anchoredAt: res.anchoredAt, tag: this.tag,
      ...(res.attestedBy ? { attestedBy: res.attestedBy } : {}),
      sensors: ids,
      readings: readings.length,
    };
    this.store.addReceipt(receipt);
    this.pending = [];
    return receipt;
  }
}
