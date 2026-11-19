import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { Keypair } from '@stellar/stellar-sdk';
import { anchorRecord, buildRecord, buildTag, canonicalize, checkModel, recordBytes, sha256Hex, STATEMENT_PREFIX } from '../src/provenance.mjs';

const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'prov-'));
const w1 = path.join(dir, 'v1.bin'); const w2 = path.join(dir, 'v2.bin');
fs.writeFileSync(w1, 'weights-one'); fs.writeFileSync(w2, 'weights-two');
const mk = (file, version) => buildRecord({ artifactPath: file, name: 'demo', version, config: { lr: 0.1 }, dataSources: ['b', 'a'], codeCommit: 'a'.repeat(40), createdAt: '2026-11-19T00:00:00.000Z' });

test('canonicalize is key-order independent', () => {
  assert.equal(canonicalize({ b: 1, a: { d: 1, c: 2 } }), canonicalize({ a: { c: 2, d: 1 }, b: 1 }));
});

test('tag must start with wave11-', () => {
  assert.match(buildTag(mk(w1, 'v1')), /^wave11-/);
  assert.throws(() => buildTag(mk(w1, 'v1'), 'other-tag'));
});

test('anchor signs nirium-audit-v1:<sha256> and never sends the record', async () => {
  const kp = Keypair.random();
  const buf = recordBytes(mk(w1, 'v1'));
  let sent;
  const fetchFn = async (url, init) => { sent = { url, body: JSON.parse(init.body) }; return { ok: true, json: async () => ({ cid: 'bafyTEST', anchoredAt: 't' }) }; };
  const receipt = await anchorRecord(buf, { keypair: kp, tag: 'wave11-x', fetchFn });
  assert.equal(sent.url, 'https://nirium-agent.fly.dev/api/audit/log');
  assert.equal(sent.body.hash, sha256Hex(buf));
  assert.equal(sent.body.record, undefined);
  assert.ok(kp.verify(Buffer.from(`${STATEMENT_PREFIX}${sha256Hex(buf)}`), Buffer.from(sent.body.agent.signature, 'base64')));
  assert.equal(receipt.cid, 'bafyTEST');
});

test('two versions, two receipts: matching weights pass, swapped weights fail', () => {
  const b1 = recordBytes(mk(w1, 'v1')); const b2 = recordBytes(mk(w2, 'v2'));
  const r1 = { cid: 'c1', sha256: sha256Hex(b1), signer: 'G1' }; const r2 = { cid: 'c2', sha256: sha256Hex(b2), signer: 'G1' };
  const ok = () => ({ ok: true });
  assert.ok(checkModel({ artifactPath: w1, recordBuf: b1, receipt: r1, verifyReceipt: ok }).ok);
  assert.ok(checkModel({ artifactPath: w2, recordBuf: b2, receipt: r2, verifyReceipt: ok }).ok);
  assert.ok(!checkModel({ artifactPath: w2, recordBuf: b1, receipt: r1, verifyReceipt: ok }).ok, 'v2 weights vs v1 record');
  assert.ok(!checkModel({ artifactPath: w1, recordBuf: b2, receipt: r2, verifyReceipt: ok }).ok, 'v1 weights vs v2 record');
});

test('a record paired with the other version\'s receipt fails', () => {
  const b1 = recordBytes(mk(w1, 'v1')); const b2 = recordBytes(mk(w2, 'v2'));
  const r2 = { cid: 'c2', sha256: sha256Hex(b2), signer: 'G1' };
  assert.ok(!checkModel({ artifactPath: w1, recordBuf: b1, receipt: r2, verifyReceipt: () => ({ ok: true }) }).ok);
});

test('tampered record fails against its receipt', () => {
  const b1 = recordBytes(mk(w1, 'v1'));
  const r1 = { cid: 'c1', sha256: sha256Hex(b1), signer: 'G1' };
  const tampered = Buffer.from(b1.toString().replace('0.1', '0.9'));
  assert.ok(!checkModel({ artifactPath: w1, recordBuf: tampered, receipt: r1, verifyReceipt: () => ({ ok: true }) }).ok);
});
