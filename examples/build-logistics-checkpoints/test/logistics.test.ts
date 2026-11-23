import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { test } from 'node:test';
import { Keypair } from '@stellar/stellar-sdk';
import { verifyShipmentChain, type Verifier } from '../src/chain.js';
import { recordHandoff, type Anchorer } from '../src/checkpoint.js';
import { createDemoParties, runValidShipmentDemo } from '../src/demo.js';
import {
  buildRecord,
  canonicalJson,
  hashRecord,
  sha256Hex,
  statementFor,
  type HandoffDetails,
} from '../src/record.js';
import { CheckpointStore, type CheckpointReceipt } from '../src/store.js';

const TAG = 'wave11-logistics-checkpoints';

/**
 * Replaces global fetch: records every request and answers like the Audit Trail node.
 * Zero network calls; 100% offline.
 */
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
    return new Response(
      JSON.stringify({
        cid,
        content_sha256: req.hash,
        anchoredAt: '2026-11-23T12:00:00.000Z',
        attestedBy: req.agent?.key,
      }),
      { status: 200 },
    );
  }) as typeof fetch;

  return {
    calls,
    anchored,
    restore: () => {
      globalThis.fetch = real;
    },
  };
}

async function createTestEnv() {
  const dir = mkdtempSync(join(tmpdir(), 'logistics-'));
  const store = new CheckpointStore(dir);
  const parties = createDemoParties();
  const node = mockNode();
  const anchorer: Anchorer = {
    anchor: async (hash, agent, tag) => {
      const cid = 'Qm' + createHash('sha256').update(hash).digest('hex').slice(0, 44);
      node.anchored.set(cid, hash);
      return {
        cid,
        contentSha256: hash,
        anchoredAt: '2026-11-23T12:00:00.000Z',
        attestedBy: agent.key,
      };
    },
  };

  const testVerifier: Verifier = (cid: string, sha: string) => {
    const ok = node.anchored.get(cid) === sha;
    return {
      ok,
      output: ok ? `VERIFIED: ${cid}` : `MISMATCH: expected ${node.anchored.get(cid)}, got ${sha}`,
    };
  };

  return { dir, store, parties, node, anchorer, testVerifier };
}

test('valid 4-party shipment chain anchors 4 receipts and passes all provenance checks', async () => {
  const env = await createTestEnv();
  try {
    const shipmentId = 'SHP-TEST-001';
    const receipts = await runValidShipmentDemo(shipmentId, {
      store: env.store,
      anchorer: env.anchorer,
      tag: TAG,
      parties: env.parties,
    });

    assert.equal(receipts.length, 4);
    // Distinct CIDs
    assert.equal(new Set(receipts.map((r) => r.cid)).size, 4);
    // Distinct signers matching each party's key
    const signers = receipts.map((r) => r.attestedBy);
    assert.equal(new Set(signers).size, 4);
    for (let i = 0; i < 4; i++) {
      assert.equal(receipts[i].attestedBy, env.parties[i].keypair.publicKey());
      assert.equal(receipts[i].partyId, env.parties[i].id);
    }

    // Provenance linkage
    assert.equal(receipts[0].previousHandoffCid, null);
    assert.equal(receipts[1].previousHandoffCid, receipts[0].cid);
    assert.equal(receipts[2].previousHandoffCid, receipts[1].cid);
    assert.equal(receipts[3].previousHandoffCid, receipts[2].cid);

    // Full chain verification
    const res = await verifyShipmentChain(shipmentId, env.store, env.testVerifier);
    assert.equal(res.valid, true);
    assert.equal(res.totalHandoffs, 4);
    assert.equal(res.errors.length, 0);
  } finally {
    env.node.restore();
  }
});

