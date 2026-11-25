/**
 * Offline tests. GitHub is a stub `fetch`; the chain is a fake `Ledger`.
 * Nothing here touches the network: an unexpected call throws.
 */
import assert from 'node:assert/strict';
import test from 'node:test';
import { Keypair, Transaction, TransactionBuilder } from '@stellar/stellar-sdk';
import { proposeIfMet, type AgentConfig } from '../src/agent.js';
import { PASSPHRASE, type DaoState, type Ledger } from '../src/ledger.js';
import { checkMilestone } from '../src/milestone.js';
import { assertMatchesProposal, decode, signProposal } from '../src/signer.js';
import { submitProposal, tally } from '../src/submit.js';

const dao = Keypair.random();
const grantee = Keypair.random();
const signers = [Keypair.random(), Keypair.random(), Keypair.random()];
const outsider = Keypair.random();

const daoState: DaoState = {
  accountId: dao.publicKey(),
  sequence: '1000',
  signers: signers.map((s) => ({ key: s.publicKey(), weight: 1 })),
  medThreshold: 2,
};

function fakeLedger() {
  const submitted: Transaction[] = [];
  const ledger: Ledger = {
    async loadDao() { return daoState; },
    async submit(tx) { submitted.push(tx); return { hash: tx.hash().toString('hex'), ledger: 1 }; },
  };
  return { ledger, submitted };
}

function github(body: unknown, status = 200): typeof fetch {
  return (async (url: unknown) => {
    assert.match(String(url), /^https:\/\/api\.github\.com\/repos\/[\w.-]+\/[\w.-]+\/pulls\/\d+$/);
    return new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } });
  }) as typeof fetch;
}

const MERGED = { state: 'closed', merged: true, merged_at: '2026-11-20T03:33:48Z', title: 'add example' };
const OPEN = { state: 'open', merged: false, merged_at: null, title: 'wip' };
const CLOSED_UNMERGED = { state: 'closed', merged: false, merged_at: null, title: 'dropped' };

const cfg = (): AgentConfig => ({
  dao: dao.publicKey(), grantee: grantee.publicKey(), amountXlm: '50', milestone: { owner: 'o', repo: 'r', pr: 7 },
});

test('milestone is met only for a merged PR; open and closed-unmerged are not met', async () => {
  assert.equal((await checkMilestone({ owner: 'o', repo: 'r', pr: 7 }, github(MERGED))).met, true);
  assert.equal((await checkMilestone({ owner: 'o', repo: 'r', pr: 7 }, github(OPEN))).met, false);
  assert.equal((await checkMilestone({ owner: 'o', repo: 'r', pr: 7 }, github(CLOSED_UNMERGED))).met, false);
});

test('an unreadable answer throws instead of guessing', async () => {
  await assert.rejects(checkMilestone({ owner: 'o', repo: 'r', pr: 7 }, github({}, 404)), /cannot verify/);
  await assert.rejects(checkMilestone({ owner: 'o', repo: 'r', pr: 7 }, github({ weird: true })), /unexpected/);
});

test('milestone input cannot smuggle a path into the API URL', async () => {
  for (const m of [{ owner: '../x', repo: 'r', pr: 1 }, { owner: 'o', repo: 'r/../../z', pr: 1 }, { owner: 'o', repo: 'r', pr: 0 }, { owner: 'o', repo: 'r', pr: 1.5 }]) {
    await assert.rejects(checkMilestone(m, github(MERGED)), /invalid milestone/);
  }
});

test('milestone not met: nothing is proposed and the chain is never read', async () => {
  let ledgerCalls = 0;
  const ledger: Ledger = {
    async loadDao() { ledgerCalls++; return daoState; },
    async submit() { throw new Error('must not submit'); },
  };
  for (const body of [OPEN, CLOSED_UNMERGED]) {
    const r = await proposeIfMet(cfg(), { ledger, fetchImpl: github(body) });
    assert.equal(r.proposal, null);
  }
  assert.equal(ledgerCalls, 0);
});

test('milestone met: an UNSIGNED single payment from the DAO is proposed', async () => {
  const { ledger } = fakeLedger();
  const { proposal } = await proposeIfMet(cfg(), { ledger, fetchImpl: github(MERGED), now: () => new Date('2026-11-20T10:00:00Z') });
  assert.ok(proposal);
  const d = decode(proposal.xdr, proposal.networkPassphrase);
  assert.equal(d.signatures, 0, 'the agent attaches no signature');
  assert.equal(d.source, dao.publicKey());
  assert.deepEqual(d.operations, [{ type: 'payment', destination: grantee.publicKey(), amount: '50.0000000', asset: 'XLM' }]);
  assert.equal(proposal.networkPassphrase, PASSPHRASE);
  assert.equal(proposal.signatures.length, 0);
  const tx = new Transaction(proposal.xdr, PASSPHRASE);
  assert.equal(Number(tx.timeBounds?.maxTime), Math.floor(Date.parse('2026-11-20T10:00:00Z') / 1000) + 86400);
});

