/**
 * Pre-sign policy hook (#96) - end to end through Agent.x402Fetch.
 * Fixtures: test/helpers/x402-edges.ts.
 */
import { test, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import { S, MERCHANT, payTo, X402PolicyError, counters, keySigner, agent, init, paid } from './helpers/x402-edges.ts';

beforeEach(() => { counters.paidRetries = 0; counters.challenges = 0; });

test('without policy, x402Fetch pays exactly as before', async () => {
    const { calls, signer } = keySigner();
    const a = agent(); init(a, { signer });
    assert.equal((await paid(a)).status, 200);
    assert.equal(calls.length, 1);
    assert.equal(counters.paidRetries, 1);
});

test('ALLOW bound to the authorization pays; the engine saw URL, method and amount', async () => {
    const { calls, signer } = keySigner();
    const seen: any[] = [];
    const a = agent();
    init(a, { signer, policy: { evaluate: async (ctx: any) => { seen.push(ctx); return { decision: 'ALLOW', contextHash: ctx.contextHash }; } } });
    assert.equal((await paid(a, '777')).status, 200);
    assert.equal(calls.length, 1);
    assert.equal(counters.paidRetries, 1);
    assert.equal(seen[0].url, `${MERCHANT}/resource?amount=777`);
    assert.equal(seen[0].method, 'GET');
    assert.equal(seen[0].authorization.amount, '777');
    assert.equal(seen[0].authorization.to, payTo);
    assert.equal(seen[0].authorization.preimageType, 'legacy');
});

test('ALLOW also gates a raw secretKey signer', async () => {
    const a = agent();
    let asked = 0;
    init(a, { secretKey: S.Keypair.random().secret(), policy: { evaluate: async (ctx: any) => { asked++; return { decision: 'ALLOW', contextHash: ctx.contextHash }; } } });
    assert.equal((await paid(a)).status, 200);
    assert.equal(asked, 1);
    assert.equal(counters.paidRetries, 1);
});

test('DENY: zero signer calls, no paid retry, X402PolicyError class survives @x402/fetch', async () => {
    const { calls, signer } = keySigner();
    const a = agent();
    init(a, { signer, policy: { evaluate: async () => ({ decision: 'DENY', reason: 'over budget' }) } });
    const err = await paid(a).catch((e: any) => e);
    assert.ok(err instanceof X402PolicyError, String(err));
    assert.equal(err.outcome, 'DENY');
    assert.equal(calls.length, 0);
    assert.equal(counters.paidRetries, 0);
    assert.equal(counters.challenges, 1);
});

test('stale ALLOW (policy revised before signing): STALE, zero signer calls, no paid retry', async () => {
    const { calls, signer } = keySigner();
    let current = 'v7';
    const a = agent();
    init(a, { signer, policy: {
        evaluate: async (ctx: any) => { current = 'v8'; return { decision: 'ALLOW', contextHash: ctx.contextHash, policyVersion: 'v7' }; },
        currentVersion: async () => current,
    } });
    const err = await paid(a).catch((e: any) => e);
    assert.ok(err instanceof X402PolicyError, String(err));
    assert.equal(err.outcome, 'STALE');
    assert.equal(calls.length, 0);
    assert.equal(counters.paidRetries, 0);
});

test('signer identity change during evaluation: SIGNER_CHANGED, zero signer calls', async () => {
    const { calls, signer } = keySigner();
    const a = agent();
    init(a, { signer, policy: { evaluate: async (ctx: any) => { signer.address = S.Keypair.random().publicKey(); return { decision: 'ALLOW', contextHash: ctx.contextHash }; } } });
    const err = await paid(a).catch((e: any) => e);
    assert.equal(err.outcome, 'SIGNER_CHANGED');
    assert.equal(calls.length, 0);
    assert.equal(counters.paidRetries, 0);
});

// Garantía que da stellar-sdk >= 16 (authorizeEntry verifica la firma contra
// sha256(preimage)), no el gate. Este test la ata al camino real de x402Fetch.
test('a signature over altered bytes never reaches the merchant (stellar-sdk check)', async () => {
    const mutate = (p: string) => {
        const pre: any = S.xdr.HashIdPreimage.fromXdr(p, 'base64');
        pre.sorobanAuthorization.invocation.function.contractFn.args[2] = S.nativeToScVal('1', { type: 'i128' });
        return pre.toXdr('base64');
    };
    const { calls, signer } = keySigner(undefined, { mutate });
    const a = agent();
    init(a, { signer, policy: { evaluate: async (ctx: any) => ({ decision: 'ALLOW', contextHash: ctx.contextHash }) } });
    await assert.rejects(paid(a), (e: any) => e.message.includes("signature doesn't match payload"));
    assert.equal(calls.length, 1);
    assert.equal(counters.paidRetries, 0);
});

test('initX402 rejects a malformed policy before any payment', () => {
    const { signer } = keySigner();
    assert.throws(() => init(agent(), { signer, policy: {} }), /policy\.evaluate/);
    assert.throws(() => init(agent(), { signer, policy: { evaluate: async () => ({}), currentVersion: 'v7' } }), /currentVersion/);
    assert.throws(() => init(agent(), { signer, policy: { evaluate: async () => ({}), timeoutMs: 0 } }), /timeoutMs/);
});
