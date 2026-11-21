import { Horizon, Transaction } from '@stellar/stellar-sdk';
import { proposeIfMet, type Proposal } from './agent.js';
import { explorerTx, horizonLedger, HORIZON_TESTNET } from './ledger.js';
import { milestoneId } from './milestone.js';
import { createDao } from './setup.js';
import { decode, signProposal } from './signer.js';
import { Store } from './store.js';
import { signedTransaction, submitProposal, tally } from './submit.js';

const store = new Store();
const ledger = horizonLedger();

function opt(rest: string[], name: string, d: string): string {
  const i = rest.indexOf(name);
  return i >= 0 && rest[i + 1] ? rest[i + 1]! : d;
}

function printTally(p: Proposal, t: ReturnType<typeof tally>): void {
  console.log(`signatures: ${p.signatures.length} attached, ${t.valid.length} valid -> weight ${t.weight} / ${t.threshold} required`);
  for (const v of t.valid) console.log(`  OK   ${v}`);
  for (const r of t.rejected) console.log(`  SKIP ${r.signer} (${r.reason})`);
}

async function main(argv: string[]): Promise<number> {
  const [cmd, ...rest] = argv;

  if (cmd === 'setup') {
    const d = await createDao();
    store.saveDao(
      { dao: d.dao, grantee: d.grantee, signers: d.signers.map((s) => s.publicKey), setupTx: d.setupTx },
      d.signers.map((s) => ({ n: s.n, secret: s.secret })),
    );
    console.log(`DAO account ${d.dao}\ngrantee     ${d.grantee}`);
    d.signers.forEach((s) => console.log(`signer ${s.n}    ${s.publicKey}`));
    console.log(`setup tx    ${d.setupTx}\n${explorerTx(d.setupTx)}`);
    console.log('signer secrets are in .keys/ (git-ignored). Never commit them.');
    return 0;
  }

  if (cmd === 'status') {
    const info = store.dao();
    const s = await ledger.loadDao(info.dao);
    console.log(`DAO ${s.accountId}\npayment threshold: ${s.medThreshold}`);
    for (const x of s.signers) console.log(`  signer ${x.key}  weight ${x.weight}${x.key === s.accountId ? '  (master key)' : ''}`);
    return 0;
  }

  if (cmd === 'propose') {
    const info = store.dao();
    const milestone = {
      owner: opt(rest, '--owner', 'nirium-protocol'),
      repo: opt(rest, '--repo', 'nirium'),
      pr: Number(opt(rest, '--pr', '412')),
    };
    // The agent is given only public addresses: no DAO signing key exists in this process.
    const { proposal, evidence } = await proposeIfMet(
      { dao: info.dao, grantee: info.grantee, amountXlm: opt(rest, '--amount', '50'), milestone },
      { ledger },
    );
    console.log(`milestone ${milestoneId(milestone)}: ${evidence.title ? `"${evidence.title}" ` : ''}state=${evidence.state} merged=${evidence.merged}`);
    if (!proposal) {
      console.log('NOT MET: nothing proposed.');
      return 0;
    }
    store.saveProposal(proposal);
    console.log(`MET: proposed payout ${proposal.details.amountXlm} XLM -> ${proposal.details.to}\nproposal ${proposal.id}  hash ${proposal.hash}\nunsigned XDR:\n${proposal.xdr}`);
    return 0;
  }

  if (cmd === 'inspect') {
    const p = store.loadProposal(rest[0] ?? '');
    console.log(JSON.stringify(decode(p.xdr, p.networkPassphrase), null, 2));
    printTally(p, tally(p, await ledger.loadDao(p.details.dao)));
    return 0;
  }

  if (cmd === 'sign') {
    const p = store.loadProposal(rest[0] ?? '');
    const n = Number(rest[1]);
    const secret = process.env.SIGNER_SECRET?.trim() || store.signerSecret(n);
    const dao = await ledger.loadDao(p.details.dao);
    console.log('signing exactly this:', JSON.stringify(decode(p.xdr, p.networkPassphrase)));
    const signed = signProposal(p, secret, dao);
    store.saveProposal(signed);
    const last = signed.signatures[signed.signatures.length - 1]!;
    console.log(`signed by ${last.signer}\nsignature ${last.signature}`);
    return 0;
  }

  if (cmd === 'submit') {
    const p = store.loadProposal(rest[0] ?? '');
    try {
      const r = await submitProposal(p, ledger);
      printTally(p, r.tally);
      console.log(`SETTLED in ledger ${r.ledger}\n${r.hash}\n${explorerTx(r.hash)}`);
      return 0;
    } catch (e) {
      printTally(p, tally(p, await ledger.loadDao(p.details.dao)));
      console.error(`REFUSED: ${(e as Error).message}`);
      return 1;
    }
  }

  if (cmd === 'demo-one-signature') {
    // Shows the network, not just this example, rejects one signature: it skips the local guard on purpose.
    const p = store.loadProposal(rest[0] ?? '');
    const first = p.signatures[0];
    if (!first) { console.error('sign the proposal once first'); return 2; }
    const tx = signedTransaction(p, [first.signer]) as Transaction;
    console.log(`submitting with ONE signature (${first.signer}) straight to Horizon...`);
    try {
      await new Horizon.Server(HORIZON_TESTNET).submitTransaction(tx);
      console.error('UNEXPECTED: accepted');
      return 1;
    } catch (e) {
      const codes = (e as { response?: { data?: { extras?: { result_codes?: unknown } } } }).response?.data?.extras?.result_codes;
      console.log(`rejected by the network: ${JSON.stringify(codes ?? String(e))}`);
      return 0;
    }
  }

  console.error('usage: setup | status | propose [--owner O --repo R --pr N --amount X] | inspect <id> | sign <id> <1|2|3> | submit <id> | demo-one-signature <id>');
  return 2;
}

main(process.argv.slice(2)).then((c) => { process.exitCode = c; }, (e) => { console.error(String(e?.message ?? e)); process.exitCode = 1; });
