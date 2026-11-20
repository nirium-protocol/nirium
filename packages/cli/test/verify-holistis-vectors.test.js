// Test vectors by github.com/holistis, 2026-11-20
// (agent-receipt-verify, vectors/nirium-verify-audit-cid, Apache-2.0).
// Same 21 files the verify-audit-cid Action tests against, run here through
// the real `nirium verify --json` so the CLI and the Action cannot drift
// apart again. Found in his outside check of nirium-cli 3.2.5: vector 10
// (record set to null, hash and signature kept) passed in the CLI as a
// hash-only anchor while the Action rejected it.
//
// One difference is on purpose: for a hash-only document the Action reports
// hashMatch true (nothing to recompute), the CLI reports hashStatus
// "unchecked" and hashMatch false. Same decision, different report, so
// hashMatch is only compared in record mode.
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import fs from 'node:fs';
import http from 'node:http';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import test from 'node:test';

const here = path.dirname(fileURLToPath(import.meta.url));
const cli = path.resolve(here, '..', 'bin/nirium.js');
const dir = path.resolve(here, '..', '..', '..', 'actions/verify-audit-cid/test/vectors/holistis');
const files = fs.readdirSync(dir).filter((f) => f.endsWith('.json')).sort();
const vectors = new Map(files.map((f) => [f.replace(/\.json$/, ''), JSON.parse(fs.readFileSync(path.join(dir, f), 'utf8'))]));

let server;
let gateway;

test.before(async () => {
    server = http.createServer((req, res) => {
        const v = vectors.get(decodeURIComponent(req.url.replace(/^\/ipfs\//, '')));
        if (!v) {
            res.writeHead(404).end();
            return;
        }
        res.writeHead(200, { 'content-type': 'application/json' }).end(JSON.stringify(v.document));
    });
    await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
    gateway = `http://127.0.0.1:${server.address().port}`;
});

test.after(() => server.close());

function verify(name, ...extra) {
    return new Promise((resolve) => {
        const child = spawn(process.execPath, [cli, 'verify', name, '--gateway', gateway, '--retries', '0', '--json', ...extra], { stdio: ['ignore', 'pipe', 'pipe'] });
        let out = '';
        child.stdout.on('data', (d) => { out += d; });
        child.on('close', (code) => resolve({ code, result: JSON.parse(out) }));
    });
}

test('holistis vectors: all 21 cases are present', () => {
    assert.equal(files.length, 21);
});

test('holistis vectors: the CLI decides like the Action on every case', { concurrency: true }, async (t) => {
    await Promise.all([...vectors].map(([name, v]) => t.test(`${name} (${v.kind})`, async () => {
        const { code, result } = await verify(name);
        assert.equal(result.ok, v.expected.ok, `${name}: ok`);
        assert.equal(code, v.expected.ok ? 0 : 1, `${name}: exit code`);
        assert.equal(result.signatureStatus, v.expected.signatureStatus, `${name}: signatureStatus`);
        assert.equal(result.mode, v.expected.hashOnly ? 'hash-only' : 'record', `${name}: mode`);
        if (!v.expected.hashOnly) assert.equal(result.hashMatch, v.expected.hashMatch, `${name}: hashMatch`);
    })));
});

test('--require-signature rejects an unsigned record that otherwise passes on its hash', async () => {
    const { code, result } = await verify('17-record-agent-removed', '--require-signature');
    assert.equal(code, 1);
    assert.equal(result.ok, false);
    assert.equal(result.hashMatch, true);
    assert.equal(result.signatureStatus, 'absent');
    assert.match(result.error, /Signature required/);
});

test('--require-signature rejects a changed, re-hashed record with the signature dropped', async () => {
    const { code, result } = await verify('18-record-forged-and-rehashed-agent-removed', '--require-signature');
    assert.equal(code, 1);
    assert.equal(result.ok, false);
});

test('--require-signature still passes signed receipts, record and hash-only', async () => {
    for (const name of ['01-receipt-record-as-published', '02-receipt-hash-only-as-published']) {
        const { code, result } = await verify(name, '--require-signature');
        assert.equal(code, 0, name);
        assert.equal(result.ok, true, name);
        assert.equal(result.error, undefined, name);
    }
});
