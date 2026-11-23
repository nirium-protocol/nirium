import { Asset, Keypair, Operation, Transaction, TransactionBuilder } from '@stellar/stellar-sdk';
import type { Proposal } from './agent.js';
import type { DaoState } from './ledger.js';

export interface Decoded {
  source: string;
  memo: string;
  operations: { type: string; destination?: string; amount?: string; asset?: string }[];
  signatures: number;
}

/** Decode the transaction from its XDR (not from the proposal's summary) so a signer sees what they actually sign. */
export function decode(xdr: string, passphrase: string): Decoded {
  const tx = new Transaction(xdr, passphrase);
  return {
    source: tx.source,
    memo: tx.memo.value ? String(tx.memo.value) : '',
    operations: tx.operations.map((op) => ({
      type: op.type,
      ...(op.type === 'payment'
        ? { destination: op.destination, amount: op.amount, asset: op.asset.isNative() ? 'XLM' : op.asset.getCode() }
        : {}),
    })),
    signatures: tx.signatures.length,
  };
}

/** The XDR must be exactly one XLM payment from the DAO, matching the proposal's own summary. */
export function assertMatchesProposal(p: Proposal): Transaction {
  const parsed = TransactionBuilder.fromXDR(p.xdr, p.networkPassphrase);
  if (!(parsed instanceof Transaction)) throw new Error('fee-bump envelopes are not accepted');
  const tx = parsed;
  if (tx.hash().toString('hex') !== p.hash) throw new Error('proposal hash does not match its XDR');
  if (tx.source !== p.details.dao) throw new Error('transaction source is not the DAO account');
  const [op, ...rest] = tx.operations;
  if (!op || rest.length > 0 || op.type !== 'payment') throw new Error('proposal must be exactly one payment');
  if (op.destination !== p.details.to || op.amount !== Number(p.details.amountXlm).toFixed(7) || !op.asset.equals(Asset.native())) {
    throw new Error('payment in the XDR differs from the proposal summary');
  }
  return tx;
}

/**
 * Sign a proposal with ONE signer's key. The secret is passed in by that signer
 * only; the agent never sees it. Refuses keys that are not signers of the DAO.
 */
export function signProposal(p: Proposal, secret: string, dao: DaoState): Proposal {
  const tx = assertMatchesProposal(p);
  const kp = Keypair.fromSecret(secret);
  const weight = dao.signers.find((s) => s.key === kp.publicKey())?.weight ?? 0;
  if (weight < 1) throw new Error(`${kp.publicKey()} is not a signer of the DAO account`);
  if (p.signatures.some((s) => s.signer === kp.publicKey())) throw new Error('this signer already signed');
  const signature = kp.sign(tx.hash()).toString('base64');
  return { ...p, signatures: [...p.signatures, { signer: kp.publicKey(), signature }] };
}

export { Operation };
