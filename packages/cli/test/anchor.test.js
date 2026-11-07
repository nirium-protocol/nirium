/**
 * `nirium anchor` (#133): --file / --hash / --record against a local
 * HTTP server standing in for the Audit Trail node's POST /api/audit/log.
 * No real network, no real IPFS pin.
 */
import assert from 'node:assert/strict';
import crypto from 'node:crypto';
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

let lastRequest = null;
let scenario = 'ok';
const server = http.createServer((req, res) => {
    let chunks = [];
    req.on('data', (d) => chunks.push(d));
    req.on('end', () => {
        let body;
        try { body = JSON.parse(Buffer.concat(chunks).toString('utf8') || '{}'); } catch { body = null; }
        lastRequest = { method: req.method, url: req.url, body };

        if (scenario === 'bad-request') {
            res.writeHead(400, { 'content-type': 'application/json' });
            res.end(JSON.stringify({ error: '`hash` must be a 64-char sha-256 hex, optionally prefixed "sha-256:"' }));
            return;
        }
        if (scenario === 'unavailable') {
            res.writeHead(503, { 'content-type': 'application/json' });
            res.end(JSON.stringify({ error: 'anchoring temporarily unavailable - try again shortly' }));
            return;
        }
        const contentSha = body?.hash
            ? String(body.hash).toLowerCase().replace(/^sha-?256:/, '')
            : crypto.createHash('sha256').update(JSON.stringify(body?.record ?? {})).digest('hex');
        res.writeHead(201, { 'content-type': 'application/json' });
        res.end(JSON.stringify({
            cid: 'QmFakeCidForTests1234567890',
            gatewayUrl: 'https://gateway.pinata.cloud/ipfs/QmFakeCidForTests1234567890',
            content_sha256: contentSha,
            anchoredAt: '2026-11-08T00:00:00.000Z',
            verify: 'fetch the gatewayUrl and recompute sha-256 over your original evidence',
        }));
    });
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
        const child = spawn(process.execPath, [cli, 'anchor', '--url', base, ...args], { stdio: ['ignore', 'pipe', 'pipe'] });
        let stdout = '';
        let stderr = '';
        const timer = setTimeout(() => { child.kill('SIGKILL'); reject(new Error('timed out')); }, 10_000);
        child.stdout.on('data', (d) => { stdout += d; });
        child.stderr.on('data', (d) => { stderr += d; });
        child.on('close', (code) => { clearTimeout(timer); resolve({ code, stdout, stderr }); });
        child.on('error', reject);
    });
}

const HASH = 'f'.repeat(64);

test('--hash anchors the raw hash, no network re-validation of format beyond the server', async () => {
    const r = await run(['--hash', HASH, '--json']);
    assert.equal(r.code, 0, r.stdout + r.stderr);
    const json = JSON.parse(r.stdout);
    assert.equal(json.ok, true);
    assert.equal(json.cid, 'QmFakeCidForTests1234567890');
    assert.equal(json.content_sha256, HASH);
    assert.equal(lastRequest.body.hash, HASH);
    assert.equal(lastRequest.body.record, undefined);
});

test('--hash accepts the sha-256: prefix and uppercase, normalized before sending', async () => {
    const r = await run(['--hash', `sha-256:${HASH.toUpperCase()}`, '--json']);
    assert.equal(r.code, 0, r.stdout + r.stderr);
    assert.equal(lastRequest.body.hash, HASH);
});

test('invalid --hash is refused locally, never reaches the network', async () => {
    const r = await run(['--hash', 'not-a-hash']);
    assert.equal(r.code, 1);
    assert.match(r.stderr, /Invalid sha-256 hash/);
    assert.equal(lastRequest, null);
});

test('--file computes sha-256 locally and sends only the hash, never the file content', async () => {
    const file = path.join(os.tmpdir(), `nirium-anchor-test-${process.pid}.txt`);
    fs.writeFileSync(file, 'evidence contents\n');
    const expected = crypto.createHash('sha256').update(fs.readFileSync(file)).digest('hex');
    try {
        const r = await run(['--file', file, '--json']);
        assert.equal(r.code, 0, r.stdout + r.stderr);
        assert.equal(lastRequest.body.hash, expected);
        assert.equal(JSON.stringify(lastRequest.body).includes('evidence contents'), false);
    } finally {
        fs.rmSync(file, { force: true });
    }
});

