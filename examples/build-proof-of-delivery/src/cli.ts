import 'dotenv/config';
import { readFileSync } from 'node:fs';
import { Keypair } from '@stellar/stellar-sdk';
import { checkDelivery } from './check.js';
import { DEMO_DELIVERIES } from './demo.js';
import { niriumAnchorer, recordDelivery } from './delivery.js';
import { samplePhoto } from './photo.js';
import { DeliveryStore } from './store.js';

const env = (k: string, d = '') => (process.env[k] ?? d).trim();
const store = new DeliveryStore(env('DELIVERY_DIR', '.deliveries'));

function keypair(): Keypair {
  const s = env('COURIER_SECRET');
  if (!s) throw new Error('Set COURIER_SECRET to your own Stellar testnet secret (see .env.example).');
  return Keypair.fromSecret(s);
}

function flag(args: string[], name: string): string | undefined {
  const i = args.indexOf(name);
  return i >= 0 ? args[i + 1] : undefined;
}

function opts() {
  return {
    store,
    anchorer: niriumAnchorer(env('NIRIUM_API_URL', 'https://nirium-agent.fly.dev'), env('NIRIUM_API_KEY')),
    keypair: keypair(),
    tag: env('DELIVERY_TAG', 'wave11-proof-of-delivery'),
  };
}

async function main(argv: string[]): Promise<number> {
  const [cmd, ...rest] = argv;
  if (cmd === 'demo') {
    const o = opts();
    console.log(`courier key ${o.keypair.publicKey()}  tag ${o.tag}`);
    for (const d of DEMO_DELIVERIES) {
      const r = await recordDelivery(d.details, samplePhoto(d.photoSeed), o);
      console.log(`${r.orderId}  sha256 ${r.sha256}  cid ${r.cid}  anchoredAt ${r.anchoredAt}`);
    }
    return 0;
  }
  if (cmd === 'deliver') {
    const [orderId] = rest;
    const photo = flag(rest, '--photo');
    const lat = Number(flag(rest, '--lat'));
    const lon = Number(flag(rest, '--lon'));
    if (!orderId || !photo || Number.isNaN(lat) || Number.isNaN(lon)) {
      console.error('usage: deliver <order-id> --photo <file> --lat <lat> --lon <lon> [--at <iso-time>]');
      return 2;
    }
    const deliveredAt = flag(rest, '--at') ?? new Date().toISOString();
    const r = await recordDelivery({ orderId, deliveredAt, lat, lon }, readFileSync(photo), opts());
    console.log(`${r.orderId}  sha256 ${r.sha256}  cid ${r.cid}  anchoredAt ${r.anchoredAt}`);
    return 0;
  }
  if (cmd === 'check-delivery') {
    const [orderId] = rest;
    const photo = flag(rest, '--photo') ?? (orderId ? store.photoPath(orderId) : undefined);
    if (!orderId || !photo) { console.error('usage: check-delivery <order-id> [--photo <file>]'); return 2; }
    const r = checkDelivery(orderId, photo, store);
    console.log(r.verifyOutput);
    console.log(`\nrecomputed ${r.recomputed}\nanchored   ${r.anchored}\n${r.ok ? 'CHECK PASSED' : 'CHECK FAILED'}`);
    return r.ok ? 0 : 1;
  }
  if (cmd === 'receipts') {
    if (rest.includes('--new-key')) {
      const kp = Keypair.random();
      console.log(`public  ${kp.publicKey()}\nsecret  ${kp.secret()}\n(put the secret in .env as COURIER_SECRET; never commit it)`);
      return 0;
    }
    for (const r of store.receipts()) console.log(`${r.orderId}  ${r.cid}  ${r.sha256}`);
    return 0;
  }
  if (cmd === 'sample-photo') {
    // writes a demo photo to stdout, e.g. to make "a different photo" for check-delivery
    process.stdout.write(samplePhoto(Number(rest[0] ?? 99)));
    return 0;
  }
  console.error('usage: demo | deliver <order-id> --photo <f> --lat <n> --lon <n> | check-delivery <order-id> [--photo <f>] | receipts [--new-key]');
  return 2;
}

main(process.argv.slice(2)).then((c) => { process.exitCode = c; }, (e) => { console.error(String(e?.message ?? e)); process.exitCode = 1; });
