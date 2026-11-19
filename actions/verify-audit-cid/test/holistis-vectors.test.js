// Test vectors by github.com/holistis, 2026-11-19
// (agent-receipt-verify, vectors/nirium-verify-audit-cid, Apache-2.0).
// Written from outside, from the two published Audit Trail receipts, without
// the Nirium SDK or CLI. Each file says what verifyAuditDocument must return.
// "accept-by-design" cases verify on purpose: read ok together with
// signatureStatus (an unsigned record passes on its hash, signature absent).
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { verifyAuditDocument } from '../lib/verify.js';

const dir = path.join(path.dirname(fileURLToPath(import.meta.url)), 'vectors', 'holistis');
const files = fs.readdirSync(dir).filter((f) => f.endsWith('.json')).sort();

test('holistis vectors: all 21 cases are present', () => {
  assert.equal(files.length, 21);
});

for (const f of files) {
  const v = JSON.parse(fs.readFileSync(path.join(dir, f), 'utf8'));
  test(`holistis vector ${f} (${v.kind})`, () => {
    const r = verifyAuditDocument(structuredClone(v.document));
    for (const [k, want] of Object.entries(v.expected)) assert.equal(r[k], want, `${f}: ${k}`);
  });
}