test('missing --file is reported clearly, never reaches the network', async () => {
    const r = await run(['--file', '/nonexistent/path/evidence.json']);
    assert.equal(r.code, 1);
    assert.match(r.stderr, /Could not read --file/);
    assert.equal(lastRequest, null);
});

test('--record sends the object verbatim', async () => {
    const r = await run(['--record', '{"order":"A-12"}', '--json']);
    assert.equal(r.code, 0, r.stdout + r.stderr);
    assert.deepEqual(lastRequest.body.record, { order: 'A-12' });
    assert.equal(lastRequest.body.hash, undefined);
});

test('invalid JSON in --record is refused locally', async () => {
    const r = await run(['--record', 'not json']);
    assert.equal(r.code, 1);
    assert.match(r.stderr, /not valid JSON/);
    assert.equal(lastRequest, null);
});

test('--record over 8KB is refused locally, mirroring the server limit', async () => {
    const big = JSON.stringify({ blob: 'x'.repeat(9000) });
    const r = await run(['--record', big]);
    assert.equal(r.code, 1);
    assert.match(r.stderr, /exceeds 8KB/);
    assert.equal(lastRequest, null);
});

test('--record that is a JSON array is rejected (must be an object)', async () => {
    const r = await run(['--record', '[1,2,3]']);
    assert.equal(r.code, 1);
    assert.match(r.stderr, /must be a JSON object/);
});

test('exactly one of --file/--hash/--record is required - none given', async () => {
    const r = await run([]);
    assert.equal(r.code, 1);
    assert.match(r.stderr, /exactly one of --file, --hash, or --record/);
});

test('exactly one of --file/--hash/--record is required - two given', async () => {
    const r = await run(['--hash', HASH, '--record', '{}']);
    assert.equal(r.code, 1);
    assert.match(r.stderr, /were both given/);
    assert.equal(lastRequest, null);
});

test('--tx and --tag are forwarded in the request body', async () => {
    const r = await run(['--hash', HASH, '--tx', 'abc123', '--tag', 'order-A-12', '--json']);
    assert.equal(r.code, 0, r.stdout + r.stderr);
    assert.equal(lastRequest.body.txHash, 'abc123');
    assert.equal(lastRequest.body.tag, 'order-A-12');
});

test('--network is never a flag this command accepts - the node decides', async () => {
    const r = await run(['--hash', HASH, '--network', 'testnet']);
    assert.equal(r.code, 1);
    assert.match(r.stderr, /unknown option/i);
});

test('a 400 from the server is reported as a failure, nothing anchored', async () => {
    scenario = 'bad-request';
    const r = await run(['--hash', HASH]);
    assert.equal(r.code, 1);
    assert.match(r.stderr, /64-char sha-256 hex/);
});

test('human output prints the CID, hash, gateway URL, and a verify suggestion', async () => {
    const r = await run(['--hash', HASH]);
    assert.equal(r.code, 0, r.stdout + r.stderr);
    assert.match(r.stdout, /CID:\s+QmFakeCidForTests1234567890/);
    assert.match(r.stdout, /Content sha256:\s+f{64}/);
    assert.match(r.stdout, /Gateway URL:/);
    assert.match(r.stdout, /nirium verify QmFakeCidForTests1234567890/);
});

test('a 503 (temporarily unavailable) is a failure, not swallowed', async () => {
    scenario = 'unavailable';
    const r = await run(['--hash', HASH, '--json']);
    assert.equal(r.code, 1);
    const json = JSON.parse(r.stdout);
    assert.equal(json.ok, false);
    assert.match(json.error, /temporarily unavailable/);
});

test('agent unreachable is reported as a failure, not a hang', async () => {
    const r = await new Promise((resolve, reject) => {
        const child = spawn(process.execPath, [cli, 'anchor', '--url', 'http://127.0.0.1:1', '--hash', HASH, '--json'], { stdio: ['ignore', 'pipe', 'pipe'] });
        let stdout = '';
        const timer = setTimeout(() => { child.kill('SIGKILL'); reject(new Error('timed out')); }, 10_000);
        child.stdout.on('data', (d) => { stdout += d; });
        child.on('close', (code) => { clearTimeout(timer); resolve({ code, stdout }); });
    });
    assert.equal(r.code, 1);
    const json = JSON.parse(r.stdout);
    assert.equal(json.ok, false);
    assert.match(json.error, /unreachable/);
});
