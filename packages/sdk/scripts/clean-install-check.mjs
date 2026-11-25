#!/usr/bin/env node
// Packs the SDK and installs the tarball into an empty temp project, then
// imports it the way a user would: ESM `import`, CJS `require`, and a
// TypeScript type-check against the shipped .d.ts. No network beyond npm.
//
// Catches the class of bug that tests from the source tree cannot see:
// 0.10.0 (`require()` inside ESM), 0.13.0 (ERR_MODULE_NOT_FOUND), and the
// undeclared dependency fixed in #68. See issue #107.
//
// Run from packages/sdk after `npm run build`:  node scripts/clean-install-check.mjs
import { execFileSync } from 'node:child_process';
import { mkdtempSync, writeFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';

const sdkDir = resolve(import.meta.dirname, '..');
const tmp = mkdtempSync(join(tmpdir(), 'nirium-clean-install-'));
const run = (cmd, args, cwd) =>
    execFileSync(cmd, args, { cwd, stdio: ['ignore', 'pipe', 'inherit'], encoding: 'utf8' });

try {
    // 1. Pack. --json lists every file that would be published.
    const [pack] = JSON.parse(run('npm', ['pack', '--json', '--pack-destination', tmp], sdkDir));
    const files = pack.files.map((f) => f.path);
    const tests = files.filter((p) => /\.test\./.test(p));
    if (tests.length) throw new Error(`tarball ships test files:\n  ${tests.join('\n  ')}`);
    for (const required of ['dist/index.js', 'dist/index.d.ts', 'package.json']) {
        if (!files.includes(required)) throw new Error(`tarball is missing ${required}`);
    }
    console.log(`packed ${pack.filename}: ${files.length} files, no *.test.* files`);

    // 2. Install into an empty project, outside the monorepo.
    const app = join(tmp, 'app');
    run('mkdir', ['-p', app]);
    writeFileSync(join(app, 'package.json'), JSON.stringify({ name: 'clean-install', private: true }));
    run('npm', ['install', '--no-audit', '--no-fund', '--legacy-peer-deps', join(tmp, pack.filename)], app);

    // 3. Use it. Dummy config only: initX402 builds the client locally and
    //    x402Serve defers every facilitator call to the first request.
    const body = (load) => `
${load}
const { Agent, x402Serve } = sdk;
if (typeof Agent !== 'function' || typeof x402Serve !== 'function') throw new Error('missing exports');
const agent = new Agent({ apiKey: 'nrm_dummy' });
agent.initX402({ secretKey: Keypair.random().secret(), network: 'stellar:testnet' });
const mw = x402Serve({
    payTo: Keypair.random().publicKey(),
    routes: { '/ping': '$0.01' },
    network: 'stellar:testnet',
    facilitatorApiKey: 'dummy',
});
if (typeof mw !== 'function') throw new Error('x402Serve did not return a middleware');
console.log('ok:', process.argv[1].split('/').pop());
`;
    writeFileSync(join(app, 'esm.mjs'), body(
        "import * as sdk from 'nirium';\nimport { Keypair } from '@stellar/stellar-sdk';"));
    writeFileSync(join(app, 'cjs.cjs'), body(
        "const sdk = require('nirium');\nconst { Keypair } = require('@stellar/stellar-sdk');"));
    writeFileSync(join(app, 'types.ts'), `
import Agent, { x402Serve, type X402Config, type X402ServeConfig } from 'nirium';
const cfg: X402Config = { secretKey: 'S...', network: 'stellar:testnet' };
const serve: X402ServeConfig = { payTo: 'G...', routes: { '/ping': '$0.01' } };
new Agent({ apiKey: 'x' }).initX402(cfg);
x402Serve(serve);
`);
    console.log(run('node', ['esm.mjs'], app).trim());
    console.log(run('node', ['cjs.cjs'], app).trim());
    run(join(sdkDir, 'node_modules', '.bin', 'tsc'), [
        '--noEmit', '--strict', '--skipLibCheck', '--module', 'nodenext',
        '--moduleResolution', 'nodenext', '--target', 'es2022', '--types', 'node',
        '--typeRoots', join(sdkDir, 'node_modules', '@types'), 'types.ts',
    ], app);
    console.log('ok: types.ts (tsc --noEmit against the shipped .d.ts)');
} finally {
    rmSync(tmp, { recursive: true, force: true });
}
