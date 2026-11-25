/**
 * initX402({ maxAmountPerPayment }) (#106): the @x402/core per-payment cap,
 * configurable and still $1 by default. End to end on the built package with
 * the in-memory edges of test/helpers/x402-edges.ts.
 */
import { test, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import { X402SpendCapError, counters, keySigner, agent, init, paid } from './helpers/x402-edges.ts';

beforeEach(() => { counters.paidRetries = 0; counters.challenges = 0; });

const ONE_O_ONE = '10100000'; // $1.01 in USDC (7 decimals)
const allowAll = { evaluate: async (ctx: any) => ({ decision: 'ALLOW', contextHash: ctx.contextHash }) };

test('default: a $1.01 payment is refused and the signer is never called', async () => {
    const { calls, signer } = keySigner();
    const a = agent(); init(a, { signer });
    const err = await paid(a, ONE_O_ONE).catch((e: any) => e);
    assert.ok(err instanceof X402SpendCapError, String(err));
    assert.equal(err.cap, '$1');
    assert.match(err.message, /initX402\(\{ maxAmountPerPayment \}\)/);
    assert.equal(calls.length, 0);
    assert.equal(counters.paidRetries, 0);
});

for (const cap of ['$2', '2', 2, '1.01']) {
    test(`raised cap ${JSON.stringify(cap)}: $1.01 pays and is signed once`, async () => {
        const { calls, signer } = keySigner();
        const a = agent(); init(a, { signer, maxAmountPerPayment: cap });
        assert.equal((await paid(a, ONE_O_ONE)).status, 200);
        assert.equal(calls.length, 1);
        assert.equal(counters.paidRetries, 1);
    });
}

test('raised cap still blocks above it, before the signer', async () => {
    const { calls, signer } = keySigner();
    const a = agent(); init(a, { signer, maxAmountPerPayment: '$5' });
    const err = await paid(a, '50000001').catch((e: any) => e);
    assert.ok(err instanceof X402SpendCapError, String(err));
    assert.equal(err.cap, '$5');
    assert.equal(calls.length, 0);
});

test('with a policy: the raised cap applies, and the policy is not asked when the cap blocks', async () => {
    const { calls, signer } = keySigner();
    let asked = 0;
    const a = agent();
    init(a, { signer, maxAmountPerPayment: '$2', policy: { evaluate: async (ctx: any) => { asked++; return allowAll.evaluate(ctx); } } });
    assert.equal((await paid(a, ONE_O_ONE)).status, 200);
    assert.equal(asked, 1);
    const err = await paid(a, '20000001').catch((e: any) => e);
    assert.ok(err instanceof X402SpendCapError, String(err));
    assert.equal(asked, 1);
    assert.equal(calls.length, 1);
});

test('invalid values fail at initX402, not at payment time', () => {
    const { signer } = keySigner();
    for (const bad of [0, -1, '0', '$0', 'abc', '', '1e3', NaN, Infinity, false, null, '$-1', '1,5']) {
        assert.throws(() => init(agent(), { signer, maxAmountPerPayment: bad }), /maxAmountPerPayment` must be a positive USD amount/, JSON.stringify(bad));
    }
});
