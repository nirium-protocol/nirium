/**
 * status command tests against local fixture servers.
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

function runStatus(url) {
    return new Promise((resolve, reject) => {
        const proc = spawn(process.execPath, [cli, 'status', '--url', url], {
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