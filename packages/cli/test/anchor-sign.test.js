/**
 * `nirium anchor --sign` (#134): attaches an agent attestation signed
 * locally with a throwaway Keypair.random(). The fake "agent" server
 * here verifies the signature exactly like the real node does (ed25519
 * over `nirium-audit-v1:<content_sha256>`), so a genuinely bad
 * signature gets a real 400 - not a stub that always accepts.
 */
import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import path from 'node:path';
import { spawn } from 'node:child_process';
import http from 'node:http';
import { once } from 'node:events';
import { fileURLToPath } from 'node:url';
import test from 'node:test';
import { Keypair, StrKey } from '@stellar/stellar-sdk';

const cliRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const cli = path.join(cliRoot, 'bin/nirium.js');

function verifyAgentSignature(gAddress, statement, signatureB64) {
    try {
        const rawPubKey = Buffer.from(StrKey.decodeEd25519PublicKey(gAddress));
        const spkiHeader = Buffer.from('302a300506032b6570032100', 'hex');
        const keyObject = crypto.createPublicKey({
            key: Buffer.concat([spkiHeader, rawPubKey]),
            format: 'der',
            type: 'spki',
        });
        const sigBuf = Buffer.from(signatureB64, 'base64');
        if (sigBuf.length !== 64) return false;
        return crypto.verify(null, Buffer.from(statement, 'utf8'), keyObject, sigBuf);
    } catch {
        return false;
    }
}

let lastRequest = null;
let docsByCid = {};
let cidCounter = 0;
let forceSignatureReject = false;

const agentServer = http.createServer((req, res) => {
    let chunks = [];
    req.on('data', (d) => chunks.push(d));
    req.on('end', () => {
        let body;
        try { body = JSON.parse(Buffer.concat(chunks).toString('utf8') || '{}'); } catch { body = null; }
        lastRequest = body;

        const contentSha = body?.hash
            ? String(body.hash).toLowerCase().replace(/^sha-?256:/, '')
            : crypto.createHash('sha256').update(JSON.stringify(body?.record ?? {})).digest('hex');

        if (body?.agent) {
            const statement = `nirium-audit-v1:${contentSha}`;
            const valid = !forceSignatureReject && verifyAgentSignature(body.agent.key, statement, body.agent.signature);
            if (!valid) {
                res.writeHead(400, { 'content-type': 'application/json' });
                res.end(JSON.stringify({ error: 'agent attestation signature is invalid' }));
                return;
            }
        }

        cidCounter += 1;
        const cid = `QmFakeSignTest${cidCounter}`;
        const doc = {
            content_sha256: contentSha,
            anchoredAt: '2026-11-08T00:00:00.000Z',
            ...(body?.record !== undefined ? { record: body.record } : {}),
            ...(body?.agent ? { agent: { key: body.agent.key, signature: body.agent.signature } } : {}),
        };
        docsByCid[cid] = doc;

        res.writeHead(201, { 'content-type': 'application/json' });
        res.end(JSON.stringify({
            cid,
            gatewayUrl: `${gatewayBase}/ipfs/${cid}`,
            content_sha256: contentSha,
            ...(body?.agent ? { attestedBy: body.agent.key } : {}),
            anchoredAt: doc.anchoredAt,
        }));
    });
});

