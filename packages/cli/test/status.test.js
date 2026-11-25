/**
 * status command tests against local fixture servers (#114, #138).
 * #138: exit 1 when the agent is down or /health is not 2xx, --json, --timeout.
 */
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import http from 'node:http';
import path from 'node:path';
import { once } from 'node:events';
import { fileURLToPath } from 'node:url';
import test from 'node:test';

const cliRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const cli = path.join(cliRoot, 'bin/nirium.js');

function runStatus(url, ...extra) {
    return new Promise((resolve, reject) => {
        const proc = spawn(process.execPath, [cli, 'status', '--url', url, ...extra], {
            env: { ...process.env },
        });
        let stdout = '';
        let stderr = '';
        proc.stdout.on('data', (d) => { stdout += d.toString(); });
        proc.stderr.on('data', (d) => { stderr += d.toString(); });
        proc.on('close', (code) => {
            resolve({ code, stdout, stderr });
        });
        proc.on('error', reject);
    });
}

test('status prints service and omits undefined version/network for v3 agent', async () => {
    const server = http.createServer((req, res) => {
        if (req.url === '/health') {
            res.writeHead(200, { 'Content-Type': 'application/json' });
            res.end(JSON.stringify({
                status: 'online',
                service: 'nirium-agent-v3.0',
                uptime: 25923.04,
            }));
            return;
        }
        res.writeHead(404).end();
    });

    server.listen(0, '127.0.0.1');
    await once(server, 'listening');
    const { port } = server.address();

    try {
        const { code, stdout } = await runStatus(`http://127.0.0.1:${port}`);
        assert.equal(code, 0);
        assert.match(stdout, /Agent is operational/);
        assert.match(stdout, /Service:\s+nirium-agent-v3\.0/);
        assert.match(stdout, /Uptime:\s+25923\.04s/);
        assert.doesNotMatch(stdout, /Version:\s+undefined/);
        assert.doesNotMatch(stdout, /Network:\s+undefined/);
    } finally {
        server.close();
    }
});

test('status prints version and network when provided by agent', async () => {
    const server = http.createServer((req, res) => {
        if (req.url === '/health') {
            res.writeHead(200, { 'Content-Type': 'application/json' });
            res.end(JSON.stringify({
                status: 'online',
                version: '2.0.1',
                network: 'testnet',
                uptime: 100,
            }));
            return;
        }
        res.writeHead(404).end();
    });

    server.listen(0, '127.0.0.1');
    await once(server, 'listening');
    const { port } = server.address();

    try {
        const { code, stdout } = await runStatus(`http://127.0.0.1:${port}`);
        assert.equal(code, 0);
        assert.match(stdout, /Agent is operational/);
        assert.match(stdout, /Version:\s+2\.0\.1/);
        assert.match(stdout, /Network:\s+testnet/);
        assert.match(stdout, /Uptime:\s+100s/);
    } finally {
        server.close();
    }
});

test('status exits 0 for a healthy agent, as JSON too (#138)', async () => {
    const server = http.createServer((req, res) => {
        if (req.url === '/health') {
            res.writeHead(200, { 'Content-Type': 'application/json' });
            res.end(JSON.stringify({ status: 'online', service: 'nirium-agent-v3.0', uptime: 42 }));
            return;
        }
        res.writeHead(404).end();
    });
    server.listen(0, '127.0.0.1');
    await once(server, 'listening');
    const { port } = server.address();

    try {
        const { code, stdout } = await runStatus(`http://127.0.0.1:${port}`, '--json');
        assert.equal(code, 0);
        const report = JSON.parse(stdout);
        assert.equal(report.ok, true);
        assert.equal(report.status, 'online');
        assert.equal(report.uptime, 42);
    } finally {
        server.close();
    }
});

test('status exits 1 when /health is not 2xx (#138)', async () => {
    const server = http.createServer((req, res) => {
        if (req.url === '/health') {
            res.writeHead(503, { 'Content-Type': 'application/json' });
            res.end(JSON.stringify({ status: 'degraded' }));
            return;
        }
        res.writeHead(404).end();
    });
    server.listen(0, '127.0.0.1');
    await once(server, 'listening');
    const { port } = server.address();

    try {
        const { code, stdout } = await runStatus(`http://127.0.0.1:${port}`);
        assert.equal(code, 1);
        assert.match(stdout, /returned error/);
        assert.match(stdout, /503/);

        const jsonResult = await runStatus(`http://127.0.0.1:${port}`, '--json');
        assert.equal(jsonResult.code, 1);
        const report = JSON.parse(jsonResult.stdout);
        assert.equal(report.ok, false);
        assert.equal(report.status, 'degraded');
    } finally {
        server.close();
    }
});

test('status exits 1 when the agent is unreachable (#138)', async () => {
    const { code, stdout } = await runStatus('http://127.0.0.1:1');
    assert.equal(code, 1);
    assert.match(stdout, /unreachable/);
});

test('status exits 1 when the agent is unreachable, as JSON (#138)', async () => {
    const { code, stdout } = await runStatus('http://127.0.0.1:1', '--json');
    assert.equal(code, 1);
    const report = JSON.parse(stdout);
    assert.equal(report.ok, false);
    assert.match(report.error, /unreachable/);
});

test('--timeout bounds how long an unreachable host can hang (#138)', async () => {
    const server = http.createServer(() => { /* never responds */ });
    server.listen(0, '127.0.0.1');
    await once(server, 'listening');
    const { port } = server.address();

    try {
        const start = Date.now();
        const { code, stdout } = await runStatus(`http://127.0.0.1:${port}`, '--timeout', '300');
        const elapsed = Date.now() - start;
        assert.equal(code, 1);
        assert.match(stdout, /Timed out/);
        assert.ok(elapsed < 5000, `took ${elapsed}ms, should have given up around 300ms`);
    } finally {
        server.close();
    }
});

test('--timeout 0 and non-numeric values are rejected before any request', async () => {
    const zero = await runStatus('http://127.0.0.1:1', '--timeout', '0');
    assert.equal(zero.code, 1);
    assert.match(zero.stderr, /Invalid --timeout/);

    const nonNumeric = await runStatus('http://127.0.0.1:1', '--timeout', 'abc', '--json');
    assert.equal(nonNumeric.code, 1);
    const report = JSON.parse(nonNumeric.stdout);
    assert.equal(report.ok, false);
    assert.match(report.error, /Invalid --timeout/);
});