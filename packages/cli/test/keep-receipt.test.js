/**
 * Keeping your own copy of a receipt: `nirium anchor --save <file>` and
 * `nirium cid <file>`. The fixtures are two real mainnet receipts, byte for
 * byte as the gateway serves them, so the CIDs below are the real ones.
 * A local HTTP server stands in for the Audit Trail node and the gateway.
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
const fixtures = path.join(cliRoot, 'test/fixtures/receipts');
const CID_RECORD = 'QmSSZdtt3dQ8BqUm62zrKQ85E4BUHYiVfvDgZmHfJsqU1U';
const CID_HASH_ONLY = 'QmS5q2NvZ2K2StLB3KCWRdkBtnZ5rHAJrQAez2PnKAPwTk';
const bytesOf = (cid) => fs.readFileSync(path.join(fixtures, `${cid}.json`));

let scenario = 'with-document';
const server = http.createServer((req, res) => {
    if (req.method === 'GET' && req.url.startsWith('/ipfs/')) {
        const cid = req.url.slice('/ipfs/'.length);
        const file = path.join(fixtures, `${cid}.json`);
        if (!/^Qm\w+$/.test(cid) || !fs.existsSync(file)) { res.writeHead(404).end(); return; }
        res.writeHead(200, { 'content-type': 'application/json' }).end(fs.readFileSync(file));
        return;
    }
    req.resume();
    req.on('end', () => {
        const base = `http://127.0.0.1:${server.address().port}`;
        const doc = JSON.parse(bytesOf(CID_RECORD).toString('utf8'));
        const body = {
            cid: CID_RECORD,
            gatewayUrl: `${base}/ipfs/${CID_RECORD}`,
            content_sha256: doc.content_sha256,
            anchoredAt: doc.anchoredAt,
        };
        if (scenario === 'with-document') body.document = doc;
        if (scenario === 'wrong-cid') { body.document = doc; body.cid = CID_HASH_ONLY; }
        res.writeHead(201, { 'content-type': 'application/json' }).end(JSON.stringify(body));
    });
});
server.listen(0, '127.0.0.1');
await once(server, 'listening');
const base = `http://127.0.0.1:${server.address().port}`;
test.after(() => new Promise((resolve) => server.close(() => resolve())));

function run(args) {
    return new Promise((resolve) => {
        const child = spawn(process.execPath, [cli, ...args], { stdio: ['ignore', 'pipe', 'pipe'] });
        let stdout = '';
        let stderr = '';
        child.stdout.on('data', (d) => { stdout += d; });
        child.stderr.on('data', (d) => { stderr += d; });
        child.on('close', (code) => resolve({ code, stdout, stderr }));
    });
}

const tmp = (name) => path.join(fs.mkdtempSync(path.join(os.tmpdir(), 'nirium-keep-')), name);
const HASH = 'ab44f8883af819f7496f2cef29eaea0651f6d97af78aa8088fd8ef4dc4b753c9';

test('cid recomputes the CID of real mainnet receipts', async () => {
    for (const cid of [CID_RECORD, CID_HASH_ONLY]) {
        const { code, stdout } = await run(['cid', path.join(fixtures, `${cid}.json`), '--expect', cid]);
        assert.equal(code, 0, stdout);
        assert.match(stdout, new RegExp(`CID: ${cid}`));
        assert.match(stdout, /MATCH/);
    }
});

test('cid exits 1 when the file is not the expected document', async () => {
    const { code, stdout } = await run(['cid', path.join(fixtures, `${CID_RECORD}.json`), '--expect', CID_HASH_ONLY]);
    assert.equal(code, 1);
    assert.match(stdout, /MISMATCH/);
});

test('cid notices a single changed byte', async () => {
    const file = tmp('changed.json');
    const bytes = Buffer.from(bytesOf(CID_RECORD));
    bytes[bytes.length - 2] ^= 1;
    fs.writeFileSync(file, bytes);
    const { code } = await run(['cid', file, '--expect', CID_RECORD]);
    assert.equal(code, 1);
});

test('anchor --save writes the returned document, byte for byte', async () => {
    scenario = 'with-document';
    const file = tmp('receipt.json');
    const { code, stdout } = await run(['anchor', '--hash', HASH, '--url', base, '--save', file]);
    assert.equal(code, 0, stdout);
    assert.deepEqual(fs.readFileSync(file), bytesOf(CID_RECORD));
    assert.match(stdout, /Saved copy:/);
    assert.match(stdout, /nirium cid .* --expect QmSSZdtt/);
});

test('anchor --save falls back to the gateway when the node returns no document', async () => {
    scenario = 'no-document';
    const file = tmp('receipt.json');
    const { code, stdout } = await run(['anchor', '--hash', HASH, '--url', base, '--save', file, '--json']);
    assert.equal(code, 0, stdout);
    const out = JSON.parse(stdout);
    assert.equal(out.saved.saved, true);
    assert.equal(out.saved.source, 'gateway');
    assert.deepEqual(fs.readFileSync(file), bytesOf(CID_RECORD));
});

test('anchor --save refuses a copy that does not give back the anchored CID', async () => {
    scenario = 'wrong-cid';
    const file = tmp('receipt.json');
    const { code, stdout } = await run(['anchor', '--hash', HASH, '--url', base, '--save', file]);
    assert.equal(code, 1);
    assert.equal(fs.existsSync(file), false);
    assert.match(stdout, /Not saved/);
});