const gatewayServer = http.createServer((req, res) => {
    const cid = decodeURIComponent(req.url.replace(/^\/ipfs\//, ''));
    const doc = docsByCid[cid];
    if (!doc) { res.writeHead(404).end(); return; }
    res.writeHead(200, { 'content-type': 'application/json' }).end(JSON.stringify(doc));
});

let agentBase;
let gatewayBase;

test.before(async () => {
    agentServer.listen(0, '127.0.0.1');
    await once(agentServer, 'listening');
    agentBase = `http://127.0.0.1:${agentServer.address().port}`;

    gatewayServer.listen(0, '127.0.0.1');
    await once(gatewayServer, 'listening');
    gatewayBase = `http://127.0.0.1:${gatewayServer.address().port}`;
});

test.after(() => Promise.all([
    new Promise((resolve, reject) => agentServer.close((err) => (err ? reject(err) : resolve()))),
    new Promise((resolve, reject) => gatewayServer.close((err) => (err ? reject(err) : resolve()))),
]));

test.beforeEach(() => { lastRequest = null; docsByCid = {}; forceSignatureReject = false; });

function run(args, env = {}) {
    return new Promise((resolve, reject) => {
        const child = spawn(process.execPath, [cli, ...args], {
            env: { ...process.env, ...env },
            stdio: ['ignore', 'pipe', 'pipe'],
        });
        let stdout = '';
        let stderr = '';
        const timer = setTimeout(() => { child.kill('SIGKILL'); reject(new Error('timed out')); }, 10_000);
        child.stdout.on('data', (d) => { stdout += d; });
        child.stderr.on('data', (d) => { stderr += d; });
        child.on('close', (code) => { clearTimeout(timer); resolve({ code, stdout, stderr }); });
        child.on('error', reject);
    });
}

const HASH = 'a'.repeat(64);

test('round trip: --sign with --key-env, then `verify` reports SIGNATURE: VALID', async () => {
    const kp = Keypair.random();
    const anchorResult = await run(
        ['anchor', '--url', agentBase, '--hash', HASH, '--sign', '--key-env', 'TEST_SECRET', '--json'],
        { TEST_SECRET: kp.secret() },
    );
    assert.equal(anchorResult.code, 0, anchorResult.stdout + anchorResult.stderr);
    const anchored = JSON.parse(anchorResult.stdout);
    assert.equal(anchored.attestedBy, kp.publicKey());
    assert.equal(lastRequest.agent.key, kp.publicKey());

    const verifyResult = await run(['verify', anchored.cid, '--gateway', gatewayBase, '--json']);
    assert.equal(verifyResult.code, 0, verifyResult.stdout + verifyResult.stderr);
    const verified = JSON.parse(verifyResult.stdout);
    assert.equal(verified.signatureStatus, 'valid');
    assert.equal(verified.signerKey, kp.publicKey());
    assert.equal(verified.ok, true);
});

test('round trip works with --record too (statement hashes the record JSON, not the hash field)', async () => {
    const kp = Keypair.random();
    const anchorResult = await run(
        ['anchor', '--url', agentBase, '--record', '{"order":"A-12"}', '--sign', '--key-env', 'TEST_SECRET', '--json'],
        { TEST_SECRET: kp.secret() },
    );
    assert.equal(anchorResult.code, 0, anchorResult.stdout + anchorResult.stderr);
    const anchored = JSON.parse(anchorResult.stdout);

    const verifyResult = await run(['verify', anchored.cid, '--gateway', gatewayBase, '--json']);
    assert.equal(verifyResult.code, 0, verifyResult.stdout + verifyResult.stderr);
    const verified = JSON.parse(verifyResult.stdout);
    assert.equal(verified.signatureStatus, 'valid');
    assert.equal(verified.mode, 'record');
    assert.equal(verified.hashMatch, true);
});

test('a real bad signature (server rejects it) gets 400, nothing anchored', async () => {
    forceSignatureReject = true;
    const kp = Keypair.random();
    const r = await run(
        ['anchor', '--url', agentBase, '--hash', HASH, '--sign', '--key-env', 'TEST_SECRET', '--json'],
        { TEST_SECRET: kp.secret() },
    );
    assert.equal(r.code, 1);
    const json = JSON.parse(r.stdout);
    assert.equal(json.ok, false);
    assert.match(json.error, /invalid/);
    assert.equal(Object.keys(docsByCid).length, 0);
});

test('--sign with a malformed secret key fails locally, never reaches the network', async () => {
    const r = await run(
        ['anchor', '--url', agentBase, '--hash', HASH, '--sign', '--key-env', 'TEST_SECRET', '--json'],
        { TEST_SECRET: 'not-a-real-secret-key' },
    );
    assert.equal(r.code, 1);
    const json = JSON.parse(r.stdout);
    assert.equal(json.ok, false);
    assert.match(json.error, /invalid Stellar secret key/i);
    assert.equal(lastRequest, null);
});

test('--sign with --key-env pointing at an unset variable fails locally with a clear message', async () => {
    const r = await run(['anchor', '--url', agentBase, '--hash', HASH, '--sign', '--key-env', 'NIRIUM_TEST_DOES_NOT_EXIST', '--json']);
    assert.equal(r.code, 1);
    const json = JSON.parse(r.stdout);
    assert.equal(json.ok, false);
    assert.match(json.error, /NIRIUM_TEST_DOES_NOT_EXIST/);
    assert.equal(lastRequest, null);
});

test('--sign without --key-env and no secretKey in the config store fails with guidance, never reaches the network', async () => {
    const r = await run(['anchor', '--url', agentBase, '--hash', HASH, '--sign', '--json'], { HOME: '/nonexistent-home-dir-for-test' });
    assert.equal(r.code, 1);
    const json = JSON.parse(r.stdout);
    assert.equal(json.ok, false);
    assert.match(json.error, /config set secretKey/);
    assert.equal(lastRequest, null);
});

test('without --sign, the request body has no `agent` field at all (no behavior change)', async () => {
    const r = await run(['anchor', '--url', agentBase, '--hash', HASH, '--json']);
    assert.equal(r.code, 0, r.stdout + r.stderr);
    assert.equal(lastRequest.agent, undefined);
});
