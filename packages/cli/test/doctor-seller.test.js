/**
 * doctor --seller against a local fixture server. No real network, no payment.
 */
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import http from 'node:http';
import path from 'node:path';
import { once } from 'node:events';
import { fileURLToPath } from 'node:url';
import test from 'node:test';
import { Keypair, StrKey } from '@stellar/stellar-sdk';

const cli = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../bin/nirium.js');
const PAY_TO = Keypair.random().publicKey();
const CONTRACT = StrKey.encodeContract(Buffer.alloc(32, 7));
const CHECKS = [
    'challenge',
    'network',
    'asset',
    'amount',
    'payTo',
    'resource-url',
    'cors-preflight',
    'cors-expose',
    'cors-allow',
];

function paymentFor(scenario) {
    const doc = {
        x402Version: 2,
        error: 'Payment required',
        resource: {
            url: 'https://seller.example/premium',
            description: 'fixture',
            mimeType: 'application/json',
        },
        accepts: [{
            scheme: 'exact',
            network: 'stellar:pubnet',
            amount: '1000000',
            asset: CONTRACT,
            payTo: PAY_TO,
            maxTimeoutSeconds: 60,
        }],
    };
    if (scenario === 'http-resource') doc.resource.url = 'http://seller.example/premium';
    if (scenario === 'missing-fields') doc.accepts = [{ scheme: 'exact' }];
    if (scenario === 'secret-payto') doc.accepts[0].payTo = `S${'A'.repeat(55)}`;
    if (scenario === 'bad-network') doc.accepts[0].network = 'stellar:mainnet';
    if (scenario === 'bad-amount') doc.accepts[0].amount = '0';
    if (scenario === 'bad-asset') doc.accepts[0].asset = 'USDC';
    if (scenario === 'non-stellar') {
        doc.accepts[0].network = 'eip155:84532';
        doc.accepts[0].asset = '0x036CbD53842c5426634e7929541eC2318f3dCF7e';
        doc.accepts[0].payTo = '0x1111111111111111111111111111111111111111';
    }
    return doc;
}

function corsHeaders(scenario, includeExpose) {
    const headers = {
        'Access-Control-Allow-Origin': '*',
        'Access-Control-Allow-Methods': 'GET, OPTIONS',
    };
    if (scenario !== 'cors-no-allow') {
        headers['Access-Control-Allow-Headers'] = 'Content-Type, PAYMENT-SIGNATURE';
    }
    if (includeExpose && scenario !== 'cors-no-expose') {
        headers['Access-Control-Expose-Headers'] = 'PAYMENT-REQUIRED, PAYMENT-RESPONSE';
    }
    return headers;
}

