import { test } from 'node:test';
import assert from 'node:assert/strict';
import type { X402PolicyContext } from 'nirium';
import { OpaPolicy } from '../src/opa-policy.ts';

const T0 = Date.UTC(2026, 10, 2, 12, 0, 0);
const URL = 'http://opa.test:8181';
const sig = () => ({ signal: new AbortController().signal });

function ctx(amount = '5000000', to = 'GMERCHANTALLOWED', nonce = 'n1'): X402PolicyContext {
    return {
        contextVersion: 1,
        url: 'https://api.example/paid',
        method: 'GET',
        requirements: { scheme: 'exact', network: 'stellar:testnet', asset: 'CUSDC', payTo: to, amount, maxTimeoutSeconds: 60 },
        authorization: {
            preimageXdr: '', preimageType: 'legacy', payloadHash: `p-${nonce}`, networkPassphrase: 'Test SDF Network ; September 2015',
            nonce, signatureExpirationLedger: 1, contractId: 'CUSDC', functionName: 'transfer',
            from: 'GAGENT', to, amount,
        },
        signer: 'GAGENT',
        contextHash: `ctx-${nonce}`,
    };
}

/** Mock OPA: no network. `answer` builds the response for each request. */
function mockOpa(answer: (input: any) => Response | Promise<Response>) {
    const calls: { url: string; input: any }[] = [];
    const fetch = (async (url: string, init: RequestInit) => {
        const input = JSON.parse(String(init.body)).input;
        calls.push({ url, input });
        return answer(input);
    }) as unknown as typeof globalThis.fetch;
    return { fetch, calls };
}

const opaBody = (result: unknown, revision = 'r1') =>
    Response.json({ provenance: { version: '1.22.0', bundles: { policy: { revision } } }, result });

test('ALLOW echoes the exact contextHash, a short expiresAt and the bundle revision', async () => {
    const { fetch, calls } = mockOpa(() => opaBody({ allow: true }, 'rev-7'));
    const p = new OpaPolicy({ url: URL, fetch, ttlMs: 1500, now: () => T0 });
    const d = await p.evaluate(ctx(), sig());
    assert.equal(d.decision, 'ALLOW');
    assert.equal(d.contextHash, 'ctx-n1');
    assert.equal(d.expiresAt, T0 + 1500);
    assert.equal(d.policyVersion, 'rev-7');
    assert.equal(calls[0].url, `${URL}/v1/data/nirium/x402/decision?provenance`);
    assert.deepEqual(calls[0].input, {
        amount: '5000000', destination: 'GMERCHANTALLOWED', asset: 'CUSDC', network: 'stellar:testnet', agent: 'GAGENT',
    });
});

test('DENY carries the OPA reason and no contextHash', async () => {
    const { fetch } = mockOpa(() => opaBody({ allow: false, reason: 'destination not in allowlist' }));
    const d = await new OpaPolicy({ url: URL, fetch }).evaluate(ctx('1', 'GOTHER'), sig());
    assert.equal(d.decision, 'DENY');
    assert.equal(d.reason, 'destination not in allowlist');
    assert.equal(d.contextHash, undefined);
});

test('OPA down: evaluate throws (the SDK signs nothing)', async () => {
    const fetch = (async () => { throw new TypeError('fetch failed: ECONNREFUSED'); }) as unknown as typeof globalThis.fetch;
    await assert.rejects(new OpaPolicy({ url: URL, fetch }).evaluate(ctx(), sig()), /ECONNREFUSED/);
});

test('non-200 from OPA throws', async () => {
    const { fetch } = mockOpa(() => new Response('{"code":"internal_error"}', { status: 500 }));
    await assert.rejects(new OpaPolicy({ url: URL, fetch }).evaluate(ctx(), sig()), /HTTP 500/);
});

for (const [name, res] of [
    ['not JSON', () => new Response('<html>proxy error</html>', { status: 200 })],
    ['undefined rule (no result)', () => Response.json({ provenance: { bundles: { policy: { revision: 'r1' } } } })],
    ['allow is a string', () => opaBody({ allow: 'true' })],
    ['result is a bare boolean', () => opaBody(true)],
    ['reason is not a string', () => opaBody({ allow: false, reason: 42 })],
    ['no provenance', () => Response.json({ result: { allow: true } })],
    ['revision for another bundle', () => Response.json({ provenance: { bundles: { other: { revision: 'r1' } } }, result: { allow: true } })],
    ['empty revision', () => opaBody({ allow: true }, '')],
] as const) {
    test(`malformed answer (${name}) throws, never ALLOW`, async () => {
        const { fetch } = mockOpa(res);
        await assert.rejects(new OpaPolicy({ url: URL, fetch }).evaluate(ctx(), sig()));
    });
}

test('stale revision: a bundle update between decision and signing fails closed', async () => {
    let revision = 'r1';
    const { fetch, calls } = mockOpa(() => opaBody({ allow: true }, revision));
    const hook = new OpaPolicy({ url: URL, fetch }).hook();
    const c = ctx();
    const d = await hook.evaluate(c, sig());
    assert.equal(d.decision, 'ALLOW');
    assert.equal(await hook.currentVersion!(c, sig()), d.policyVersion, 'unchanged bundle: versions match');
    revision = 'r2'; // OPA loads a new bundle before signing
    const live = await hook.currentVersion!(c, sig());
    assert.notEqual(live, d.policyVersion, 'the SDK compares these and refuses with STALE');
    assert.equal(calls[1].input, undefined, 'currentVersion sends no payment input');
    assert.equal(hook.requireExpiry, true);
});

test('slow OPA: the abort signal from the SDK deadline cancels the request', async () => {
    const fetch = ((_u: string, init: RequestInit) => new Promise((_res, rej) => {
        init.signal!.addEventListener('abort', () => rej(init.signal!.reason));
    })) as unknown as typeof globalThis.fetch;
    const ac = new AbortController();
    const pending = new OpaPolicy({ url: URL, fetch }).evaluate(ctx(), { signal: ac.signal });
    ac.abort(new Error('policy deadline'));
    await assert.rejects(pending, /policy deadline/);
});
