import { randomUUID } from 'node:crypto';
import { Keypair } from '@stellar/stellar-sdk';
import { Agent as NiriumAgent, type AgentAttestationInput, type AuditAnchor } from 'nirium';
import type { AgentRunner } from './agent.js';
import { hashEntry, statementFor, type LogbookEntry } from './entry.js';
import type { LocalStore, Receipt } from './store.js';

export interface Anchorer {
  anchor(sha256: string, agent: AgentAttestationInput, tag: string): Promise<AuditAnchor>;
}

/** Anchors through the published SDK: only `hash`, `tag` and the signed attestation are sent. */
export function niriumAnchorer(baseUrl: string, apiKey = ''): Anchorer {
  const client = new NiriumAgent({ apiKey, baseUrl });
  return {
    anchor: (hash, agent, tag) => client.anchorAuditRecord({ hash, tag, agent }),
  };
}

export function attest(sha256: string, keypair: Keypair, id = 'agent-logbook'): AgentAttestationInput {
  return {
    key: keypair.publicKey(),
    signature: keypair.sign(Buffer.from(statementFor(sha256), 'utf8')).toString('base64'),
    id,
  };
}

export interface RunOptions {
  agent: AgentRunner;
  store: LocalStore;
  anchorer: Anchorer;
  keypair: Keypair;
  tag: string;
  now?: () => Date;
  newId?: () => string;
}

/** Run one task, store the full entry locally, anchor only its hash. */
export async function runTask(prompt: string, o: RunOptions): Promise<Receipt> {
  if (!o.tag.startsWith('wave11-')) throw new Error('tag must start with wave11-');
  const startedAt = (o.now ?? (() => new Date()))().toISOString();
  const taskId = (o.newId ?? (() => `task-${randomUUID().slice(0, 8)}`))();
  const { toolCalls, output } = await o.agent.run(prompt);
  const entry: LogbookEntry = { version: 'agent-logbook-v1', taskId, startedAt, prompt, toolCalls, output };
  o.store.saveEntry(entry);
  const sha256 = hashEntry(entry);
  const res = await o.anchorer.anchor(sha256, attest(sha256, o.keypair), o.tag);
  const anchored = String(res.contentSha256 ?? (res as Record<string, unknown>).content_sha256 ?? '').toLowerCase();
  if (anchored !== sha256) throw new Error(`node anchored ${anchored || 'nothing'}, expected ${sha256}`);
  if (res.attestedBy && res.attestedBy !== o.keypair.publicKey()) {
    throw new Error(`node attested ${res.attestedBy}, expected ${o.keypair.publicKey()}`);
  }
  const receipt: Receipt = {
    taskId, sha256, cid: res.cid, anchoredAt: res.anchoredAt, tag: o.tag,
    ...(res.attestedBy ? { attestedBy: res.attestedBy } : {}),
  };
  o.store.addReceipt(receipt);
  return receipt;
}
