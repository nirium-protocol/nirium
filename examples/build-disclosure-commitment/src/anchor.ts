import { Keypair } from '@stellar/stellar-sdk';
import { Agent as NiriumAgent, type AgentAttestationInput, type AuditAnchor } from 'nirium';
import { computeCommitmentHash, generateSalt, hashReport, statementFor } from './crypto.js';
import type { LocalStore } from './store.js';
import type { CommitmentRecord } from './types.js';

export interface Anchorer {
  anchor(hash: string, agent: AgentAttestationInput, tag: string): Promise<AuditAnchor>;
}

/**
 * Anchors through the published Nirium SDK client.
 * Sends ONLY hash, tag, and agent signature; never raw vulnerability content.
 */
export function niriumAnchorer(baseUrl = 'https://nirium-agent.fly.dev', apiKey = ''): Anchorer {
  const client = new NiriumAgent({ apiKey, baseUrl });
  return {
    anchor: (hash, agent, tag) => client.anchorAuditRecord({ hash, tag, agent }),
  };
}

export function attest(sha256: string, keypair: Keypair, id = 'disclosure-commitment'): AgentAttestationInput {
  return {
    key: keypair.publicKey(),
    signature: keypair.sign(Buffer.from(statementFor(sha256), 'utf8')).toString('base64'),
    id,
  };
}

export interface CommitOptions {
  reportContent: string;
  reportName: string;
  keypair: Keypair;
  store: LocalStore;
  anchorer?: Anchorer;
  tag?: string;
  customSalt?: string;
  id?: string;
}

/**
 * Commits to a vulnerability report before disclosure:
 * 1. Hashes the report content.
 * 2. Generates a random 32-byte salt to prevent dictionary search.
 * 3. Computes commitmentHash = sha256(reportSha256 + ":" + salt).
 * 4. Signs statement nirium-audit-v1:<commitmentHash> with researcher key.
 * 5. Anchors the hash with wave11- tag.
 * 6. Stores commitment receipt locally for later reveal.
 */
export async function commitReport(options: CommitOptions): Promise<CommitmentRecord> {
  const {
    reportContent,
    reportName,
    keypair,
    store,
    anchorer = niriumAnchorer(),
    tag = 'wave11-disclosure-commitment',
    customSalt,
    id = `cmt-${Math.random().toString(36).substring(2, 10)}`,
  } = options;

  if (!tag.startsWith('wave11-')) {
    throw new Error('Anchor tag must start with "wave11-" as required by Nirium Wave 11 standard');
  }

  const reportSha256 = hashReport(reportContent);
  const salt = customSalt ?? generateSalt(32);
  const commitmentSha256 = computeCommitmentHash(reportSha256, salt);

  const attestation = attest(commitmentSha256, keypair);
  const anchorResult = await anchorer.anchor(commitmentSha256, attestation, tag);

  const returnedHash = String(
    anchorResult.contentSha256 ?? (anchorResult as Record<string, unknown>).content_sha256 ?? '',
  ).toLowerCase();

  if (returnedHash && returnedHash !== commitmentSha256.toLowerCase()) {
    throw new Error(`Node anchored ${returnedHash}, but expected ${commitmentSha256}`);
  }

  const record: CommitmentRecord = {
    id,
    reportName,
    reportSha256,
    salt,
    commitmentSha256,
    cid: anchorResult.cid,
    anchoredAt: anchorResult.anchoredAt,
    tag,
    attestedBy: keypair.publicKey(),
  };

  store.save(record);
  return record;
}
