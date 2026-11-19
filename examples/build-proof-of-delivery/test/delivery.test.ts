import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createHash } from 'node:crypto';
import { Keypair } from '@stellar/stellar-sdk';
import { DEMO_DELIVERIES } from '../src/demo.js';
import { niriumAnchorer, recordDelivery } from '../src/delivery.js';
import { checkDelivery, niriumCliVerify } from '../src/check.js';
import { buildRecord, canonicalJson, hashRecord, roundCoord, sha256Hex, statementFor } from '../src/record.js';
import { samplePhoto } from '../src/photo.js';
import { DeliveryStore } from '../src/store.js';

const TAG = 'wave11-proof-of-delivery';

/** Replaces global fetch: records every request and answers like the Audit Trail node. No network. */
function mockNode() {
  const calls: { url: string; body: string }[] = [];
  const anchored = new Map<string, string>(); // cid -> sha256
  const real = globalThis.fetch;
  globalThis.fetch = (async (url: string | URL, init?: RequestInit) => {
    const body = String(init?.body ?? '');
    calls.push({ url: String(url), body });
    const req = JSON.parse(body) as { hash: string; agent?: { key: string } };
    const cid = 'Qm' + createHash('sha256').update(req.hash).digest('hex').slice(0, 44);
    anchored.set(cid, req.hash);
    return new Response(JSON.stringify({ cid, content_sha256: req.hash, anchoredAt: '2026-11-19T06:00:00.000Z', attestedBy: req.agent?.key }), { status: 200 });
  }) as typeof fetch;
  return { calls, anchored, restore: () => { globalThis.fetch = real; } };
}

async function runDemo() {
  const dir = mkdtempSync(join(tmpdir(), 'pod-'));
  const store = new DeliveryStore(dir);
  const keypair = Keypair.random();
  const node = mockNode();
  try {
    const anchorer = niriumAnchorer('https://nirium-agent.example');
    const receipts = [];
    for (const d of DEMO_DELIVERIES) receipts.push(await recordDelivery(d.details, samplePhoto(d.photoSeed), { store, anchorer, keypair, tag: TAG }));
    const verify = (cid: string, sha: string) => ({ ok: node.anchored.get(cid) === sha, output: '' });
    return { dir, store, keypair, node, receipts, verify };
  } finally {
    node.restore();
  }
}

test('three deliveries produce three receipts, each signed by the courier key', async () => {
  const { keypair, receipts, node } = await runDemo();
  assert.equal(receipts.length, 3);
  assert.equal(new Set(receipts.map((r) => r.cid)).size, 3);
  assert.equal(node.calls.length, 3);
  for (const r of receipts) {
    assert.equal(r.attestedBy, keypair.publicKey());
    assert.ok(r.tag.startsWith('wave11-'));
  }
  for (const c of node.calls) {
    assert.ok(c.url.endsWith('/api/audit/log'));
    const b = JSON.parse(c.body);
    const sig = Buffer.from(b.agent.signature, 'base64');
    assert.ok(Keypair.fromPublicKey(b.agent.key).verify(Buffer.from(statementFor(b.hash), 'utf8'), sig));
  }
});

test('photo and details stay private: only hash, tag and signature are sent', async () => {
  const { store, node } = await runDemo();
  assert.equal(node.calls.length, 3);
  for (const [i, c] of node.calls.entries()) {
    const b = JSON.parse(c.body);
    assert.deepEqual(Object.keys(b).sort(), ['agent', 'hash', 'tag']);
    assert.match(b.hash, /^[0-9a-f]{64}$/);
    const d = DEMO_DELIVERIES[i].details;
    const photo = samplePhoto(DEMO_DELIVERIES[i].photoSeed);
    const leaks = [d.orderId, d.deliveredAt, String(d.lat), String(d.lon), String(roundCoord(d.lat)), String(roundCoord(d.lon)),
      sha256Hex(photo), photo.toString('base64').slice(0, 24), photo.toString('hex').slice(0, 24)];
    for (const s of leaks) assert.ok(!c.body.includes(s), `request body leaked "${s}"`);
  }
  // the photo and details are still kept locally for the shop
  assert.equal(readFileSync(store.photoPath('order-1001')).length, samplePhoto(1).length);
  assert.equal(store.loadDetails('order-1002').orderId, 'order-1002');
});

test('only the rounded location is stored and hashed, never the exact one', async () => {
  const { dir, store } = await runDemo();
  for (const { details } of DEMO_DELIVERIES) {
    const kept = store.loadDetails(details.orderId);
    assert.equal(kept.lat, roundCoord(details.lat));
    assert.equal(kept.lon, roundCoord(details.lon));
    const raw = readFileSync(join(dir, 'details', `${details.orderId}.json`), 'utf8');
    assert.ok(!raw.includes(String(details.lat)) && !raw.includes(String(details.lon)));
  }
  assert.equal(roundCoord(40.712776), 40.71);
});

test('check-delivery passes with the original photo and fails with a different one', async () => {
  const { dir, store, receipts, verify } = await runDemo();
  for (const r of receipts) assert.equal(checkDelivery(r.orderId, store.photoPath(r.orderId), store, verify).ok, true);

  const other = join(dir, 'other.png');
  writeFileSync(other, samplePhoto(99));
  const res = checkDelivery('order-1002', other, store, verify);
  assert.equal(res.ok, false);
  assert.notEqual(res.recomputed, res.anchored);

  // a one-byte edit to the original photo also fails
  const edited = Buffer.from(readFileSync(store.photoPath('order-1003')));
  edited[edited.length - 20] ^= 1;
  const ep = join(dir, 'edited.png');
  writeFileSync(ep, edited);
  assert.equal(checkDelivery('order-1003', ep, store, verify).ok, false);
});

test('check-delivery fails if the stored details are edited later', async () => {
  const { dir, store, verify } = await runDemo();
  const p = join(dir, 'details', 'order-1001.json');
  const d = JSON.parse(readFileSync(p, 'utf8'));
  d.deliveredAt = '2026-11-19T08:00:00Z';
  writeFileSync(p, JSON.stringify(d));
  assert.equal(checkDelivery('order-1001', store.photoPath('order-1001'), store, verify).ok, false);
});

test('the hash covers photo, order id, time and rounded location, independent of key order', () => {
  const details = { orderId: 'o1', deliveredAt: '2026-11-19T00:00:00Z', lat: 1.234, lon: 5.678 };
  const photo = samplePhoto(5);
  const r = buildRecord(details, photo);
  const h = hashRecord(r);
  assert.equal(h, hashRecord(JSON.parse(canonicalJson(r))));
  for (const change of [{ orderId: 'o2' }, { deliveredAt: '2026-11-19T00:01:00Z' }, { lat: 1.3 }, { lon: 5.7 }]) {
    assert.notEqual(hashRecord(buildRecord({ ...details, ...change }, photo)), h);
  }
  assert.notEqual(hashRecord(buildRecord(details, samplePhoto(6))), h);
  // same ~1 km cell -> same hash: the exact spot is not encoded
  assert.equal(hashRecord(buildRecord({ ...details, lat: 1.2341 }, photo)), h);
});

test('refuses tags outside wave11- before anything is anchored', async () => {
  const store = new DeliveryStore(mkdtempSync(join(tmpdir(), 'pod-')));
  await assert.rejects(recordDelivery(DEMO_DELIVERIES[0].details, samplePhoto(1), { store, anchorer: { anchor: async () => { throw new Error('should not anchor'); } }, keypair: Keypair.random(), tag: 'demo' }), /wave11-/);
  assert.equal(typeof niriumCliVerify, 'function');
});
