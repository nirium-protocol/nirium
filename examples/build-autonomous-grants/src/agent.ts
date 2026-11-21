import { Account, Asset, BASE_FEE, Memo, Operation, StrKey, TransactionBuilder } from '@stellar/stellar-sdk';
import type { Ledger } from './ledger.js';
import { PASSPHRASE } from './ledger.js';
import { checkMilestone, milestoneId, type Milestone, type MilestoneResult } from './milestone.js';

export interface Proposal {
  id: string;
  milestone: Milestone;
  evidence: MilestoneResult['evidence'];
  details: { dao: string; to: string; amountXlm: string; memo: string };
  networkPassphrase: string;
  /** Unsigned transaction envelope (base64 XDR). */
  xdr: string;
  /** Transaction hash: what each DAO signer signs. */
  hash: string;
  createdAt: string;
  /** Filled in later by the DAO signers, never by the agent. */
  signatures: { signer: string; signature: string }[];
}

export interface AgentConfig {
  /** The DAO's PUBLIC address. The agent is never given a signing key. */
  dao: string;
  grantee: string;
  amountXlm: string;
  milestone: Milestone;
}

/** The agent's constructor refuses anything that is not a public key, so a secret cannot be handed to it. */
export function assertPublicKey(label: string, value: string): void {
  if (!StrKey.isValidEd25519PublicKey(value)) {
    throw new Error(`${label} must be a Stellar public key (G...); the agent never holds a secret key`);
  }
}

/**
 * Verify the milestone; only if it is met, build an UNSIGNED payment from the DAO
 * account and return it as a proposal. If it is not met, nothing is built and
 * nothing is returned. The agent never signs and never submits.
 */
export async function proposeIfMet(
  cfg: AgentConfig,
  deps: { ledger: Ledger; fetchImpl?: typeof fetch; now?: () => Date },
): Promise<{ proposal: Proposal | null; evidence: MilestoneResult['evidence'] }> {
  assertPublicKey('dao', cfg.dao);
  assertPublicKey('grantee', cfg.grantee);
  if (!/^\d+(\.\d{1,7})?$/.test(cfg.amountXlm) || Number(cfg.amountXlm) <= 0) throw new Error('amountXlm must be a positive decimal');

  const result = await checkMilestone(cfg.milestone, deps.fetchImpl);
  if (!result.met) return { proposal: null, evidence: result.evidence };

  const dao = await deps.ledger.loadDao(cfg.dao);
  const now = (deps.now ?? (() => new Date()))();
  const memo = `nirium-grant:${cfg.milestone.pr}`; // <= 28 bytes
  const tx = new TransactionBuilder(new Account(cfg.dao, dao.sequence), { fee: BASE_FEE, networkPassphrase: PASSPHRASE })
    .addOperation(Operation.payment({ destination: cfg.grantee, asset: Asset.native(), amount: cfg.amountXlm }))
    .addMemo(Memo.text(memo))
    // Signers have a day to review; an old proposal cannot be replayed later.
    .setTimebounds(0, Math.floor(now.getTime() / 1000) + 24 * 3600)
    .build();
  const hash = tx.hash().toString('hex');
  return {
    evidence: result.evidence,
    proposal: {
      id: hash.slice(0, 8),
      milestone: cfg.milestone,
      evidence: result.evidence,
      details: { dao: cfg.dao, to: cfg.grantee, amountXlm: cfg.amountXlm, memo },
      networkPassphrase: PASSPHRASE,
      xdr: tx.toXDR(),
      hash,
      createdAt: now.toISOString(),
      signatures: [],
    },
  };
}

export { milestoneId };