test('chain verification flags missing handoff in sequence', async () => {
  const env = await createTestEnv();
  try {
    const shipmentId = 'SHP-MISSING-GAP';
    // Add handoff 0 (Origin)
    const r0 = await recordHandoff(
      {
        shipmentId,
        handoffIndex: 0,
        partyId: env.parties[0].id,
        locationLabel: env.parties[0].location,
        timestamp: '2026-11-23T10:00:00.000Z',
        scanHash: sha256Hex('SCAN-0'),
        previousHandoffCid: null,
      },
      { store: env.store, anchorer: env.anchorer, keypair: env.parties[0].keypair, tag: TAG },
    );

    // Skip handoff 1 -> directly add handoff 2 (index mismatch)
    await recordHandoff(
      {
        shipmentId,
        handoffIndex: 2,
        partyId: env.parties[2].id,
        locationLabel: env.parties[2].location,
        timestamp: '2026-11-23T12:00:00.000Z',
        scanHash: sha256Hex('SCAN-2'),
        previousHandoffCid: r0.cid,
      },
      { store: env.store, anchorer: env.anchorer, keypair: env.parties[2].keypair, tag: TAG },
    );

    const res = await verifyShipmentChain(shipmentId, env.store, env.testVerifier);
    assert.equal(res.valid, false);
    assert.ok(
      res.errors.some((e) => e.includes('expected index 1, found 2') || e.includes('requires at least 3 handoffs')),
    );
  } finally {
    env.node.restore();
  }
});

test('chain verification flags broken previousHandoffCid linkage', async () => {
  const env = await createTestEnv();
  try {
    const shipmentId = 'SHP-BROKEN-CID';
    const r0 = await recordHandoff(
      {
        shipmentId,
        handoffIndex: 0,
        partyId: env.parties[0].id,
        locationLabel: env.parties[0].location,
        timestamp: '2026-11-23T10:00:00.000Z',
        scanHash: sha256Hex('SCAN-0'),
        previousHandoffCid: null,
      },
      { store: env.store, anchorer: env.anchorer, keypair: env.parties[0].keypair, tag: TAG },
    );

    const r1 = await recordHandoff(
      {
        shipmentId,
        handoffIndex: 1,
        partyId: env.parties[1].id,
        locationLabel: env.parties[1].location,
        timestamp: '2026-11-23T11:00:00.000Z',
        scanHash: sha256Hex('SCAN-1'),
        previousHandoffCid: r0.cid,
      },
      { store: env.store, anchorer: env.anchorer, keypair: env.parties[1].keypair, tag: TAG },
    );

    // Handoff 2 references bogus CID instead of r1.cid
    await recordHandoff(
      {
        shipmentId,
        handoffIndex: 2,
        partyId: env.parties[2].id,
        locationLabel: env.parties[2].location,
        timestamp: '2026-11-23T12:00:00.000Z',
        scanHash: sha256Hex('SCAN-2'),
        previousHandoffCid: 'QmFakeCid111111111111111111111111111111111111',
      },
      { store: env.store, anchorer: env.anchorer, keypair: env.parties[2].keypair, tag: TAG },
    );

    const res = await verifyShipmentChain(shipmentId, env.store, env.testVerifier);
    assert.equal(res.valid, false);
    assert.ok(res.errors.some((e) => e.includes('does not match prior handoff CID')));
  } finally {
    env.node.restore();
  }
});

test('chain verification flags timestamp regression', async () => {
  const env = await createTestEnv();
  try {
    const shipmentId = 'SHP-TIME-REGRESS';
    const r0 = await recordHandoff(
      {
        shipmentId,
        handoffIndex: 0,
        partyId: env.parties[0].id,
        locationLabel: env.parties[0].location,
        timestamp: '2026-11-23T12:00:00.000Z',
        scanHash: sha256Hex('SCAN-0'),
        previousHandoffCid: null,
      },
      { store: env.store, anchorer: env.anchorer, keypair: env.parties[0].keypair, tag: TAG },
    );

    // Handoff 1 is earlier than Handoff 0
    const r1 = await recordHandoff(
      {
        shipmentId,
        handoffIndex: 1,
        partyId: env.parties[1].id,
        locationLabel: env.parties[1].location,
        timestamp: '2026-11-23T11:00:00.000Z',
        scanHash: sha256Hex('SCAN-1'),
        previousHandoffCid: r0.cid,
      },
      { store: env.store, anchorer: env.anchorer, keypair: env.parties[1].keypair, tag: TAG },
    );

    await recordHandoff(
      {
        shipmentId,
        handoffIndex: 2,
        partyId: env.parties[2].id,
        locationLabel: env.parties[2].location,
        timestamp: '2026-11-23T13:00:00.000Z',
        scanHash: sha256Hex('SCAN-2'),
        previousHandoffCid: r1.cid,
      },
      { store: env.store, anchorer: env.anchorer, keypair: env.parties[2].keypair, tag: TAG },
    );

    const res = await verifyShipmentChain(shipmentId, env.store, env.testVerifier);
    assert.equal(res.valid, false);
    assert.ok(res.errors.some((e) => e.includes('Timestamp regression')));
  } finally {
    env.node.restore();
  }
});

