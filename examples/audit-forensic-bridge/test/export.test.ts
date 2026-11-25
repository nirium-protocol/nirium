import { afterEach, test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { appendAnchor, readAnchors } from '../src/anchors.js';
import { fetchAndVerifyAnchors, type CliVerification } from '../src/export.js';

const tempDirs: string[] = [];

afterEach(async () => {
  await Promise.all(tempDirs.splice(0).map((dir) => fs.rm(dir, { recursive: true, force: true })));
});

async function logPath(): Promise<string> {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'audit-bridge-test-'));
  tempDirs.push(dir);
  return path.join(dir, 'anchors.jsonl');
}

const hash = 'a'.repeat(64);

test('writes only receipt metadata and verifies each logged CID through the verifier', async () => {
  const file = await logPath();
  await appendAnchor({ cid: 'QmSampleOne', contentSha256: hash, attestedBy: 'GSAMPLE' }, file);
  await appendAnchor({ cid: 'QmSampleTwo', contentSha256: hash }, file);
  assert.deepEqual((await readAnchors(file)).map((item) => item.cid), ['QmSampleOne', 'QmSampleTwo']);

  const called: string[] = [];
  const report = await fetchAndVerifyAnchors({
    logPath: file,
    verify: async (cid): Promise<CliVerification> => {
      called.push(cid);
      return { verified: true, expectedHash: hash, hashStatus: 'match', signatureStatus: 'valid' };
    },
  });
  assert.deepEqual(called, ['QmSampleOne', 'QmSampleTwo']);
  assert.equal(report.verifiedCount, 2);
  assert.equal(report.flaggedCount, 0);
});

test('reports a changed record as failed', async () => {
  const file = await logPath();
  await appendAnchor({ cid: 'QmChangedRecord', contentSha256: hash }, file);
  const report = await fetchAndVerifyAnchors({
    logPath: file,
    verify: async () => ({ verified: false, expectedHash: hash, hashStatus: 'mismatch', signatureStatus: 'absent' }),
  });
  assert.equal(report.flaggedCount, 1);
  assert.match(report.records[0].reason ?? '', /Hash: mismatch/);
});

test('reports an invalid signature as failed', async () => {
  const file = await logPath();
  await appendAnchor({ cid: 'QmBadSignature', contentSha256: hash, attestedBy: 'GSAMPLE' }, file);
  const report = await fetchAndVerifyAnchors({
    logPath: file,
    verify: async () => ({ verified: false, expectedHash: hash, hashStatus: 'match', signatureStatus: 'invalid' }),
  });
  assert.equal(report.flaggedCount, 1);
  assert.match(report.records[0].reason ?? '', /signature: invalid/);
});

test('fails when the verified document does not match the local receipt', async () => {
  const file = await logPath();
  await appendAnchor({ cid: 'QmWrongLog', contentSha256: hash }, file);
  const report = await fetchAndVerifyAnchors({
    logPath: file,
    verify: async () => ({ verified: true, expectedHash: 'b'.repeat(64), hashStatus: 'match' }),
  });
  assert.equal(report.flaggedCount, 1);
  assert.match(report.records[0].reason ?? '', /differs from the local anchor log/);
});
