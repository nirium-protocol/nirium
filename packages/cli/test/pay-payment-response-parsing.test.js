/**
 * `nirium pay` printed the PAYMENT-RESPONSE header itself as the tx hash
 * whenever it wasn't a bare `{...}` JSON string. In x402 v2 that header is
 * a JSON object base64-encoded onto the header, and the real tx hash field
 * is `transaction`, not `txHash`/`transactionHash`/`hash` — none of the old
 * guessed field names ever matched the real response shape, so this went
 * unnoticed until someone clicked the printed Explorer link and got a 404.
 *
 * `parsePaymentResponse` is a pure function inside bin/nirium.js (not
 * exported — the CLI has no module surface), so it's loaded here straight
 * from the real source with a small extractor instead of being
 * reimplemented, which would let this test drift from the actual code.
 */
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import test from 'node:test';

const cliRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const cliSource = fs.readFileSync(path.join(cliRoot, 'bin/nirium.js'), 'utf8');

const match = cliSource.match(/function parsePaymentResponse\(raw\) \{[\s\S]*?\n\}\n/);
assert.ok(match, 'parsePaymentResponse not found in bin/nirium.js — did it get renamed or inlined?');
// eslint-disable-next-line no-new-func
const parsePaymentResponse = new Function('Buffer', `${match[0]}\nreturn parsePaymentResponse;`)(Buffer);

test('a real x402 v2 base64 PAYMENT-RESPONSE decodes to the actual tx hash', () => {
    const header = 'eyJzdWNjZXNzIjp0cnVlLCJwYXllciI6IkdDWkxJNkNXQko0WVo1QVIzRFBIN0pERklNVFNDTllGUlpINERORUpKVVIyT1A2V0hRSkxaTkdBIiwidHJhbnNhY3Rpb24iOiJhN2QzMGQ1NDU1ZGFlM2M0ODJmMGFhZDM1OTYyOTkzODYzNzdhM2I0YjVhYjU5MTk5Njg3MDhhZDMxODIxMzgwIiwibmV0d29yayI6InN0ZWxsYXI6dGVzdG5ldCJ9';
    const { txHash, meta } = parsePaymentResponse(header);
    assert.equal(txHash, 'a7d30d5455dae3c482f0aad3596299386377a3b4b5ab5919968708ad31821380');
    assert.equal(meta.network, 'stellar:testnet');
    assert.equal(meta.success, true);
});

test('a plain JSON PAYMENT-RESPONSE with `transaction` decodes directly, no base64', () => {
    const header = JSON.stringify({ success: true, transaction: 'b'.repeat(64), network: 'stellar:pubnet' });
    const { txHash, meta } = parsePaymentResponse(header);
    assert.equal(txHash, 'b'.repeat(64));
    assert.equal(meta.network, 'stellar:pubnet');
});

test('a bare 64-char hex hash with no JSON wrapper passes through unchanged', () => {
    const hash = 'c'.repeat(64);
    const { txHash, meta } = parsePaymentResponse(hash);
    assert.equal(txHash, hash);
    assert.equal(meta, null);
});

test('garbage (no valid hash, no valid JSON) yields an empty txHash, never the raw header', () => {
    const { txHash, meta } = parsePaymentResponse('not-a-hash-or-json');
    assert.equal(txHash, '');
    assert.equal(meta, null);
});

test('an empty or missing header yields an empty txHash', () => {
    assert.equal(parsePaymentResponse('').txHash, '');
    assert.equal(parsePaymentResponse(undefined).txHash, '');
});

test('base64 JSON with an unrecognized tx field still yields no hash, not the field value', () => {
    const header = Buffer.from(JSON.stringify({ success: true, someOtherField: 'nope' })).toString('base64');
    const { txHash, meta } = parsePaymentResponse(header);
    assert.equal(txHash, '');
    assert.equal(meta.someOtherField, 'nope');
});