test('no party can sign for another: duplicate signer key across distinct parties is caught', async () => {
  const env = await createTestEnv();
  try {
    const shipmentId = 'SHP-SHARED-KEY';
    const r0 = await recordHandoff(
      {
        shipmentId,
        handoffIndex: 0,
        partyId: 'origin-warehouse',
        locationLabel: 'Austin Fab',
        timestamp: '2026-11-23T10:00:00.000Z',
        scanHash: sha256Hex('SCAN-0'),
        previousHandoffCid: null,
      },
      { store: env.store, anchorer: env.anchorer, keypair: env.parties[0].keypair, tag: TAG },
    );

    // Carrier tries to sign with Origin keypair
    const r1 = await recordHandoff(
      {
        shipmentId,
        handoffIndex: 1,
        partyId: 'freight-carrier',
        locationLabel: 'Chicago Hub',
        timestamp: '2026-11-23T11:00:00.000Z',
        scanHash: sha256Hex('SCAN-1'),
        previousHandoffCid: r0.cid,
      },
      { store: env.store, anchorer: env.anchorer, keypair: env.parties[0].keypair, tag: TAG },
    );

    await recordHandoff(
      {
        shipmentId,
        handoffIndex: 2,
        partyId: 'destination-store',
        locationLabel: 'Brooklyn Store',
        timestamp: '2026-11-23T12:00:00.000Z',
        scanHash: sha256Hex('SCAN-2'),
        previousHandoffCid: r1.cid,
      },
      { store: env.store, anchorer: env.anchorer, keypair: env.parties[2].keypair, tag: TAG },
    );

    const res = await verifyShipmentChain(shipmentId, env.store, env.testVerifier);
    assert.equal(res.valid, false);
    assert.ok(res.errors.some((e) => e.includes('Duplicate signer key')));
  } finally {
    env.node.restore();
  }
});

test('tampered record file fails hash recomputation', async () => {
  const env = await createTestEnv();
  try {
    const shipmentId = 'SHP-TAMPER';
    await runValidShipmentDemo(shipmentId, {
      store: env.store,
      anchorer: env.anchorer,
      tag: TAG,
      parties: env.parties,
    });

    // Tamper with handoff-2 on disk
    const handoffPath = join(env.dir, 'shipments', shipmentId, 'handoff-2.json');
    const data: CheckpointReceipt = JSON.parse(readFileSync(handoffPath, 'utf8'));
    data.record.locationLabel = 'Diverted to Unknown Warehouse';
    writeFileSync(handoffPath, JSON.stringify(data, null, 2), 'utf8');

    const res = await verifyShipmentChain(shipmentId, env.store, env.testVerifier);
    assert.equal(res.valid, false);
    assert.ok(res.errors.some((e) => e.includes('Tampered record: recomputed hash')));
  } finally {
    env.node.restore();
  }
});

test('refuses tags not starting with wave11- before anchoring', async () => {
  const env = await createTestEnv();
  try {
    await assert.rejects(
      recordHandoff(
        {
          shipmentId: 'SHP-INVALID-TAG',
          handoffIndex: 0,
          partyId: 'origin',
          locationLabel: 'Austin',
          timestamp: '2026-11-23T10:00:00.000Z',
          scanHash: sha256Hex('SCAN'),
          previousHandoffCid: null,
        },
        { store: env.store, anchorer: env.anchorer, keypair: env.parties[0].keypair, tag: 'invalid-tag' },
      ),
      /tag must start with 'wave11-'/,
    );
  } finally {
    env.node.restore();
  }
});

test('canonical JSON is deterministic regardless of key insertion order', () => {
  const obj1 = { z: 1, a: 2, m: { y: 'hello', b: 'world' } };
  const obj2 = { a: 2, m: { b: 'world', y: 'hello' }, z: 1 };
  assert.equal(canonicalJson(obj1), canonicalJson(obj2));
  assert.equal(
    canonicalJson(obj1),
    '{"a":2,"m":{"b":"world","y":"hello"},"z":1}',
  );
});