test('the agent refuses a secret key where an address is expected (it never holds a signing key)', async () => {
  const { ledger } = fakeLedger();
  await assert.rejects(proposeIfMet({ ...cfg(), dao: signers[0]!.secret() }, { ledger, fetchImpl: github(MERGED) }), /never holds a secret/);
});

async function proposed() {
  const { ledger, submitted } = fakeLedger();
  const { proposal } = await proposeIfMet(cfg(), { ledger, fetchImpl: github(MERGED) });
  return { p: proposal!, ledger, submitted };
}

test('ONE signature is not enough: submit refuses and the ledger is never called', async () => {
  const { p, ledger, submitted } = await proposed();
  const one = signProposal(p, signers[0]!.secret(), daoState);
  assert.equal(tally(one, daoState).weight, 1);
  await assert.rejects(submitProposal(one, ledger), /not enough signatures: weight 1 of 2/);
  assert.equal(submitted.length, 0);
});

test('no signatures at all is refused', async () => {
  const { p, ledger, submitted } = await proposed();
  await assert.rejects(submitProposal(p, ledger), /weight 0 of 2/);
  assert.equal(submitted.length, 0);
});

test('two different DAO signers: submitted once, with exactly those two signatures', async () => {
  const { p, ledger, submitted } = await proposed();
  const two = signProposal(signProposal(p, signers[0]!.secret(), daoState), signers[2]!.secret(), daoState);
  const r = await submitProposal(two, ledger);
  assert.equal(submitted.length, 1);
  assert.equal(submitted[0]!.signatures.length, 2);
  assert.equal(r.tally.weight, 2);
  // the submitted transaction is the proposed one, byte for byte apart from signatures
  assert.equal(submitted[0]!.hash().toString('hex'), p.hash);
});

test('the same signer twice, an outsider, or a bad signature do not add weight', async () => {
  const { p, ledger, submitted } = await proposed();
  const a = signProposal(p, signers[0]!.secret(), daoState);
  const dup = { ...a, signatures: [...a.signatures, a.signatures[0]!] };
  assert.equal(tally(dup, daoState).weight, 1);
  assert.deepEqual(tally(dup, daoState).rejected.map((r) => r.reason), ['duplicate']);

  const outsiderSig = { signer: outsider.publicKey(), signature: outsider.sign(Buffer.from(p.hash, 'hex')).toString('base64') };
  assert.equal(tally({ ...a, signatures: [...a.signatures, outsiderSig] }, daoState).weight, 1);

  const forged = { signer: signers[1]!.publicKey(), signature: signers[0]!.sign(Buffer.from(p.hash, 'hex')).toString('base64') };
  const t = tally({ ...a, signatures: [...a.signatures, forged] }, daoState);
  assert.equal(t.weight, 1);
  assert.deepEqual(t.rejected.map((r) => r.reason), ['signature does not verify']);

  await assert.rejects(submitProposal({ ...a, signatures: [...a.signatures, outsiderSig, forged] }, ledger), /not enough/);
  assert.equal(submitted.length, 0);
});

test('a key that is not a DAO signer cannot sign, and a signer cannot sign twice', async () => {
  const { p } = await proposed();
  assert.throws(() => signProposal(p, outsider.secret(), daoState), /not a signer/);
  const once = signProposal(p, signers[1]!.secret(), daoState);
  assert.throws(() => signProposal(once, signers[1]!.secret(), daoState), /already signed/);
});

test('a proposal whose XDR was swapped for a different payment is not signed', async () => {
  const { p } = await proposed();
  const evil = await proposeIfMet({ ...cfg(), grantee: outsider.publicKey(), amountXlm: '9000' }, { ledger: fakeLedger().ledger, fetchImpl: github(MERGED) });
  const swapped = { ...p, xdr: evil.proposal!.xdr }; // summary still says 50 XLM to the grantee
  assert.throws(() => assertMatchesProposal(swapped), /hash does not match/);
  assert.throws(() => signProposal(swapped, signers[0]!.secret(), daoState), /hash does not match/);
  const reHashed = { ...swapped, hash: evil.proposal!.hash };
  assert.throws(() => assertMatchesProposal(reHashed), /differs from the proposal summary/);
});

test('a signature over a different transaction does not count', async () => {
  const { p } = await proposed();
  const other = await proposeIfMet({ ...cfg(), amountXlm: '1' }, { ledger: fakeLedger().ledger, fetchImpl: github(MERGED) });
  const sigOnOther = signProposal(other.proposal!, signers[0]!.secret(), daoState).signatures[0]!;
  assert.equal(tally({ ...p, signatures: [sigOnOther] }, daoState).weight, 0);
});

test('proposal XDR round-trips and carries no signatures until signers add them', async () => {
  const { p } = await proposed();
  const tx = TransactionBuilder.fromXDR(p.xdr, PASSPHRASE) as Transaction;
  assert.equal(tx.signatures.length, 0);
  assert.equal(tx.hash().toString('hex'), p.hash);
});
