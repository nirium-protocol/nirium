/**
 * `config set secretKey` must never take the key as a command-line argument.
 * Every run uses its own temporary HOME, so ~/.niriumrc.json is never the real one.
 * The TTY hidden prompt is not covered here: node:test has no pseudo-terminal.
 */
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import test from 'node:test';
import { Keypair } from '@stellar/stellar-sdk';

const cliRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const cli = path.join(cliRoot, 'bin/nirium.js');

function run(args, { stdin } = {}) {
    const home = fs.mkdtempSync(path.join(os.tmpdir(), 'nirium-cli-home-'));
    const env = { ...process.env, HOME: home };
    delete env.NIRIUM_SECRET_KEY;
    return new Promise((resolve) => {
        const child = spawn(process.execPath, [cli, ...args], { env, stdio: ['pipe', 'pipe', 'pipe'] });
        let stdout = '';
        let stderr = '';
        child.stdout.on('data', (d) => { stdout += d; });
        child.stderr.on('data', (d) => { stderr += d; });
        child.stdin.end(stdin ?? '');
        child.on('close', (code) => {
            const file = path.join(home, '.niriumrc.json');
            const config = fs.existsSync(file) ? JSON.parse(fs.readFileSync(file, 'utf8')) : null;
            resolve({ code, stdout, stderr, config });
        });
    });
}

test('a secret passed as an argument is refused, exits 1, and is not saved', async () => {
    const secret = Keypair.random().secret();
    const r = await run(['config', 'set', 'secretKey', secret]);
    assert.equal(r.code, 1);
    assert.match(r.stderr, /shell history/);
    assert.match(r.stderr, /NOT saved/);
    assert.equal(r.config?.secretKey, undefined);
    assert.ok(!r.stdout.includes(secret) && !r.stderr.includes(secret), 'the key must not be echoed back');
});

test('without a TTY the secret is read from stdin and saved', async () => {
    const secret = Keypair.random().secret();
    const r = await run(['config', 'set', 'secretKey'], { stdin: `${secret}\n` });
    assert.equal(r.code, 0, r.stderr);
    assert.equal(r.config?.secretKey, secret);
    assert.ok(!r.stdout.includes(secret), 'the key must not be printed');
});

test('empty stdin exits 1 and saves nothing', async () => {
    const r = await run(['config', 'set', 'secretKey'], { stdin: '' });
    assert.equal(r.code, 1);
    assert.equal(r.config?.secretKey, undefined);
});

test('a value that is not a Stellar secret key exits 1 and saves nothing', async () => {
    const r = await run(['config', 'set', 'secretKey'], { stdin: 'not-a-key\n' });
    assert.equal(r.code, 1);
    assert.match(r.stderr, /not a valid Stellar secret key/);
    assert.equal(r.config?.secretKey, undefined);
});

test('non-secret keys still take their value as an argument', async () => {
    const r = await run(['config', 'set', 'network', 'stellar:pubnet']);
    assert.equal(r.code, 0, r.stderr);
    assert.equal(r.config?.network, 'stellar:pubnet');
});

test('facilitatorApiKey passed as an argument is refused, exits 1, and is not saved', async () => {
    const r = await run(['config', 'set', 'facilitatorApiKey', 'fk-test-123']);
    assert.equal(r.code, 1);
    assert.match(r.stderr, /shell history/);
    assert.equal(r.config?.facilitatorApiKey, undefined);
    assert.ok(!r.stderr.includes('fk-test-123'), 'the key must not be echoed back');
});

test('without a TTY facilitatorApiKey is read from stdin and saved', async () => {
    const r = await run(['config', 'set', 'facilitatorApiKey'], { stdin: 'fk-test-456\n' });
    assert.equal(r.code, 0, r.stderr);
    assert.equal(r.config?.facilitatorApiKey, 'fk-test-456');
    assert.ok(!r.stdout.includes('fk-test-456'), 'the key must not be printed');
});

test('empty stdin for facilitatorApiKey exits 1 and saves nothing', async () => {
    const r = await run(['config', 'set', 'facilitatorApiKey'], { stdin: '' });
    assert.equal(r.code, 1);
    assert.equal(r.config?.facilitatorApiKey, undefined);
});
