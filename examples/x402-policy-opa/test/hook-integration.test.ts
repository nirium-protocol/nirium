/**
 * OpaPolicy wired into the SDK's REAL pre-sign gate: the same
 * `createPolicyGatedSigner` that `initX402({ policy })` wraps around the
 * signer (packages/sdk/src/index.ts). OPA is a mocked fetch: no network,
 * no RPC, nothing broadcast. Each test builds the transfer auth entry that
 * ExactStellarScheme would ask to sign and runs it through stellar-sdk's
 * `authorizeEntry`, which is what `signAuthEntries` calls internally.
 *
 * The gate is not part of the public API (initX402 needs a real 402 server
 * and RPC to reach it), so it is imported from the built SDK's dist. Build
 * the SDK first (see README).
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { Keypair, Networks, xdr, Address, nativeToScVal, authorizeEntry, hash } from '@stellar/stellar-sdk';
import { createPolicyGatedSigner, X402PolicyError } from 'nirium/dist/x402-policy.js';
import type { X402PolicyHook, X402PolicyRecord } from 'nirium';
import { OpaPolicy } from '../src/opa-policy.ts';

const payer = Keypair.random();
const merchant = Keypair.random().publicKey();
const USDC_TESTNET = 'CBIELTK6YBZJU5UP2WWQEUCYKLPU6AUNZ2BQ4WWFEIE3USCIHMXQDAMA';
const OPA = 'http://opa.test:8181';

const reqs = (amount: string) => ({
    scheme: 'exact', network: 'stellar:testnet', asset: USDC_TESTNET, payTo: merchant, amount, maxTimeoutSeconds: 60,
});

let nonce = 1n;
function transferEntry(amount: string) {
    return new xdr.SorobanAuthorizationEntry({
        credentials: xdr.SorobanCredentials.sorobanCredentialsAddress(new xdr.SorobanAddressCredentials({
            address: new Address(payer.publicKey()).toScAddress(),
            nonce: xdr.Int64.fromString(String(nonce++)),
            signatureExpirationLedger: 0,
            signature: xdr.ScVal.scvVoid(),
        })),
        rootInvocation: new xdr.SorobanAuthorizedInvocation({
            function: xdr.SorobanAuthorizedFunction.sorobanAuthorizedFunctionTypeContractFn(new xdr.InvokeContractArgs({
                contractAddress: new Address(USDC_TESTNET).toScAddress(),
                functionName: 'transfer',
                args: [
                    nativeToScVal(payer.publicKey(), { type: 'address' }),
                    nativeToScVal(merchant, { type: 'address' }),
                    nativeToScVal(amount, { type: 'i128' }),
                ],
            })),
            subInvocations: [],
        }),
    });
}

/**
 * Mock OPA that evaluates the same rule as policy/x402.rego (cap 10_000_000,
 * allowlist = [merchant]). `mode` switches failure behaviour per test.
 */
function mockOpa(opts: {
    mode?: 'ok' | 'down' | 'http500' | 'malformed' | 'hang' | 'hangIgnoringAbort';
    revisions?: string[]; // revision reported on the 1st, 2nd, ... request
} = {}) {
    const requests: any[] = [];
    const fetch = (async (_url: string, init: RequestInit) => {
        const body = JSON.parse(String(init.body));
        requests.push(body);
        const revs = opts.revisions ?? ['r1'];
        const revision = revs[Math.min(requests.length - 1, revs.length - 1)];
        switch (opts.mode ?? 'ok') {
            case 'down': throw new TypeError('fetch failed (ECONNREFUSED)');
            case 'http500': return new Response('boom', { status: 500 });
            case 'malformed': return Response.json({ provenance: { bundles: { policy: { revision } } }, result: { allow: 'yes' } });
            case 'hang': return new Promise<Response>((_, reject) => {
                init.signal?.addEventListener('abort', () => reject(init.signal!.reason));
            });
            case 'hangIgnoringAbort': return new Promise<Response>(() => { /* never settles */ });
        }
        const input = body.input;
        let result: unknown;
        if (input) {
            const amountOk = /^[1-9][0-9]*$/.test(input.amount) && Number(input.amount) <= 10_000_000;
            const destOk = input.destination === merchant;
            result = !amountOk ? { allow: false, reason: 'amount over per-payment cap' }
                : !destOk ? { allow: false, reason: 'destination not in allowlist' } : { allow: true };
        }
        return Response.json({ provenance: { version: '1.22.0', bundles: { policy: { revision } } }, result });
    }) as unknown as typeof globalThis.fetch;
    return { fetch, requests };
}

