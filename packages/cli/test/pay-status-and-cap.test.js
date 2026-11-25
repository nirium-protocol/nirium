/**
 * `nirium pay` (#148): --max-amount validation, and reporting a failed
 * response as a failure instead of a success. All against a local HTTP
 * server with a throwaway Keypair.random() key, no external network.
 *
 * Not covered here: actually triggering the --max-amount cap (a real
 * over-cap DENY). `agent.x402Fetch` only consults the policy hook inside
 * `ExactStellarScheme.createPaymentPayload`, which simulates the
 * transaction against Stellar RPC before the policy ever runs, so
 * exercising that path for real needs network access. See the PR for
 * why.
 */
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import http from 'node:http';
import path from 'node:path';
import { once } from 'node:events';
import { fileURLToPath } from 'node:url';
import test from 'node:test';
import { Keypair } from '@stellar/stellar-sdk';

const cliRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const cli = path.join(cliRoot, 'bin/nirium.js');
const SECRET_KEY = Keypair.random().secret();

let requestCount = 0;
let scenario = 'ok';
const server = http.createServer((req, res) => {
    requestCount += 1;
    if (scenario === '404') {
        res.writeHead(404, { 'content-type': 'application/json' });
        res.end(JSON.stringify({ error: 'not found' }));
        return;
    }
    if (scenario === '500') {
        res.writeHead(500, { 'content-type': 'application/json' });
        res.end(JSON.stringify({ error: 'boom' }));
        return;
    }
    res.writeHead(200, { 'content-type': 'application/json' });
    res.end(JSON.stringify({ ok: true }));
});

server.listen(0, '127.0.0.1');
await once(server, 'listening');
const base = `http://127.0.0.1:${server.address().port}`;

test.after(() => new Promise((resolve, reject) => {
    server.close((err) => (err ? reject(err) : resolve()));
}));

function run(args) {
    return new Promise((resolve, reject) => {
        const child = spawn(process.execPath, [cli, ...args], {
            env: { ...process.env, NIRIUM_SECRET_KEY: SECRET_KEY, NO_COLOR: '1' },
        });
        let stdout = '';
        let stderr = '';
        const timer = setTimeout(() => {
            child.kill('SIGKILL');
            reject(new Error(`timed out: nirium ${args.join(' ')}`));
        }, 20000);
        child.stdout.setEncoding('utf8');
        child.stderr.setEncoding('utf8');
        child.stdout.on('data', (chunk) => { stdout += chunk; });
        child.stderr.on('data', (chunk) => { stderr += chunk; });
        child.on('close', (code) => {
            clearTimeout(timer);
            resolve({ code, stdout, stderr });
        });
    });
}

test('--amount no longer exists', async () => {
    const r = await run(['pay', '--help']);
    assert.doesNotMatch(r.stdout, /--amount/);
    assert.match(r.stdout, /--max-amount/);
});

test('--max-amount 0 is rejected before any request is made', async () => {
    requestCount = 0;
    const r = await run(['pay', `${base}/x`, '--max-amount', '0']);
    assert.equal(r.code, 1);
    assert.match(r.stderr, /Invalid --max-amount/);
    assert.equal(requestCount, 0);
});

test('--max-amount -5 is rejected', async () => {
    const r = await run(['pay', `${base}/x`, '--max-amount', '-5']);
    assert.equal(r.code, 1);
    assert.match(r.stderr, /Invalid --max-amount/);
});

test('--max-amount abc is rejected, and as JSON', async () => {
    const r = await run(['pay', `${base}/x`, '--max-amount', 'abc', '--json']);
    assert.equal(r.code, 1);
    const report = JSON.parse(r.stdout);
    assert.equal(report.status, 'error');
    assert.match(report.error, /Invalid --max-amount/);
});

test('a valid --max-amount does not affect a normal successful payment', async () => {
    scenario = 'ok';
    const r = await run(['pay', `${base}/x`, '--max-amount', '$5', '--json']);
    assert.equal(r.code, 0, r.stdout + r.stderr);
    const report = JSON.parse(r.stdout);
    assert.equal(report.status, 'success');
    assert.equal(report.statusCode, 200);
});

test('a 404 after payment is reported as a failure, not a success (text)', async () => {
    scenario = '404';
    const r = await run(['pay', `${base}/x`]);
    assert.equal(r.code, 1);
    assert.doesNotMatch(r.stdout, /Request Completed/);
    assert.match(r.stdout, /Failed/);
    assert.match(r.stdout, /404/);
});

test('a 500 after payment is reported as a failure, as JSON', async () => {
    scenario = '500';
    const r = await run(['pay', `${base}/x`, '--json']);
    assert.equal(r.code, 1);
    const report = JSON.parse(r.stdout);
    assert.equal(report.status, 'failed');
    assert.equal(report.statusCode, 500);
});

test('a 200 after payment is still reported as success, exit 0 (text)', async () => {
    scenario = 'ok';
    const r = await run(['pay', `${base}/x`]);
    assert.equal(r.code, 0, r.stdout + r.stderr);
    assert.match(r.stdout, /Request Completed/);
});
