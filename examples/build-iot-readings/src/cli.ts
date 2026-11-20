import 'dotenv/config';
import { Keypair } from '@stellar/stellar-sdk';
import { checkBatch } from './check.js';
import { Gateway, niriumAnchorer } from './gateway.js';
import { loadSensors, saveSensors, simulateWindow } from './sim.js';
import { LocalStore } from './store.js';

const env = (k: string, d = '') => (process.env[k] ?? d).trim();
const store = new LocalStore(env('IOT_DIR', '.iot'));

function keypair(): Keypair {
  const s = env('IOT_GATEWAY_SECRET');
  if (!s) throw new Error('Set IOT_GATEWAY_SECRET to your own Stellar testnet secret (see .env.example).');
  return Keypair.fromSecret(s);
}

function arg(rest: string[], name: string, d: number): number {
  const i = rest.indexOf(name);
  const v = i >= 0 ? Number(rest[i + 1]) : d;
  if (!Number.isInteger(v) || v < 1) throw new Error(`${name} must be a positive integer`);
  return v;
}

function makeGateway(): { gateway: Gateway; kp: Keypair; tag: string } {
  const kp = keypair();
  const tag = env('IOT_TAG', 'wave11-iot-readings');
  const anchorer = niriumAnchorer(env('NIRIUM_API_URL', 'https://nirium-agent.fly.dev'), env('NIRIUM_API_KEY'));
  return { gateway: new Gateway(store, anchorer, kp, tag), kp, tag };
}

async function main(argv: string[]): Promise<number> {
  const [cmd, ...rest] = argv;
  if (cmd === 'run' || cmd === 'watch') {
    const intervalMin = arg(rest, '--interval-min', Number(env('IOT_INTERVAL_MIN', '5')));
    const { gateway, kp, tag } = makeGateway();
    const sensors = loadSensors(store);
    let seqs = new Map(store.simState().map((s) => [s.id, s.seq]));
    console.log(`gateway key ${kp.publicKey()}  tag ${tag}  sensors ${sensors.map((s) => s.id).join(', ')}`);

    const oneBatch = async (windowStart: Date, seed: number): Promise<void> => {
      seqs = simulateWindow(sensors, gateway, windowStart, intervalMin, seed, seqs);
      const end = new Date(windowStart.getTime() + intervalMin * 60_000);
      const r = await gateway.flush(windowStart, end);
      saveSensors(store, sensors, seqs);
      if (r) console.log(`${r.batchId}  ${r.readings} readings from ${r.sensors.join('+')}  sha256 ${r.sha256}  cid ${r.cid}  anchoredAt ${r.anchoredAt}`);
    };

    if (cmd === 'run') {
      // Simulated clock: N windows of `intervalMin` minutes, no real waiting.
      const batches = arg(rest, '--batches', 3);
      const start = Date.now() - batches * intervalMin * 60_000;
      for (let i = 0; i < batches; i++) {
        await oneBatch(new Date(start + i * intervalMin * 60_000), 1000 + store.receipts().length);
      }
      return 0;
    }
    // watch: real clock; every N minutes simulate that window and anchor one receipt. Ctrl+C to stop.
    console.log(`watching: one batch every ${intervalMin} min (Ctrl+C to stop)`);
    for (;;) {
      await new Promise((r) => setTimeout(r, intervalMin * 60_000));
      await oneBatch(new Date(Date.now() - intervalMin * 60_000), Date.now());
    }
  }
  if (cmd === 'check-batch') {
    const id = rest[0];
    if (!id) { console.error('usage: check-batch <batch-id>'); return 2; }
    const r = checkBatch(id, store);
    console.log(r.verifyOutput);
    console.log(`\nlayer 1 (sensor signatures): ${r.readingsChecked - r.badReadings.length}/${r.readingsChecked} valid`);
    for (const b of r.badReadings) console.log(`  BAD READING ${b}`);
    for (const p of r.problems) console.log(`  PROBLEM ${p}`);
    console.log(`layer 2 (batch receipt):     recomputed ${r.recomputed}\n                             anchored   ${r.anchored}  ${r.receiptOk ? 'verify OK' : 'verify FAILED'}`);
    console.log(r.ok ? '\nCHECK PASSED' : '\nCHECK FAILED');
    return r.ok ? 0 : 1;
  }
  if (cmd === 'receipts') {
    if (rest.includes('--new-key')) {
      const kp = Keypair.random();
      console.log(`public  ${kp.publicKey()}\nsecret  ${kp.secret()}\n(put the secret in .env as IOT_GATEWAY_SECRET; never commit it)`);
      return 0;
    }
    for (const r of store.receipts()) console.log(`${r.batchId}  ${r.cid}  ${r.sha256}  ${r.sensors.join('+')}`);
    return 0;
  }
  console.error('usage: run [--batches N] [--interval-min M] | watch | check-batch <batch-id> | receipts [--new-key]');
  return 2;
}

main(process.argv.slice(2)).then((c) => { process.exitCode = c; }, (e) => { console.error(String(e?.message ?? e)); process.exitCode = 1; });