const server = http.createServer((req, res) => {
    const url = new URL(req.url, 'http://127.0.0.1');
    const scenario = url.searchParams.get('case') || 'ok';
    if (req.headers['payment-signature'] || req.headers['x-payment']) {
        res.writeHead(599, { 'content-type': 'text/plain' });
        res.end('payment header is not allowed on a doctor probe');
        return;
    }
    if (req.method === 'OPTIONS') {
        if (scenario === 'cors-500') {
            res.writeHead(500, { 'content-type': 'text/plain' });
            res.end('preflight crashed');
            return;
        }
        res.writeHead(204, corsHeaders(scenario, false));
        res.end();
        return;
    }
    if (scenario === 'status-200') {
        res.writeHead(200, { 'content-type': 'application/json', ...corsHeaders(scenario, true) });
        res.end('{"ok":true}');
        return;
    }
    if (scenario === 'no-header') {
        res.writeHead(402, { 'content-type': 'application/json', ...corsHeaders(scenario, true) });
        res.end('{}');
        return;
    }
    const headers = {
        'content-type': 'application/json',
        ...corsHeaders(scenario, true),
    };
    if (scenario !== 'bad-header') {
        headers['PAYMENT-REQUIRED'] = Buffer.from(JSON.stringify(paymentFor(scenario)), 'utf8').toString('base64');
    } else {
        headers['PAYMENT-REQUIRED'] = '%%%not-a-challenge%%%';
    }
    res.writeHead(402, headers);
    res.end('{}');
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
            env: { ...process.env, NO_COLOR: '1' },
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

function sellerUrl(scenario) {
    return `${base}/premium?case=${scenario}`;
}

function byName(report) {
    return Object.fromEntries(report.checks.map((check) => [check.name, check]));
}

test('doctor --help documents --seller and does not probe the network', async () => {
    const result = await run(['doctor', '--help']);
    assert.equal(result.code, 0);
    assert.match(result.stdout, /--seller <url>/);
    assert.match(result.stdout, /without\s+paying/);
});

test('a healthy local seller passes every check, including --json', async () => {
    const url = sellerUrl('ok');
    const json = await run(['doctor', '--seller', url, '--json']);
    assert.equal(json.code, 0, json.stderr);
    const report = JSON.parse(json.stdout);
    assert.equal(report.ok, true);
    assert.equal(report.seller, url);
    assert.equal(report.network, 'stellar:pubnet');
    assert.deepEqual(report.checks.map((check) => check.name), CHECKS);
    for (const name of CHECKS) {
        assert.equal(byName(report)[name].status, 'pass', name);
    }

    const text = await run(['doctor', '--seller', url]);
    assert.equal(text.code, 0, text.stderr);
    assert.match(text.stdout, /remote x402 seller/);
    assert.match(text.stdout, /All checks passed/);
    assert.match(text.stdout, new RegExp(url.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')));
    assert.equal(text.stdout.includes('PAYMENT-SIGNATURE'), true);
});

test('http resource.url fails only that check', async () => {
    const result = await run(['doctor', '--seller', sellerUrl('http-resource'), '--json']);
    assert.equal(result.code, 1);
    const report = JSON.parse(result.stdout);
    const checks = byName(report);
    assert.equal(report.ok, false);
    assert.equal(checks['resource-url'].status, 'fail');
    assert.match(checks['resource-url'].message, /http:\/\//);
    assert.equal(checks.challenge.status, 'pass');
    assert.equal(checks.payTo.status, 'pass');
    assert.equal(checks['cors-preflight'].status, 'pass');
});

test('a 200 and a 402 without a decodable header fail the challenge', async () => {
    for (const scenario of ['status-200', 'no-header', 'bad-header']) {
        const result = await run(['doctor', '--seller', sellerUrl(scenario), '--json']);
        assert.equal(result.code, 1, scenario);
        const checks = byName(JSON.parse(result.stdout));
        assert.equal(checks.challenge.status, 'fail', scenario);
        assert.equal(checks.network.status, 'fail', scenario);
        assert.equal(checks['resource-url'].status, 'fail', scenario);
    }
});

test('missing or ill-formed accepts fields fail on their own', async () => {
    const missing = byName(JSON.parse((await run(['doctor', '--seller', sellerUrl('missing-fields'), '--json'])).stdout));
    for (const name of ['network', 'asset', 'amount', 'payTo']) {
        assert.equal(missing[name].status, 'fail', name);
    }
    assert.equal(missing.challenge.status, 'pass');

    const secret = byName(JSON.parse((await run(['doctor', '--seller', sellerUrl('secret-payto'), '--json'])).stdout));
    assert.equal(secret.payTo.status, 'fail');
    assert.match(secret.payTo.message, /secret key/);
    assert.doesNotMatch(secret.payTo.detail || '', /SAAAA/);

    const network = byName(JSON.parse((await run(['doctor', '--seller', sellerUrl('bad-network'), '--json'])).stdout));
    assert.equal(network.network.status, 'fail');
    assert.match(network.network.message, /stellar:mainnet/);

    const amount = byName(JSON.parse((await run(['doctor', '--seller', sellerUrl('bad-amount'), '--json'])).stdout));
    assert.equal(amount.amount.status, 'fail');

    const asset = byName(JSON.parse((await run(['doctor', '--seller', sellerUrl('bad-asset'), '--json'])).stdout));
    assert.equal(asset.asset.status, 'fail');
    assert.match(asset.asset.fix, /contract/);
});

test('a non-stellar CAIP-2 seller is accepted when its fields are present', async () => {
    const result = await run(['doctor', '--seller', sellerUrl('non-stellar'), '--json']);
    assert.equal(result.code, 0, result.stdout + result.stderr);
    const checks = byName(JSON.parse(result.stdout));
    assert.equal(checks.network.status, 'pass');
    assert.equal(checks.asset.status, 'pass');
    assert.equal(checks.payTo.status, 'pass');
});

test('a preflight 500 fails closed and does not hide the challenge', async () => {
    const text = await run(['doctor', '--seller', sellerUrl('cors-500')]);
    assert.equal(text.code, 1);
    assert.match(text.stdout, /CORS preflight returned HTTP 500/);
    assert.match(text.stdout, /✔ \[CHALLENGE\]/);
    assert.match(text.stdout, /❌ \[CORS-ALLOW\]/);

    const report = JSON.parse((await run(['doctor', '--seller', sellerUrl('cors-500'), '--json'])).stdout);
    const checks = byName(report);
    assert.equal(checks['cors-preflight'].status, 'fail');
    assert.equal(checks['cors-expose'].status, 'pass');
    assert.equal(checks.challenge.status, 'pass');
});

test('missing expose and allow headers fail independently', async () => {
    const expose = byName(JSON.parse((await run(['doctor', '--seller', sellerUrl('cors-no-expose'), '--json'])).stdout));
    assert.equal(expose['cors-expose'].status, 'fail');
    assert.match(expose['cors-expose'].fix, /Access-Control-Expose-Headers/);
    assert.equal(expose['cors-allow'].status, 'pass');
    assert.equal(expose['cors-preflight'].status, 'pass');

    const allow = byName(JSON.parse((await run(['doctor', '--seller', sellerUrl('cors-no-allow'), '--json'])).stdout));
    assert.equal(allow['cors-allow'].status, 'fail');
    assert.match(allow['cors-allow'].message, /PAYMENT-SIGNATURE/);
    assert.equal(allow['cors-expose'].status, 'pass');
    assert.equal(allow.challenge.status, 'pass');
});

test('an unreachable seller and a bad URL fail as JSON without paying', async () => {
    const down = await run(['doctor', '--seller', 'http://127.0.0.1:1/premium', '--json']);
    assert.equal(down.code, 1);
    const downReport = JSON.parse(down.stdout);
    assert.equal(downReport.ok, false);
    assert.equal(downReport.checks.length, CHECKS.length);
    assert.match(downReport.checks[0].message, /unreachable/);

    const bad = await run(['doctor', '--seller', 'not-a-url', '--json']);
    assert.equal(bad.code, 1);
    const badReport = JSON.parse(bad.stdout);
    assert.equal(badReport.ok, false);
    assert.match(badReport.checks[0].message, /absolute http/);
    assert.equal(bad.stderr, '');
});

test('doctor --seller without a URL is a usage error', async () => {
    const result = await run(['doctor', '--seller']);
    assert.notEqual(result.code, 0);
    assert.match(result.stderr, /seller/i);
});
