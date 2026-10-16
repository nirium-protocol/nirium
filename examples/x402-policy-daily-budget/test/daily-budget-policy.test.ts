import { test } from 'node:test';
import assert from 'node:assert/strict';
import type { X402PolicyContext } from 'nirium';
import { DailyBudgetPolicy } from '../src/daily-budget-policy.ts';

const T0 = Date.UTC(2026, 9, 13, 12, 0, 0);

function ctx(amount: string, nonce: string, signer = 'GAGENT'): X402PolicyContext {
    return {
        contextVersion: 1,
        url: 'https://api.example/paid',
        method: 'GET',
        requirements: { scheme: 'exact', network: 'stellar:testnet', asset: 'CUSDC', payTo: 'GMERCHANT', amount, maxTimeoutSeconds: 60 },
        authorization: {
            preimageXdr: '', preimageType: 'legacy', payloadHash: `p-${nonce}`, networkPassphrase: 'Test SDF Network ; September 2015',
            nonce, signatureExpirationLedger: 1, contractId: 'CUSDC', functionName: 'transfer',
            from: signer, to: 'GMERCHANT', amount,
        },
        signer,
        contextHash: `ctx-${nonce}`,
    };
}

test('ALLOW echoes the exact contextHash with a short expiresAt and the current version', async () => {
    const p = new DailyBudgetPolicy({ dailyCap: 100n, ttlMs: 1500, now: () => T0 });
    const d = await p.evaluate(ctx('40', 'n1'));
    assert.equal(d.decision, 'ALLOW');
    assert.equal(d.contextHash, 'ctx-n1');
    assert.equal(d.expiresAt, T0 + 1500);
    assert.equal(d.policyVersion, p.currentVersion());
    assert.equal(p.store.spent('GAGENT', '2026-10-13'), 40n);
});

test('DENY when today spend + amount exceeds the cap, and nothing is committed', async () => {
    const p = new DailyBudgetPolicy({ dailyCap: 100n, now: () => T0 });
    assert.equal((await p.evaluate(ctx('70', 'a'))).decision, 'ALLOW');
    const d = await p.evaluate(ctx('31', 'b'));
    assert.equal(d.decision, 'DENY');
    assert.equal(d.contextHash, undefined);
    assert.equal(p.store.spent('GAGENT', '2026-10-13'), 70n);
    assert.equal((await p.evaluate(ctx('30', 'c'))).decision, 'ALLOW'); // exactly at cap is fine
});

test('concurrent pair on the same remaining budget: exactly one passes', async () => {
    const p = new DailyBudgetPolicy({ dailyCap: 100n, now: () => T0 });
    await p.evaluate(ctx('40', 'pre')); // 60 left
    const [a, b] = await Promise.all([p.evaluate(ctx('50', 'x')), p.evaluate(ctx('50', 'y'))]);
    assert.deepEqual([a.decision, b.decision].sort(), ['ALLOW', 'DENY']);
    assert.equal(p.store.spent('GAGENT', '2026-10-13'), 90n);
});

test('many concurrent requests never overspend the cap', async () => {
    const p = new DailyBudgetPolicy({ dailyCap: 1000n, now: () => T0 });
    const out = await Promise.all(Array.from({ length: 50 }, (_, i) => p.evaluate(ctx('70', `r${i}`))));
    assert.equal(out.filter((d) => d.decision === 'ALLOW').length, 14);
    assert.ok(p.store.spent('GAGENT', '2026-10-13') <= 1000n);
});

test('stale policy version: a change between decision and signing fails closed', async () => {
    const p = new DailyBudgetPolicy({ dailyCap: 100n, now: () => T0 });
    const hook = p.hook();
    const c = ctx('10', 's');
    const d = await hook.evaluate(c, { signal: new AbortController().signal });
    assert.equal(d.decision, 'ALLOW');
    p.update({ dailyCap: 5n }); // policy tightened before signing
    const live = await hook.currentVersion!(c, { signal: new AbortController().signal });
    assert.notEqual(live, d.policyVersion, 'the SDK compares these and refuses with STALE');
    assert.equal(hook.requireExpiry, true);
});

test('caps are per agent and per UTC day', async () => {
    let now = T0;
    const p = new DailyBudgetPolicy({ dailyCap: 100n, caps: { GBIG: 500n }, now: () => now });
    assert.equal((await p.evaluate(ctx('100', 'a'))).decision, 'ALLOW');
    assert.equal((await p.evaluate(ctx('300', 'b', 'GBIG'))).decision, 'ALLOW');
    assert.equal((await p.evaluate(ctx('1', 'c'))).decision, 'DENY');
    now = T0 + 24 * 3600_000;
    assert.equal((await p.evaluate(ctx('100', 'd'))).decision, 'ALLOW');
});

test('non-integer or non-positive amounts are denied', async () => {
    const p = new DailyBudgetPolicy({ dailyCap: 100n, now: () => T0 });
    assert.equal((await p.evaluate(ctx('1.5', 'f'))).decision, 'DENY');
    assert.equal((await p.evaluate(ctx('0', 'z'))).decision, 'DENY');
});