/** Runs one payment through the real gate. Returns outcome + whether the base signer was reached. */
async function pay(hook: X402PolicyHook, amount = '5000000') {
    const records: X402PolicyRecord[] = [];
    let baseCalls = 0;
    const base = {
        address: payer.publicKey(),
        signAuthEntry: async (preimageXdr: string) => {
            baseCalls++;
            const pre = xdr.HashIdPreimage.fromXDR(preimageXdr, 'base64');
            return { signedAuthEntry: payer.sign(hash(pre.toXDR())).toString('base64'), signerAddress: payer.publicKey() };
        },
    };
    const gated = createPolicyGatedSigner(
        base, { ...hook, onDecision: (r) => records.push(r) },
        () => ({ url: 'https://api.example/paid', method: 'GET', requirements: reqs(amount) }),
    );
    let outcome = 'SIGNED';
    let error: X402PolicyError | undefined;
    try {
        await authorizeEntry(transferEntry(amount), async (preimage: any) => {
            const { signedAuthEntry } = await gated.signAuthEntry(preimage.toXDR('base64'), { address: payer.publicKey() });
            return Buffer.from(signedAuthEntry, 'base64');
        }, 1_000_000, Networks.TESTNET);
    } catch (e) {
        if (!(e instanceof X402PolicyError)) throw e;
        outcome = e.outcome;
        error = e;
    }
    return { outcome, baseCalls, records, error };
}

test('allow: OPA ALLOW passes every gate check and the base signer signs', async () => {
    const { fetch, requests } = mockOpa();
    const r = await pay(new OpaPolicy({ url: OPA, fetch }).hook());
    assert.equal(r.outcome, 'SIGNED');
    assert.equal(r.baseCalls, 1);
    assert.deepEqual(r.records.map((x) => x.outcome), ['ALLOWED', 'SIGNED']);
    // OPA saw what is signed, decoded from the real preimage.
    assert.deepEqual(requests[0].input, {
        amount: '5000000', destination: merchant, asset: USDC_TESTNET, network: 'stellar:testnet', agent: payer.publicKey(),
    });
    assert.equal(requests.length, 2); // decision + currentVersion
});

test('deny (over cap): no signature', async () => {
    const { fetch } = mockOpa();
    const r = await pay(new OpaPolicy({ url: OPA, fetch }).hook(), '20000000');
    assert.equal(r.outcome, 'DENY');
    assert.equal(r.baseCalls, 0);
    assert.match(r.error!.message, /amount over per-payment cap/);
});

for (const [mode, expected] of [
    ['down', 'ENGINE_ERROR'], ['http500', 'ENGINE_ERROR'], ['malformed', 'ENGINE_ERROR'],
] as const) {
    test(`OPA ${mode}: ${expected}, no signature`, async () => {
        const { fetch } = mockOpa({ mode });
        const r = await pay(new OpaPolicy({ url: OPA, fetch }).hook());
        assert.equal(r.outcome, expected);
        assert.equal(r.baseCalls, 0);
    });
}

test('slow OPA (honours abort): the hook deadline ends in TIMEOUT, no signature', async () => {
    const { fetch } = mockOpa({ mode: 'hang' });
    const t0 = Date.now();
    const r = await pay(new OpaPolicy({ url: OPA, fetch }).hook({ timeoutMs: 150 }));
    assert.equal(r.outcome, 'TIMEOUT');
    assert.equal(r.baseCalls, 0);
    assert.ok(Date.now() - t0 < 2_000);
});

test('slow OPA (ignores abort): still TIMEOUT, no signature', async () => {
    const { fetch } = mockOpa({ mode: 'hangIgnoringAbort' });
    const r = await pay(new OpaPolicy({ url: OPA, fetch }).hook({ timeoutMs: 150 }));
    assert.equal(r.outcome, 'TIMEOUT');
    assert.equal(r.baseCalls, 0);
});

test('bundle revision changes between decision and signing: STALE, no signature', async () => {
    const { fetch } = mockOpa({ revisions: ['r1', 'r2'] });
    const r = await pay(new OpaPolicy({ url: OPA, fetch }).hook());
    assert.equal(r.outcome, 'STALE');
    assert.equal(r.baseCalls, 0);
    assert.match(r.error!.message, /issued under policy r1, current is r2/);
});

test('the gate itself rejects an ALLOW with a wrong contextHash (UNBOUND)', async () => {
    const { fetch } = mockOpa();
    const hook = new OpaPolicy({ url: OPA, fetch }).hook();
    const tampered: X402PolicyHook = { ...hook, evaluate: async (c, o) => ({ ...(await hook.evaluate(c, o)), contextHash: 'other' }) };
    const r = await pay(tampered);
    assert.equal(r.outcome, 'UNBOUND');
    assert.equal(r.baseCalls, 0);
});

test('the gate itself rejects an ALLOW without expiresAt (requireExpiry)', async () => {
    const { fetch } = mockOpa();
    const hook = new OpaPolicy({ url: OPA, fetch }).hook();
    const noExpiry: X402PolicyHook = {
        ...hook, evaluate: async (c, o) => { const d = await hook.evaluate(c, o); delete d.expiresAt; return d; },
    };
    const r = await pay(noExpiry);
    assert.equal(r.outcome, 'EXPIRED');
    assert.equal(r.baseCalls, 0);
});

test('an ALLOW whose ttl already elapsed is refused (EXPIRED)', async () => {
    const { fetch } = mockOpa();
    const r = await pay(new OpaPolicy({ url: OPA, fetch, ttlMs: 1, now: () => Date.now() - 10 }).hook());
    assert.equal(r.outcome, 'EXPIRED');
    assert.equal(r.baseCalls, 0);
});
