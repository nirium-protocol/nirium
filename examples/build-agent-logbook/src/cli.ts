import 'dotenv/config';
import { Keypair } from '@stellar/stellar-sdk';
import { DEMO_TASKS, RuleBasedAgent } from './agent.js';
import { checkTask } from './check.js';
import { niriumAnchorer, runTask } from './logbook.js';
import { LocalStore } from './store.js';

const env = (k: string, d = '') => (process.env[k] ?? d).trim();
const store = new LocalStore(env('LOGBOOK_DIR', '.logbook'));

function keypair(): Keypair {
  const s = env('LOGBOOK_AGENT_SECRET');
  if (!s) throw new Error('Set LOGBOOK_AGENT_SECRET to your own Stellar testnet secret (see .env.example).');
  return Keypair.fromSecret(s);
}

async function main(argv: string[]): Promise<number> {
  const [cmd, ...rest] = argv;
  if (cmd === 'run') {
    const kp = keypair();
    const anchorer = niriumAnchorer(env('NIRIUM_API_URL', 'https://nirium-agent.fly.dev'), env('NIRIUM_API_KEY'));
    const tag = env('LOGBOOK_TAG', 'wave11-agent-logbook');
    const agent = new RuleBasedAgent();
    console.log(`agent key ${kp.publicKey()}  tag ${tag}`);
    for (const prompt of DEMO_TASKS) {
      const r = await runTask(prompt, { agent, store, anchorer, keypair: kp, tag });
      console.log(`${r.taskId}  sha256 ${r.sha256}  cid ${r.cid}  anchoredAt ${r.anchoredAt}`);
    }
    return 0;
  }
  if (cmd === 'check-task') {
    const id = rest[0];
    if (!id) { console.error('usage: check-task <task-id>'); return 2; }
    const r = checkTask(id, store);
    console.log(r.verifyOutput);
    console.log(`\nrecomputed ${r.recomputed}\nanchored   ${r.anchored}\n${r.ok ? 'CHECK PASSED' : 'CHECK FAILED'}`);
    return r.ok ? 0 : 1;
  }
  if (cmd === 'receipts') {
    if (rest.includes('--new-key')) {
      const kp = Keypair.random();
      console.log(`public  ${kp.publicKey()}\nsecret  ${kp.secret()}\n(put the secret in .env as LOGBOOK_AGENT_SECRET; never commit it)`);
      return 0;
    }
    for (const r of store.receipts()) console.log(`${r.taskId}  ${r.cid}  ${r.sha256}`);
    return 0;
  }
  console.error('usage: run | check-task <task-id> | receipts [--new-key]');
  return 2;
}

main(process.argv.slice(2)).then((c) => { process.exitCode = c; }, (e) => { console.error(String(e?.message ?? e)); process.exitCode = 1; });
