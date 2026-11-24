import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { test } from 'node:test';
import { Keypair } from '@stellar/stellar-sdk';
import { statementFor, type BatchFile } from '../src/batch.js';
import { checkBatch, niriumCliVerify } from '../src/check.js';
import { collectAndAnchorBatch, niriumAnchorer } from '../src/gateway.js';
import { SimulatedSensor } from '../src/sensor.js';
import { BatchStore } from '../src/store.js';

const TAG = 'wave11-iot-readings';

/** Replaces global fetch: records every request and simulates POST /api/audit/log offline. */
function mockAuditNode() {
    const calls: Array<{ url: string; body: string }> = [];
    const anchored = new Map<string, string>();
    const realFetch = globalThis.fetch;

    globalThis.fetch = (async (url: string | URL, init?: RequestInit) => {
        const body = String(init?.body ?? '');
        calls.push({ url: String(url), body });
        const parsed = JSON.parse(body) as { hash: string; agent?: { key: string } };
        const cid = 'Qm' + createHash('sha256').update(parsed.hash).digest('hex').slice(0, 44);
        anchored.set(cid, parsed.hash);
        return new Response(
            JSON.stringify({
                cid,
                content_sha256: parsed.hash,
                anchoredAt: '2026-11-22T19:00:00.000Z',
                attestedBy: parsed.agent?.key,
            }),
            { status: 200 },
        );
    }) as typeof fetch;

    return {
        calls,
        anchored,
        restore: () => {
            globalThis.fetch = realFetch;
        },
    };
}

async function runOfflineBatches() {
    const dir = mkdtempSync(join(tmpdir(), 'iot-readings-'));
    const store = new BatchStore(dir);
    const gatewayKp = Keypair.random();
    const sensors = [
        new SimulatedSensor('temp-bay-1', 'temperature_c', 'C'),
        new SimulatedSensor('humidity-bay-2', 'relative_humidity_pct', '%'),
        new SimulatedSensor('pressure-bay-3', 'barometric_hpa', 'hPa'),
    ];

    const node = mockAuditNode();
    try {
        const anchorer = niriumAnchorer('https://nirium-agent.example');
        const receipts = [];
        for (let b = 1; b <= 3; b++) {
            const batchId = `batch-00${b}`;
            const readings = [
                sensors[0].emitReading(`${batchId}-r1`, 21.5 + b, `2026-11-22T19:0${b}:00.000Z`),
                sensors[1].emitReading(`${batchId}-r2`, 49.0 + b, `2026-11-22T19:0${b}:01.000Z`),
                sensors[2].emitReading(`${batchId}-r3`, 1013.0 + b, `2026-11-22T19:0${b}:02.000Z`),
            ];
            receipts.push(
                await collectAndAnchorBatch({
                    batchId,
                    readings,
                    windowStart: `2026-11-22T19:0${b}:00.000Z`,
                    windowEnd: `2026-11-22T19:0${b}:05.000Z`,
                    store,
                    anchorer,
                    gatewayKeypair: gatewayKp,
                    tag: TAG,
                }),
            );
        }
        return { dir, store, gatewayKp, sensors, node, receipts };
    } finally {
        node.restore();
    }
}

