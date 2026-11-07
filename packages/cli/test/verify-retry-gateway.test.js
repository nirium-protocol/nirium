/**
 * `nirium verify --gateway` (repeatable, fallback) and `--retries`/
 * `--timeout` (#135): a 404 is retried on the SAME gateway (content may
 * just not be propagated there yet); any other failure moves straight
 * to the next gateway. Everything runs against local HTTP servers, no
 * real network and no real delay (--retries kept small to keep the
 * fixed 300ms backoff from adding up).
 */
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import http from 'node:http';
import { once } from 'node:events';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import test from 'node:test';

const cliRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const cli = path.join(cliRoot, 'bin/nirium.js');

const CID = 'QmRetryTestFixture';
const HASH = 'b'.repeat(64);
const DOC = { content_sha256: HASH };

function makeGateway() {
    const state = { requests: [], mode: 'always-404' };
    const server = http.createServer((req, res) => {
        state.requests.push(req.url);
        if (state.mode === 'always-404') {
            res.writeHead(404).end();
            return;
        }
        if (state.mode === 'fail-once-then-ok') {
            if (state.requests.length === 1) { res.writeHead(404).end(); return; }
            res.writeHead(200, { 'content-type': 'application/json' }).end(JSON.stringify(DOC));
            return;
        }
        if (state.mode === '500') {
            res.writeHead(500).end();
            return;
        }
        res.writeHead(200, { 'content-type': 'application/json' }).end(JSON.stringify(DOC));
    });
    return { server, state };
}

const gatewayA = makeGateway();
const gatewayB = makeGateway();

let baseA;
let baseB;

test.before(async () => {
    gatewayA.server.listen(0, '127.0.0.1');
    await once(gatewayA.server, 'listening');
    baseA = `http://127.0.0.1:${gatewayA.server.address().port}`;

    gatewayB.server.listen(0, '127.0.0.1');
    await once(gatewayB.server, 'listening');
    baseB = `http://127.0.0.1:${gatewayB.server.address().port}`;
});

test.after(() => Promise.all([
    new Promise((resolve, reject) => gatewayA.server.close((err) => (err ? reject(err) : resolve()))),
    new Promise((resolve, reject) => gatewayB.server.close((err) => (err ? reject(err) : resolve()))),
]));

test.beforeEach(() => {
    gatewayA.state.requests = [];
    gatewayA.state.mode = 'always-404';
    gatewayB.state.requests = [];
    gatewayB.state.mode = 'always-404';
});

function run(args) {
    return new Promise((resolve, reject) => {
        const child = spawn(process.execPath, [cli, 'verify', CID, '--json', ...args], { stdio: ['ignore', 'pipe', 'pipe'] });
        let stdout = '';
        let stderr = '';
        const timer = setTimeout(() => { child.kill('SIGKILL'); reject(new Error('timed out')); }, 15_000);
        child.stdout.on('data', (d) => { stdout += d; });
        child.stderr.on('data', (d) => { stderr += d; });
        child.on('close', (code) => { clearTimeout(timer); resolve({ code, stdout, stderr }); });
        child.on('error', reject);
    });
}

test('404-then-200 on retry: same gateway recovers, no fallback needed', async () => {
    gatewayA.state.mode = 'fail-once-then-ok';
    const r = await run(['--gateway', baseA, '--retries', '2', '--hash', HASH]);
    assert.equal(r.code, 0, r.stdout + r.stderr);
    const json = JSON.parse(r.stdout);
    assert.equal(json.ok, true);
    assert.equal(json.gateway, baseA);
    assert.equal(gatewayA.state.requests.length, 2); // first 404, second succeeds
});

test('one gateway down (always 404), second gateway alive: falls back and succeeds', async () => {
    gatewayB.state.mode = 'ok';
    const r = await run(['--gateway', baseA, '--gateway', baseB, '--retries', '1', '--hash', HASH]);
    assert.equal(r.code, 0, r.stdout + r.stderr);
    const json = JSON.parse(r.stdout);
    assert.equal(json.ok, true);
    assert.equal(json.gateway, baseB);
    assert.equal(gatewayA.state.requests.length, 2); // 1 + 1 retry, both 404
    assert.equal(gatewayB.state.requests.length, 1); // succeeds on the first try
});

test('all gateways down (404 everywhere): reported as not-yet-available, not a hash mismatch', async () => {
    const r = await run(['--gateway', baseA, '--gateway', baseB, '--retries', '1']);
    assert.equal(r.code, 1);
    const json = JSON.parse(r.stdout);
    assert.equal(json.ok, false);
    assert.equal(json.availability, 'not_yet_available');
    assert.equal(json.hashStatus, undefined);
    assert.match(json.error, /not found/i);
    assert.equal(gatewayA.state.requests.length, 2);
    assert.equal(gatewayB.state.requests.length, 2);
});

test('a non-404 error (500) on the first gateway moves straight to the next, no retries wasted on it', async () => {
    gatewayA.state.mode = '500';
    gatewayB.state.mode = 'ok';
    const r = await run(['--gateway', baseA, '--gateway', baseB, '--retries', '3', '--hash', HASH]);
    assert.equal(r.code, 0, r.stdout + r.stderr);
    const json = JSON.parse(r.stdout);
    assert.equal(json.ok, true);
    assert.equal(json.gateway, baseB);
    assert.equal(gatewayA.state.requests.length, 1); // no retries spent on a real error
});

test('mixed failures (one 500, one 404) report gateway_error, not not_yet_available', async () => {
    gatewayA.state.mode = '500';
    const r = await run(['--gateway', baseA, '--gateway', baseB, '--retries', '1']);
    assert.equal(r.code, 1);
    const json = JSON.parse(r.stdout);
    assert.equal(json.availability, 'gateway_error');
});

test('human output distinguishes NOT YET AVAILABLE from a hash mismatch', async () => {
    const r = await new Promise((resolve, reject) => {
        const child = spawn(process.execPath, [cli, 'verify', CID, '--gateway', baseA, '--retries', '0'], { stdio: ['ignore', 'pipe', 'pipe'] });
        let stdout = '';
        const timer = setTimeout(() => { child.kill('SIGKILL'); reject(new Error('timed out')); }, 10_000);
        child.stdout.on('data', (d) => { stdout += d; });
        child.on('close', (code) => { clearTimeout(timer); resolve({ code, stdout }); });
    });
    assert.equal(r.code, 1);
    assert.match(r.stdout, /NOT YET AVAILABLE/);
    assert.doesNotMatch(r.stdout, /MISMATCH/);
});


test('--retries rejects a negative value', async () => {
    const r = await run(['--gateway', baseA, '--retries', '-1']);
    assert.equal(r.code, 1);
    assert.match(r.stderr, /Invalid --retries/);
});

test('--timeout rejects a non-positive value', async () => {
    const r = await run(['--gateway', baseA, '--timeout', '0']);
    assert.equal(r.code, 1);
    assert.match(r.stderr, /Invalid --timeout/);
});
