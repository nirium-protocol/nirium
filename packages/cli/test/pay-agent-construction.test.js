/**
 * `nirium pay` must get past constructing the Nirium agent and reach the
 * actual request. On a clean install `nirium` ships as CommonJS, so a
 * default import of it is the whole exports object, not the `Agent` class
 * (see #147). The fixture server below never sends a 402, so a correct
 * agent construction resolves the request without any Stellar network
 * access or a real key — same no-network, no-real-key constraint as the
 * other CLI tests.
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
const server = http.createServer((req, res) => {
    requestCount += 1;
    res.writeHead(200, { 'content-type': 'application/json' });
    res.end(JSON.stringify({ ok: true, path: req.url }));
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

test('pay gets past agent construction and completes the request against a local server', async () => {
    requestCount = 0;
    const result = await run(['pay', `${base}/five`, '--json']);
    assert.equal(result.code, 0, `stderr: ${result.stderr}\nstdout: ${result.stdout}`);
    assert.ok(!/is not a constructor/.test(result.stdout + result.stderr));
    const report = JSON.parse(result.stdout);
    assert.equal(report.status, 'success');
    assert.equal(report.statusCode, 200);
    assert.equal(report.data.ok, true);
    assert.equal(requestCount, 1);
});
