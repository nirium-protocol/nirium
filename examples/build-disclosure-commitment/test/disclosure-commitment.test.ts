import assert from 'node:assert/strict';
import { mkdtemp, rm, writeFile, mkdir } from 'node:fs/promises';
import { join } from 'node:path';
import test from 'node:test';
import { Keypair } from '@stellar/stellar-sdk';
import { commitReport, type Anchorer } from '../src/anchor.js';
import { computeCommitmentHash, generateSalt, hashReport, statementFor } from '../src/crypto.js';
import { createLocalStore, type LocalStore } from '../src/store.js';
import { revealReport, type Verifier } from '../src/verify.js';

interface RecordedRequest {
  hash: string;
  tag: string;
  agent: { key: string; signature: string; id?: string };
}

async function createTempStore(): Promise<{ root: string; store: LocalStore; cleanup: () => Promise<void> }> {
  const tmpBase = join(process.cwd(), '.test-tmp');
  await mkdir(tmpBase, { recursive: true });
  const root = await mkdtemp(join(tmpBase, 'cmt-'));
  const storePath = join(root, 'commitments.json');
  const store = createLocalStore(storePath);
  return {
    root,
    store,
    cleanup: async () => {
      await rm(root, { recursive: true, force: true });
    },
  };
}

function mockAnchorer(recordedRequests: RecordedRequest[]): Anchorer {
  return {
    anchor: async (hash, agent, tag) => {
      recordedRequests.push({ hash, agent, tag });
      return {
        cid: `bafyfakecid${hash.slice(0, 12)}`,
        contentSha256: hash,
        anchoredAt: '2026-11-23T02:00:00.000Z',
        tag,
        attestedBy: agent.key,
      };
    },
  };
}

test('crypto helpers compute reproducible salted commitment hashes', () => {
  const content = '# High Severity Bug in Protocol Vault';
  const reportSha = hashReport(content);
  assert.equal(reportSha.length, 64);

  const salt1 = generateSalt(32);
  const salt2 = generateSalt(32);
  assert.notEqual(salt1, salt2);

  const commit1 = computeCommitmentHash(reportSha, salt1);
  const commit2 = computeCommitmentHash(reportSha, salt2);
  assert.notEqual(commit1, commit2);

  // Exact same content + same salt gives exact same commitment hash
  const commit1Recomputed = computeCommitmentHash(reportSha, salt1);
  assert.equal(commit1, commit1Recomputed);

  assert.equal(statementFor(commit1), `nirium-audit-v1:${commit1}`);
});

test('commitReport enforces wave11- tag prefix', async () => {
  const { store, cleanup } = await createTempStore();
  const keypair = Keypair.random();
  const requests: RecordedRequest[] = [];
  const anchorer = mockAnchorer(requests);

  await assert.rejects(
    async () => {
      await commitReport({
        reportContent: 'Sample report',
        reportName: 'sample.md',
        keypair,
        store,
        anchorer,
        tag: 'invalid-tag-prefix',
      });
    },
    /Anchor tag must start with "wave11-"/,
  );

  await cleanup();
});

test('commitReport correctly anchors hash, signs attestation and persists record', async () => {
  const { store, cleanup } = await createTempStore();
  const keypair = Keypair.random();
  const requests: RecordedRequest[] = [];
  const anchorer = mockAnchorer(requests);

  const reportText = '# Vulnerability in Soroban Vault State Transition\n\nFull details here.';
  const record = await commitReport({
    reportContent: reportText,
    reportName: 'reports/soroban-bug.md',
    keypair,
    store,
    anchorer,
    tag: 'wave11-disclosure-commitment',
  });

  assert.equal(requests.length, 1);
  const req = requests[0];
  assert.equal(req.hash, record.commitmentSha256);
  assert.equal(req.tag, 'wave11-disclosure-commitment');
  assert.equal(req.agent.key, keypair.publicKey());

  // Verify signature over nirium-audit-v1:<hash>
  const expectedStatement = Buffer.from(`nirium-audit-v1:${record.commitmentSha256}`, 'utf8');
  const signatureBytes = Buffer.from(req.agent.signature, 'base64');
  assert.equal(keypair.verify(expectedStatement, signatureBytes), true);

  // Stored record matches
  const loaded = store.get(record.id);
  assert.ok(loaded);
  assert.equal(loaded.cid, record.cid);
  assert.equal(loaded.salt, record.salt);
  assert.equal(loaded.commitmentSha256, record.commitmentSha256);

  await cleanup();
});

test('revealReport successfully verifies matching report content against CID', async () => {
  const { store, cleanup } = await createTempStore();
  const keypair = Keypair.random();
  const requests: RecordedRequest[] = [];
  const anchorer = mockAnchorer(requests);

  const originalReport = '# Critical Finding in Payout Math\n\nRound-off error permits drain.';
  const record = await commitReport({
    reportContent: originalReport,
    reportName: 'reports/math-bug.md',
    keypair,
    store,
    anchorer,
  });

  const mockVerifier: Verifier = (cid, sha256) => {
    assert.equal(cid, record.cid);
    assert.equal(sha256, record.commitmentSha256);
    return { ok: true, output: `Receipt verified for ${cid}: hash matches IPFS payload` };
  };

  const result = revealReport(record.id, originalReport, store, mockVerifier);

  assert.equal(result.ok, true);
  assert.equal(result.tampered, false);
  assert.equal(result.recomputedCommitmentSha256, record.commitmentSha256);
  assert.match(result.message, /\[VERIFIED\] Report matches anchored commitment!/);

  await cleanup();
});

test('revealReport flags tampering when report text is modified post-commitment', async () => {
  const { store, cleanup } = await createTempStore();
  const keypair = Keypair.random();
  const requests: RecordedRequest[] = [];
  const anchorer = mockAnchorer(requests);

  const originalReport = 'Original un-tampered security report content.';
  const record = await commitReport({
    reportContent: originalReport,
    reportName: 'reports/test.md',
    keypair,
    store,
    anchorer,
  });

  const tamperedReport = 'Original un-tampered security report content! (tampered)';

  const mockVerifier: Verifier = (cid, sha256) => {
    // If hash does not match original, verifier fails
    if (sha256 !== record.commitmentSha256) {
      return { ok: false, output: `Hash mismatch: ${sha256} does not match CID ${cid}` };
    }
    return { ok: true, output: 'Verified' };
  };

  const result = revealReport(record.id, tamperedReport, store, mockVerifier);

  assert.equal(result.ok, false);
  assert.equal(result.tampered, true);
  assert.notEqual(result.recomputedCommitmentSha256, record.commitmentSha256);
  assert.match(result.message, /\[TAMPERED\] Report content has been modified after commitment!/);

  await cleanup();
});