test('multi-sensor batches anchor one hash-only receipt per batch with zero telemetry leakage', async () => {
    const { dir, store, gatewayKp, sensors, node, receipts } = await runOfflineBatches();
    try {
        assert.equal(new Set(sensors.map((s) => s.publicKey)).size, 3);
        assert.equal(receipts.length, 3);
        assert.equal(new Set(receipts.map((r) => r.cid)).size, 3);
        assert.equal(node.calls.length, 3);

        for (const r of receipts) {
            assert.equal(r.readingCount, 3);
            assert.equal(r.contributingSensors.length, 3);
            assert.equal(r.attestedBy, gatewayKp.publicKey());
            assert.ok(r.tag.startsWith('wave11-'));
            assert.equal(store.receipt(r.batchId).cid, r.cid);
        }

        for (const call of node.calls) {
            assert.ok(call.url.endsWith('/api/audit/log'));
            const payload = JSON.parse(call.body) as {
                hash: string;
                tag: string;
                agent: { key: string; signature: string; id: string };
            };
            assert.deepEqual(Object.keys(payload).sort(), ['agent', 'hash', 'tag']);
            assert.match(payload.hash, /^[0-9a-f]{64}$/);
            assert.ok(
                Keypair.fromPublicKey(payload.agent.key).verify(
                    Buffer.from(statementFor(payload.hash), 'utf8'),
                    Buffer.from(payload.agent.signature, 'base64'),
                ),
            );
            // Raw telemetry and sensor metadata must never appear in the anchored HTTP body
            for (const leaked of ['temp-bay-1', 'humidity-bay-2', 'temperature_c', '1014', '22.5']) {
                assert.equal(call.body.includes(leaked), false, `Request body leaked "${leaked}"`);
            }
        }
    } finally {
        rmSync(dir, { recursive: true, force: true });
    }
});

test('checkBatch verifies both sensor signatures and receipt, and names tampered reading on failure', async () => {
    const { dir, store, node, receipts } = await runOfflineBatches();
    try {
        const offlineVerify = (cid: string, sha256: string) => ({
            ok: node.anchored.get(cid) === sha256,
            output: node.anchored.get(cid) === sha256 ? 'VERIFICATION PASSED' : 'HASH MISMATCH',
        });

        // Untouched batches pass both layers
        for (const r of receipts) {
            const okRes = checkBatch(r.batchId, store, offlineVerify);
            assert.equal(okRes.ok, true);
            assert.equal(okRes.failedReadings.length, 0);
            assert.equal(okRes.contributorsMatch, true);
            assert.equal(okRes.receiptVerified, true);
        }

        // Tamper one reading inside batch-002
        const batchPath = store.batchPath('batch-002');
        const batch = JSON.parse(readFileSync(batchPath, 'utf8')) as BatchFile;
        batch.readings[1].reading.value = 99.9; // batch-002-r2 (humidity-bay-2)
        writeFileSync(batchPath, JSON.stringify(batch, null, 2) + '\n', 'utf8');

        const failRes = checkBatch('batch-002', store, offlineVerify);
        assert.equal(failRes.ok, false);
        assert.equal(failRes.receiptVerified, false);
        assert.equal(failRes.failedReadings.length, 1);
        assert.equal(failRes.failedReadings[0].readingId, 'batch-002-r2');
        assert.equal(failRes.failedReadings[0].sensorId, 'humidity-bay-2');
        assert.ok(
            failRes.failureReasons.some(
                (msg) => msg.includes('batch-002-r2') && msg.includes('humidity-bay-2'),
            ),
        );
    } finally {
        rmSync(dir, { recursive: true, force: true });
    }
});

test('refuses tags outside wave11- and exposes niriumCliVerify wrapper', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'iot-tag-'));
    try {
        const store = new BatchStore(dir);
        const sensor = new SimulatedSensor('temp-bay-1', 'temperature_c', 'C');
        await assert.rejects(
            collectAndAnchorBatch({
                batchId: 'batch-bad-tag',
                readings: [sensor.emitReading('r1', 20.1)],
                windowStart: '2026-11-22T19:00:00.000Z',
                windowEnd: '2026-11-22T19:05:00.000Z',
                store,
                anchorer: {
                    anchor: async () => {
                        throw new Error('Should not anchor invalid tag');
                    },
                },
                gatewayKeypair: Keypair.random(),
                tag: 'custom-tag',
            }),
            /wave11-/,
        );
        assert.equal(typeof niriumCliVerify, 'function');
    } finally {
        rmSync(dir, { recursive: true, force: true });
    }
});
