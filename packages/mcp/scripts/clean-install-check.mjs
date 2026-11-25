#!/usr/bin/env node
// Packs nirium-mcp and installs the tarball into an empty temp project, then
// starts the `nirium-mcp` bin the way an MCP client would and completes an
// MCP `initialize` over stdio. No network beyond npm: initialize answers
// locally, and no tool is called.
//
// 0.6.1 reached npm without dist/ because nothing checked the tarball before
// publishing. See issue #144. Modeled on packages/sdk/scripts/clean-install-check.mjs.
//
// Run from packages/mcp after `npm run build`:  node scripts/clean-install-check.mjs
import { execFileSync, spawn } from 'node:child_process';
import { mkdtempSync, writeFileSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';

const pkgDir = resolve(import.meta.dirname, '..');
const pkg = JSON.parse(readFileSync(join(pkgDir, 'package.json'), 'utf8'));
const tmp = mkdtempSync(join(tmpdir(), 'nirium-mcp-clean-install-'));
const run = (cmd, args, cwd) =>
    execFileSync(cmd, args, { cwd, stdio: ['ignore', 'pipe', 'inherit'], encoding: 'utf8' });

try {
    // 1. Pack. --json lists every file that would be published.
    const [pack] = JSON.parse(run('npm', ['pack', '--json', '--pack-destination', tmp], pkgDir));
    const files = pack.files.map((f) => f.path);
    const tests = files.filter((p) => /\.test\./.test(p));
    if (tests.length) throw new Error(`tarball ships test files:\n  ${tests.join('\n  ')}`);
    const bins = Object.values(pkg.bin ?? {}).map((p) => p.replace(/^\.\//, ''));
    if (!bins.length) throw new Error('package.json has no bin entry');
    for (const required of ['package.json', pkg.main, ...bins]) {
        if (!files.includes(required)) throw new Error(`tarball is missing ${required}`);
    }
    if (!files.some((p) => p.startsWith('dist/'))) throw new Error('tarball has no dist/');
    console.log(`packed ${pack.filename}: ${files.length} files, no *.test.* files`);

    // 2. Install into an empty project, outside the monorepo.
    //    --legacy-peer-deps: @stellar/mpp@0.7.1 peer-requires
    //    @stellar/stellar-sdk@^15.1.0 while nirium-mcp pins ^14 - the
    //    pre-existing mismatch tracked in #125, not fixed here.
    //    viem: TEMPORARY. mppx imports viem but declares it only as a required
    //    peer, so nothing installs it and the bin dies with ERR_MODULE_NOT_FOUND
    //    (#118, fix in PR #124, out of scope here). Installed by hand like the
    //    workaround in #118 says. Drop it once #124 lands so this check covers it.
    const app = join(tmp, 'app');
    run('mkdir', ['-p', app]);
    writeFileSync(join(app, 'package.json'), JSON.stringify({ name: 'clean-install', private: true }));
    run('npm', ['install', '--no-audit', '--no-fund', '--legacy-peer-deps', join(tmp, pack.filename), 'viem@^2.51.0'], app);

    // 3. Start the installed bin and complete an MCP initialize over stdio.
    const binName = Object.keys(pkg.bin)[0];
    const result = await new Promise((done, fail) => {
        const child = spawn(join(app, 'node_modules', '.bin', binName), [], {
            cwd: app, stdio: ['pipe', 'pipe', 'pipe'],
            // No secret key: paid tools stay off. Nothing here calls the agent API.
            env: { PATH: process.env.PATH, HOME: process.env.HOME },
        });
        let out = '', err = '';
        const timer = setTimeout(() => { child.kill('SIGKILL'); fail(new Error(`no initialize response in 20s\n${err}`)); }, 20_000);
        child.stderr.on('data', (d) => { err += d; });
        child.stdout.on('data', (d) => {
            out += d;
            const line = out.split('\n').find((l) => l.includes('"id":1'));
            if (!line) return;
            clearTimeout(timer);
            child.stdin.end(); // client goes away: the server must exit on its own
            child.on('exit', (code, signal) => done({ msg: JSON.parse(line), code, signal, err }));
        });
        child.on('error', (e) => { clearTimeout(timer); fail(e); });
        child.on('exit', (code) => { if (!out.includes('"id":1')) { clearTimeout(timer); fail(new Error(`bin exited (${code}) before answering initialize\n${err}`)); } });
        child.stdin.write(JSON.stringify({
            jsonrpc: '2.0', id: 1, method: 'initialize',
            params: { protocolVersion: '2025-06-18', capabilities: {}, clientInfo: { name: 'clean-install-check', version: '0' } },
        }) + '\n');
    });
    const info = result.msg.result?.serverInfo;
    if (!info) throw new Error(`initialize failed: ${JSON.stringify(result.msg)}`);
    if (info.version !== pkg.version) throw new Error(`serverInfo.version ${info.version} != package.json ${pkg.version}`);
    if (result.code !== 0) throw new Error(`bin exited with ${result.code ?? result.signal} after stdin closed\n${result.err}`);
    console.log(`ok: ${binName} answered initialize as ${info.name} ${info.version} and exited 0`);
} finally {
    rmSync(tmp, { recursive: true, force: true });
}
