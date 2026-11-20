/**
 * Offline tests. The anchoring HTTP call is mocked (an Anchorer stub, plus one
 * test that mocks global fetch to inspect what the SDK really sends).
 * `nirium verify` is replaced by a fake verifier that only accepts a hash
 * that equals what was anchored for that CID, which is what the real one checks.
 */
import assert from 'node:assert/strict';
import { mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';
import { Keypair } from '@stellar/stellar-sdk';
import { canonicalJson, sha256Hex, statementFor } from '../src/canonical.js';
import { checkBatch, type Verifier } from '../src/check.js';
import { Gateway, niriumAnchorer, type Anchorer } from '../src/gateway.js';
import { Sensor, verifyReading } from '../src/sensor.js';
import { loadSensors, simulateWindow } from '../src/sim.js';
import { LocalStore } from '../src/store.js';

const TAG = 'wave11-iot-readings';

function fakeNode() {
  const anchored = new Map<string, string>(); // cid -> sha256
  const calls: { hash: string; tag: string }[] = [];
  const anchorer: Anchorer = {
    async anchor(hash, agent, tag) {
      calls.push({ hash, tag });
      assert.equal(agent.signature.length > 0, true);
      const cid = `Qm${hash.slice(0, 44)}`;
      anchored.set(cid, hash);
      return { cid, contentSha256: hash, anchoredAt: '2026-11-20T00:00:00.000Z', attestedBy: agent.key } as never;
    },
  };
  const verify: Verifier = (cid, sha) => {
    const ok = anchored.get(cid) === sha;
    return { ok, output: ok ? 'VERIFICATION PASSED' : 'HASH: MISMATCH' };
  };
  return { anchorer, verify, calls };
}

async function setup(batches = 2) {
  const dir = mkdtempSync(join(tmpdir(), 'iot-test-'));
  const store = new LocalStore(dir);
  const node = fakeNode();
  const kp = Keypair.random();
  const gateway = new Gateway(store, node.anchorer, kp, TAG);
  const sensors = loadSensors(store);
  let seqs = new Map<string, number>();
  const start = Date.parse('2026-11-20T10:00:00Z');
  for (let i = 0; i < batches; i++) {
    const ws = new Date(start + i * 300_000);
    seqs = simulateWindow(sensors, gateway, ws, 5, 7 + i, seqs);
    await gateway.flush(ws, new Date(ws.getTime() + 300_000));
  }
  return { store, node, kp, gateway, sensors, dir };
}

test('canonical JSON sorts keys and the statement matches the Audit Trail format', () => {
  assert.equal(canonicalJson({ b: 1, a: { d: 2, c: [3, { z: 1, y: 2 }] } }), '{"a":{"c":[3,{"y":2,"z":1}],"d":2},"b":1}');
  assert.equal(statementFor('ab'), 'nirium-audit-v1:ab');
});

test('a sensor signs with its own key; any change to the reading breaks the signature', () => {
  const a = new Sensor('s1', 'temperature', 'C');
  const b = new Sensor('s2', 'temperature', 'C');
  const r = a.read(21.5, new Date('2026-11-20T10:00:00Z'));
  assert.equal(verifyReading(r, a.publicKeyHex), true);
  assert.equal(verifyReading(r, b.publicKeyHex), false, "another sensor's key must not verify it");
  assert.equal(verifyReading({ ...r, value: 22 }, a.publicKeyHex), false);
  assert.equal(verifyReading({ ...r, seq: 9 }, a.publicKeyHex), false);
  assert.equal(verifyReading({ ...r, signature: 'not-base64!!' }, a.publicKeyHex), false);
});

test('a sensor restored from its seed has the same public key', () => {
  const a = new Sensor('s1', 'temperature', 'C');
  assert.equal(new Sensor('s1', 'temperature', 'C', a.seedHex()).publicKeyHex, a.publicKeyHex);
});

test('a run of batches gives one receipt per batch and keeps every batch file, hash = file bytes', async () => {
  const { store, node } = await setup(3);
  const receipts = store.receipts();
  assert.equal(receipts.length, 3);
  assert.equal(node.calls.length, 3);
  for (const r of receipts) {
    assert.equal(r.sha256, sha256Hex(store.loadBatchBytes(r.batchId)));
    assert.deepEqual(r.sensors, ['humid-b', 'temp-a', 'temp-c']);
    assert.equal(r.readings, 15);
    assert.equal(r.tag, TAG);
  }
});

test('the node only ever sees a hash, a tag and the attestation, never readings', async () => {
  const sent: { url: string; body: Record<string, unknown> }[] = [];
  const real = global.fetch;
  global.fetch = (async (url: unknown, init?: RequestInit) => {
    sent.push({ url: String(url), body: JSON.parse(String(init?.body ?? '{}')) });
    const hash = sent[sent.length - 1]!.body.hash as string;
    return new Response(JSON.stringify({ cid: 'QmX', content_sha256: hash, anchoredAt: 't', attestedBy: (sent[0]!.body.agent as { key: string }).key }), {
      status: 200, headers: { 'Content-Type': 'application/json' },
    });
  }) as typeof fetch;
  try {
    const store = new LocalStore(mkdtempSync(join(tmpdir(), 'iot-test-')));
    const gw = new Gateway(store, niriumAnchorer('https://mock-node.test'), Keypair.random(), TAG);
    const sensors = loadSensors(store);
    simulateWindow(sensors, gw, new Date('2026-11-20T10:00:00Z'), 2, 1, new Map());
    await gw.flush(new Date('2026-11-20T10:00:00Z'), new Date('2026-11-20T10:02:00Z'));
  } finally {
    global.fetch = real;
  }
  assert.equal(sent.length, 1);
  assert.equal(sent[0]!.url, 'https://mock-node.test/api/audit/log');
  assert.deepEqual(Object.keys(sent[0]!.body).sort(), ['agent', 'hash', 'tag']);
  assert.equal(JSON.stringify(sent[0]!.body).includes('temperature'), false);
});

test('the gateway rejects forged, unknown and duplicate readings', async () => {
  const { store, gateway, sensors } = await setup(0);
  const s = sensors[0]!;
  const good = s.read(20, new Date());
  assert.throws(() => gateway.ingest({ ...good, value: 99 }), /bad signature/);
  assert.throws(() => gateway.ingest(new Sensor('rogue', 'temperature', 'C').read(1, new Date())), /unknown sensor/);
  gateway.ingest(good);
  assert.throws(() => gateway.ingest(good), /duplicate/);
  assert.equal(gateway.pendingCount, 1);
  assert.throws(() => store.register(s.id, new Sensor('x', 'm', 'u').publicKeyHex), /different key/);
});

test('gateway refuses a tag without the wave11- prefix and an empty window makes no receipt', async () => {
  const store = new LocalStore(mkdtempSync(join(tmpdir(), 'iot-test-')));
  assert.throws(() => new Gateway(store, fakeNode().anchorer, Keypair.random(), 'prod-iot'), /wave11-/);
  const gw = new Gateway(store, fakeNode().anchorer, Keypair.random(), TAG);
  assert.equal(await gw.flush(new Date(), new Date()), null);
});

test('check-batch passes on an untouched batch (both layers)', async () => {
  const { store, node } = await setup(2);
  const c = checkBatch('batch-0001', store, node.verify);
  assert.equal(c.ok, true);
  assert.equal(c.readingsChecked, 15);
  assert.deepEqual(c.badReadings, []);
  assert.equal(c.recomputed, c.anchored);
});

test('altering one reading fails the check and names that reading', async () => {
  const { store, node } = await setup(2);
  const p = join(store.dir, 'batches', 'batch-0002.json');
  const batch = JSON.parse(readFileSync(p, 'utf8'));
  const target = batch.readings[4];
  target.value = target.value + 10;
  writeFileSync(p, JSON.stringify(batch, null, 2) + '\n');
  const c = checkBatch('batch-0002', store, node.verify);
  assert.equal(c.ok, false);
  assert.deepEqual(c.badReadings, [`${target.sensorId}#${target.seq}`], 'only the altered reading is named');
  assert.equal(c.receiptOk, false, 'layer 2 also fails: the file hash no longer matches the anchor');
  assert.equal(checkBatch('batch-0001', store, node.verify).ok, true, 'other batches are unaffected');
});

test('deleting a reading keeps every signature valid but fails the receipt layer', async () => {
  const { store, node } = await setup(1);
  const p = join(store.dir, 'batches', 'batch-0001.json');
  const batch = JSON.parse(readFileSync(p, 'utf8'));
  batch.readings.splice(3, 1);
  writeFileSync(p, JSON.stringify(batch, null, 2) + '\n');
  const c = checkBatch('batch-0001', store, node.verify);
  assert.deepEqual(c.badReadings, []);
  assert.equal(c.receiptOk, false);
  assert.equal(c.ok, false);
});

test('swapping a sensor key inside the batch file is caught against the pinned registry', async () => {
  const { store, node } = await setup(1);
  const p = join(store.dir, 'batches', 'batch-0001.json');
  const batch = JSON.parse(readFileSync(p, 'utf8'));
  const evil = new Sensor('temp-a', 'temperature', 'C');
  batch.sensors.find((s: { id: string }) => s.id === 'temp-a').publicKey = evil.publicKeyHex;
  writeFileSync(p, JSON.stringify(batch, null, 2) + '\n');
  const c = checkBatch('batch-0001', store, node.verify);
  assert.equal(c.ok, false);
  assert.ok(c.problems.some((x) => /listed key differs/.test(x)));
});

test('a node that anchored a different hash is rejected', async () => {
  const store = new LocalStore(mkdtempSync(join(tmpdir(), 'iot-test-')));
  const bad: Anchorer = { anchor: async () => ({ cid: 'Qm', contentSha256: 'deadbeef', anchoredAt: 't' }) as never };
  const gw = new Gateway(store, bad, Keypair.random(), TAG);
  simulateWindow(loadSensors(store), gw, new Date('2026-11-20T10:00:00Z'), 1, 1, new Map());
  await assert.rejects(gw.flush(new Date(), new Date()), /expected/);
});
