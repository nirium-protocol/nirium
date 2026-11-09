/**
 * `nirium report summary` and `nirium report export` (#136): against a
 * local HTTP server standing in for the Reporting node's
 * GET /api/reporting/summary and GET /api/reporting/export.
 */
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawn } from 'node:child_process';
import http from 'node:http';
import { once } from 'node:events';
import { fileURLToPath } from 'node:url';
import test from 'node:test';

const cliRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const cli = path.join(cliRoot, 'bin/nirium.js');

const DISCLAIMER = 'Institutional-format export generated from anchored receipts and on-chain records. '
    + 'This is not certified regulatory reporting; filings presented to any authority remain the sole responsibility of the client.';

const SUMMARY = {
    node: 'reporting',
    period: { from: null, to: null },
    network: 'all',
    payroll: { settledRuns: 2, recipientsPaid: 5, totalsByAsset: { USDC: '120.0000000' }, lastSettledAt: '2026-11-01T00:00:00.000Z' },
    payments: { count: 10, totalUsdc: '1.23', byGateway: { x402: { count: 8, totalUsdc: 1.0 }, mpp: { count: 2, totalUsdc: 0.23 } } },
    anchors: { count: 3, lastAnchoredAt: '2026-11-01T00:00:00.000Z' },
    generatedAt: '2026-11-08T00:00:00.000Z',
    disclaimer: DISCLAIMER,
};

const ANCHOR_ROWS = [
    // An older node may still send cid; the CLI must never print it.
    { anchored_at: '2026-11-01T00:00:00.000Z', source: 'AUDIT_NODE', cid: 'QmAnchorOne', network: 'testnet' },
    { anchored_at: '2026-10-31T00:00:00.000Z', source: 'AUDIT_NODE', network: 'mainnet' },
];

let lastRequest = null;
let scenario = 'ok';
const server = http.createServer((req, res) => {
    const u = new URL(req.url, 'http://localhost');
    lastRequest = { path: u.pathname, query: Object.fromEntries(u.searchParams) };

    if (scenario === 'unavailable') {
        res.writeHead(503, { 'content-type': 'application/json' });
        res.end(JSON.stringify({ error: 'export source unavailable: timeout' }));
        return;
    }
    if (scenario === 'bad-type') {
        res.writeHead(400, { 'content-type': 'application/json' });
        res.end(JSON.stringify({ error: '`type` must be one of: payroll | payments | anchors' }));
        return;
    }

    if (u.pathname === '/api/reporting/summary') {
        res.writeHead(200, { 'content-type': 'application/json' });
        res.end(JSON.stringify(SUMMARY));
        return;
    }
    if (u.pathname === '/api/reporting/export') {
        const type = u.searchParams.get('type');
        const format = u.searchParams.get('format') || 'csv';
        if (format === 'csv') {
            res.writeHead(200, { 'content-type': 'text/csv; charset=utf-8', 'content-disposition': `attachment; filename="nirium-${type}.csv"` });
            res.end('anchored_at,source,network\r\n2026-11-01T00:00:00.000Z,AUDIT_NODE,testnet\r\n');
            return;
        }
        res.writeHead(200, { 'content-type': 'application/json' });
        res.end(JSON.stringify({
            type,
            period: { from: null, to: null },
            network: 'all',
            rowCount: ANCHOR_ROWS.length,
            rows: ANCHOR_ROWS,
            generatedAt: '2026-11-08T00:00:00.000Z',
            disclaimer: DISCLAIMER,
        }));
        return;
    }
    res.writeHead(404).end();
});

server.listen(0, '127.0.0.1');
await once(server, 'listening');
const base = `http://127.0.0.1:${server.address().port}`;

test.after(() => new Promise((resolve, reject) => {
    server.close((err) => (err ? reject(err) : resolve()));
}));

test.beforeEach(() => { scenario = 'ok'; lastRequest = null; });

function run(args) {
    return new Promise((resolve, reject) => {
        const child = spawn(process.execPath, [cli, 'report', ...args], { stdio: ['ignore', 'pipe', 'pipe'] });
        let stdout = '';
        let stderr = '';
        const timer = setTimeout(() => { child.kill('SIGKILL'); reject(new Error('timed out')); }, 10_000);
        child.stdout.on('data', (d) => { stdout += d; });
        child.stderr.on('data', (d) => { stderr += d; });
        child.on('close', (code) => { clearTimeout(timer); resolve({ code, stdout, stderr }); });
        child.on('error', reject);
    });
}

// ─── summary ───────────────────────────────────────────────────

test('summary --json prints the raw response', async () => {
    const r = await run(['summary', '--url', base, '--json']);
    assert.equal(r.code, 0, r.stdout + r.stderr);
    assert.deepEqual(JSON.parse(r.stdout), SUMMARY);
});

test('summary human output reports payroll, payments, anchors, and the disclaimer', async () => {
    const r = await run(['summary', '--url', base]);
    assert.equal(r.code, 0, r.stdout + r.stderr);
    assert.match(r.stdout, /2 settled run\(s\), 5 recipient\(s\) paid/);
    assert.match(r.stdout, /USDC: 120\.0000000/);
    assert.match(r.stdout, /10 receipt\(s\), 1\.23 USDC total/);
    assert.match(r.stdout, /3 \(last: 2026-11-01\)/);
    assert.match(r.stdout, /not certified regulatory reporting/);
});

