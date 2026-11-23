import { Keypair, TransactionBuilder, Transaction } from '@stellar/stellar-sdk';
import type { Proposal } from './agent.js';
import type { DaoState, Ledger } from './ledger.js';
import { assertMatchesProposal } from './signer.js';

export interface Tally {
  /** Distinct, valid signatures from current DAO signers, summed by weight. */
  weight: number;
  valid: string[];
  rejected: { signer: string; reason: string }[];
  threshold: number;
}

/**
 * Count only signatures that (a) verify against the transaction hash and
 * (b) come from a signer of the DAO account on the ledger. A signer counts once.
 */
export function tally(p: Proposal, dao: DaoState): Tally {
  const tx = assertMatchesProposal(p);
  const hash = tx.hash();
  const valid: string[] = [];
  const rejected: Tally['rejected'] = [];
  let weight = 0;
  for (const s of p.signatures) {
    const known = dao.signers.find((x) => x.key === s.signer);
    if (!known) { rejected.push({ signer: s.signer, reason: 'not a DAO signer' }); continue; }
    if (valid.includes(s.signer)) { rejected.push({ signer: s.signer, reason: 'duplicate' }); continue; }
    let ok = false;
    try { ok = Keypair.fromPublicKey(s.signer).verify(hash, Buffer.from(s.signature, 'base64')); } catch { ok = false; }
    if (!ok) { rejected.push({ signer: s.signer, reason: 'signature does not verify' }); continue; }
    valid.push(s.signer);
    weight += known.weight;
  }
  return { weight, valid, rejected, threshold: dao.medThreshold };
}

/** Attach the valid signatures to the transaction. */
export function signedTransaction(p: Proposal, valid: string[]): Transaction {
  const tx = TransactionBuilder.fromXDR(p.xdr, p.networkPassphrase) as Transaction;
  for (const s of p.signatures) if (valid.includes(s.signer)) tx.addSignature(s.signer, s.signature);
  return tx;
}

/**
 * Submit only when the valid signature weight reaches the account's payment
 * threshold. With one of three signers it refuses and the ledger is never called.
 */
export async function submitProposal(p: Proposal, ledger: Ledger): Promise<{ hash: string; ledger: number; tally: Tally }> {
  const dao = await ledger.loadDao(p.details.dao);
  const t = tally(p, dao);
  if (t.weight < t.threshold) {
    throw new Error(`not enough signatures: weight ${t.weight} of ${t.threshold} required (valid signers: ${t.valid.length})`);
  }
  const res = await ledger.submit(signedTransaction(p, t.valid));
  return { ...res, tally: t };
}
