/**
 * anchorAuditRecord() result shape, offline. Runs the built package (run `npm run build` first).
 *
 * The node answers POST /api/audit/log with `content_sha256` (snake case). Up to 0.19.3 the SDK
 * returned that body as is, so the typed `contentSha256` field was always undefined.
 */
import { test, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const { Agent } = require('../dist/index.js');
const HASH = 'e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855';
const realFetch = globalThis.fetch;
afterEach(() => { globalThis.fetch = realFetch; });

function stubFetch(body: Record<string, unknown>) {
    const calls: { url: string; init: RequestInit }[] = [];
    globalThis.fetch = (async (url: string, init: RequestInit) => {
        calls.push({ url, init });
        return new Response(JSON.stringify(body), { status: 201, headers: { 'content-type': 'application/json' } });
    }) as typeof fetch;
    return calls;
}

const agent = () => new Agent({ apiKey: 'test-placeholder', baseUrl: 'https://backend.invalid' });

test('maps the node\'s content_sha256 to contentSha256 and keeps the raw field', async () => {
    const calls = stubFetch({ cid: 'QmTest', content_sha256: HASH, gatewayUrl: 'https://g/ipfs/QmTest', anchoredAt: '2026-11-17T00:00:00Z' });
    const anchor = await agent().anchorAuditRecord({ hash: HASH, tag: 'test' });

    assert.equal(calls[0].url, 'https://backend.invalid/api/audit/log');
    assert.equal(calls[0].init.method, 'POST');
    assert.equal(anchor.cid, 'QmTest');
    assert.equal(anchor.contentSha256, HASH);
    assert.equal(anchor.content_sha256, HASH);
    assert.equal(anchor.gatewayUrl, 'https://g/ipfs/QmTest');
});

test('leaves a contentSha256 the node already sends untouched', async () => {
    stubFetch({ cid: 'QmTest', contentSha256: HASH, anchoredAt: '2026-11-17T00:00:00Z' });
    const anchor = await agent().anchorAuditRecord({ hash: HASH });
    assert.equal(anchor.contentSha256, HASH);
    assert.equal('content_sha256' in anchor, false);
});
