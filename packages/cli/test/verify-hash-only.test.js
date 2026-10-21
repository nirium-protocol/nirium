/**
 * `nirium verify` against hash-only and record audit documents (#139).
 * Each case serves a fixture from a local HTTP "gateway" and runs the real CLI.
 * Fixtures are generated with fixed throwaway seeds; mainnet-QmZDVSxE.json is a
 * copy of the real anchor QmZDVSxEfi3TLmcK1wLNydUHgGebfnTQ8i2EaEYfg2RUD6.
 */
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import fs from 'node:fs';
import http from 'node:http';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import test from 'node:test';

const cliRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const cli = path.join(cliRoot, 'bin/nirium.js');
const fixtures = path.join(cliRoot, 'test/fixtures/verify');
const HASH = 'f3889ed882a1ef2205d42c33d5940268263b100ee51b474cfb28c19a433a2565';
const MAINNET_HASH = '3f15aaabd2177199e01e442b67a573d7eef74ad259121768e0195049a75d7f0e';

let server;
let gateway;

test.before(async () => {
    server = http.createServer((req, res) => {
        const name = decodeURIComponent(req.url.replace(/^\/ipfs\//, ''));
        const file = path.join(fixtures, `${name}.json`);
        if (!/^[\w.-]+$/.test(name) || !fs.existsSync(file)) {
            res.writeHead(404).end();
            return;
        }
        res.writeHead(200, { 'content-type': 'application/json' }).end(fs.readFileSync(file));
    });
    await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
    gateway = `http://127.0.0.1:${server.address().port}`;
});

test.after(() => server.close());

function verify(fixture, ...extra) {
    return new Promise((resolve) => {
        const child = spawn(process.execPath, [cli, 'verify', fixture, '--gateway', gateway, '--json', ...extra], { stdio: ['ignore', 'pipe', 'pipe'] });
        let stdout = '';
        let stderr = '';
        child.stdout.on('data', (d) => { stdout += d; });
        child.stderr.on('data', (d) => { stderr += d; });
        child.on('close', (code) => {
            let json;
            try { json = JSON.parse(stdout); } catch { /* not JSON */ }
            resolve({ code, json, stdout, stderr });
        });
    });
}

test('hash-only, no --hash: hash unchecked, signature verified over content_sha256', async () => {
    const r = await verify('hash-only-base64');
    assert.equal(r.code, 0, r.stdout + r.stderr);
    assert.equal(r.json.mode, 'hash-only');
    assert.equal(r.json.hashStatus, 'unchecked');
    assert.equal(r.json.signatureStatus, 'valid');
    assert.equal(r.json.signatureScheme, 'ed25519');
    assert.equal(r.json.statement, `nirium-audit-v1:${HASH}`);
});

test('hash-only, --hash matches (prefix and uppercase accepted)', async () => {
    const r = await verify('hash-only-base64', '--hash', `sha-256:${HASH.toUpperCase()}`);
    assert.equal(r.code, 0, r.stdout + r.stderr);
    assert.equal(r.json.hashStatus, 'match');
    assert.equal(r.json.hashMatch, true);
});

test('hash-only, --evidence file matches', async () => {
    const r = await verify('hash-only-base64', '--evidence', path.join(fixtures, 'evidence.txt'));
    assert.equal(r.code, 0, r.stdout + r.stderr);
    assert.equal(r.json.hashStatus, 'match');
});

test('hash-only, --hash different from the anchor fails', async () => {
    const r = await verify('hash-only-base64', '--hash', 'a'.repeat(64));
    assert.equal(r.code, 1);
    assert.equal(r.json.hashStatus, 'mismatch');
});

test('hash-only, invalid --hash is refused', async () => {
    const r = await verify('hash-only-base64', '--hash', 'not-a-hash');
    assert.equal(r.code, 1);
    assert.match(r.stderr, /Invalid sha-256 hash/);
});

test('hash-only, hex signature is accepted', async () => {
    const r = await verify('hash-only-hex');
    assert.equal(r.code, 0, r.stdout + r.stderr);
    assert.equal(r.json.signatureStatus, 'valid');
});

test('hash-only, SEP-53 (Freighter signMessage) signature is accepted', async () => {
    const r = await verify('hash-only-sep53');
    assert.equal(r.code, 0, r.stdout + r.stderr);
    assert.equal(r.json.signatureStatus, 'valid');
    assert.equal(r.json.signatureScheme, 'sep53');
});

test('hash-only, signature from another key is invalid', async () => {
    const r = await verify('hash-only-other-key');
    assert.equal(r.code, 1);
    assert.equal(r.json.signatureStatus, 'invalid');
});

test('hash-only, tampered content_sha256 breaks the signature', async () => {
    const r = await verify('hash-only-tampered');
    assert.equal(r.code, 1);
    assert.equal(r.json.signatureStatus, 'invalid');
});

test('hash-only, unsigned: signature absent, still not a mismatch', async () => {
    const r = await verify('hash-only-unsigned', '--hash', HASH);
    assert.equal(r.code, 0, r.stdout + r.stderr);
    assert.equal(r.json.hashStatus, 'match');
    assert.equal(r.json.signatureStatus, 'absent');
});

test('record mode is unchanged: valid record passes', async () => {
    const r = await verify('record');
    assert.equal(r.code, 0, r.stdout + r.stderr);
    assert.equal(r.json.mode, 'record');
    assert.equal(r.json.hashStatus, 'match');
    assert.equal(r.json.signatureStatus, 'valid');
});

test('record mode: tampered record fails hash and signature', async () => {
    const r = await verify('record-tampered');
    assert.equal(r.code, 1);
    assert.equal(r.json.hashStatus, 'mismatch');
    assert.equal(r.json.signatureStatus, 'invalid');
});

test('real mainnet hash-only anchor QmZDVSxE… verifies', async () => {
    const r = await verify('mainnet-QmZDVSxE', '--hash', MAINNET_HASH);
    assert.equal(r.code, 0, r.stdout + r.stderr);
    assert.equal(r.json.hashStatus, 'match');
    assert.equal(r.json.signatureStatus, 'valid');
});

test('human output says NOT CHECKED, not MISMATCH, for hash-only without --hash', async () => {
    const r = await new Promise((resolve) => {
        const child = spawn(process.execPath, [cli, 'verify', 'hash-only-base64', '--gateway', gateway]);
        let out = '';
        child.stdout.on('data', (d) => { out += d; });
        child.on('close', (code) => resolve({ code, out }));
    });
    assert.equal(r.code, 0);
    assert.match(r.out, /NOT CHECKED/);
    assert.doesNotMatch(r.out, /MISMATCH/);
    assert.match(r.out, /VERIFICATION PASSED/);
});