test('summary forwards --from/--to/--network as query params', async () => {
    const r = await run(['summary', '--url', base, '--from', '2026-01-01', '--to', '2026-02-01', '--network', 'testnet', '--json']);
    assert.equal(r.code, 0, r.stdout + r.stderr);
    assert.equal(lastRequest.query.from, '2026-01-01');
    assert.equal(lastRequest.query.to, '2026-02-01');
    assert.equal(lastRequest.query.network, 'testnet');
});

test('summary surfaces a server error as a failure', async () => {
    scenario = 'unavailable';
    const r = await run(['summary', '--url', base, '--json']);
    assert.equal(r.code, 1);
    const json = JSON.parse(r.stdout);
    assert.equal(json.ok, false);
    assert.match(json.error, /unavailable/);
});

// ─── export ────────────────────────────────────────────────────

test('export anchors prints one line per anchor (date and network), nothing else', async () => {
    const r = await run(['export', 'anchors', '--url', base]);
    assert.equal(r.code, 0, r.stdout + r.stderr);
    const lines = r.stdout.trim().split('\n');
    assert.deepEqual(lines, ['2026-11-01T00:00:00.000Z\ttestnet', '2026-10-31T00:00:00.000Z\tmainnet']);
});

test('export anchors footer (row count + disclaimer) goes to stderr, not stdout', async () => {
    const r = await run(['export', 'anchors', '--url', base]);
    assert.equal(r.code, 0, r.stdout + r.stderr);
    assert.doesNotMatch(r.stdout, /disclaimer|not certified/i);
    assert.match(r.stderr, /2 row\(s\)/);
    assert.match(r.stderr, /not certified regulatory reporting/);
});

test('export anchors never prints a CID, even if the node sends one', async () => {
    const r = await run(['export', 'anchors', '--url', base]);
    assert.equal(r.code, 0, r.stdout + r.stderr);
    assert.doesNotMatch(r.stdout + r.stderr, /Qm[A-Za-z0-9]{10,}/);
});

test('export payments/payroll print one JSON row per line (not just anchors)', async () => {
    const r = await run(['export', 'anchors', '--url', base, '--json']);
    assert.equal(r.code, 0, r.stdout + r.stderr);
    const json = JSON.parse(r.stdout);
    assert.equal(json.type, 'anchors');
    assert.equal(json.rows.length, 2);
});

test('export --json prints the full response, not just rows', async () => {
    const r = await run(['export', 'payments', '--url', base, '--json']);
    assert.equal(r.code, 0, r.stdout + r.stderr);
    const json = JSON.parse(r.stdout);
    assert.equal(json.rowCount, 2);
    assert.equal(json.disclaimer, DISCLAIMER);
});

test('export --csv writes the file, not stdout', async () => {
    const out = path.join(os.tmpdir(), `nirium-report-export-${process.pid}.csv`);
    try {
        const r = await run(['export', 'anchors', '--url', base, '--csv', out]);
        assert.equal(r.code, 0, r.stdout + r.stderr);
        assert.match(r.stdout, /Wrote/);
        const content = fs.readFileSync(out, 'utf8');
        assert.match(content, /anchored_at,source,network/);
        assert.doesNotMatch(content, /Qm[A-Za-z0-9]{10,}/);
    } finally {
        fs.rmSync(out, { force: true });
    }
});

test('export --csv and --json together is rejected', async () => {
    const r = await run(['export', 'anchors', '--url', base, '--csv', 'out.csv', '--json']);
    assert.equal(r.code, 1);
    const json = JSON.parse(r.stdout);
    assert.equal(json.ok, false);
    assert.match(json.error, /mutually exclusive/);
    assert.equal(lastRequest, null);
});

test('export rejects an invalid type before any network call', async () => {
    const r = await run(['export', 'invalid-type', '--url', base]);
    assert.equal(r.code, 1);
    assert.match(r.stderr, /must be one of: payroll \| payments \| anchors/);
    assert.equal(lastRequest, null);
});

test('export rejects a non-positive --limit before any network call', async () => {
    const r = await run(['export', 'anchors', '--url', base, '--limit', '0']);
    assert.equal(r.code, 1);
    assert.match(r.stderr, /Invalid --limit/);
    assert.equal(lastRequest, null);
});

test('export forwards --from/--to/--limit/--network as query params', async () => {
    const r = await run(['export', 'payroll', '--url', base, '--from', '2026-01-01', '--limit', '50', '--network', 'mainnet', '--json']);
    assert.equal(r.code, 0, r.stdout + r.stderr);
    assert.equal(lastRequest.query.type, 'payroll');
    assert.equal(lastRequest.query.from, '2026-01-01');
    assert.equal(lastRequest.query.limit, '50');
    assert.equal(lastRequest.query.network, 'mainnet');
});

test('export surfaces a server error (e.g. 503) as a failure, writes nothing', async () => {
    scenario = 'unavailable';
    const out = path.join(os.tmpdir(), `nirium-report-export-fail-${process.pid}.csv`);
    try {
        const r = await run(['export', 'anchors', '--url', base, '--csv', out]);
        assert.equal(r.code, 1);
        assert.match(r.stderr, /unavailable/);
        assert.equal(fs.existsSync(out), false);
    } finally {
        fs.rmSync(out, { force: true });
    }
});
