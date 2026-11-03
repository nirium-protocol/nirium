/**
 * Meta-tests for the policy conformance suite (#226): a correct engine passes
 * every case, and each broken engine (or a gate that signs when it should not)
 * fails exactly the cases it should.
 *
 * Imports the suite from dist (it imports the gate without a .ts extension,
 * which --experimental-strip-types cannot resolve), so build first:
 * `npm run build && npm test`, as SDK CI does.
 */
import { describe, test } from 'node:test';
import assert from 'node:assert/strict';
import { Keypair } from '@stellar/stellar-sdk';
import { policyConformanceCases, runPolicyConformance } from '../dist/x402-policy-conformance.js';
import { createPolicyGatedSigner } from '../dist/x402-policy.js';
import type { PolicyConformanceTarget } from '../src/x402-policy-conformance.ts';
import type { X402PolicyHook, X402PolicyDecision, X402PolicyContext } from '../src/x402-policy.ts';

const blocked = Keypair.random().publicKey();

/** Reference engine: ALLOW up to 1_000_000 base units, DENY above, WAIT for `blocked`. */
function engine(over: Partial<X402PolicyHook> = {}, answer?: (ctx: X402PolicyContext, d: X402PolicyDecision) => X402PolicyDecision): X402PolicyHook {
    return {
        requireExpiry: true,
        currentVersion: async () => 'v1',
        evaluate: async (ctx) => {
            let d: X402PolicyDecision;
            if (ctx.authorization.to === blocked) d = { decision: 'WAIT', reason: 'needs a human' };
            else if (BigInt(ctx.authorization.amount) > 1_000_000n) d = { decision: 'DENY', reason: 'over cap' };
            else d = { decision: 'ALLOW', contextHash: ctx.contextHash, policyVersion: 'v1', expiresAt: Date.now() + 2_000 };
            return answer ? answer(ctx, d) : d;
        },
        ...over,
    };
}

const target = (createHook: () => X402PolicyHook, extra: Partial<PolicyConformanceTarget> = {}): PolicyConformanceTarget => ({
    name: 'reference', createHook, allow: { amount: '500000' }, deny: { amount: '2000000' }, ...extra,
});

/** Runs every case and returns the names of the ones that failed. */
async function failing(t: PolicyConformanceTarget, opts = {}): Promise<string[]> {
    const out: string[] = [];
    for (const c of policyConformanceCases(t, opts)) {
        try { await c.run(); } catch { out.push(c.name); }
    }
    return out;
}

const ALL = [
    'ALLOW with the exact contextHash signs exactly once',
    'DENY signs nothing',
    'WAIT signs nothing (engine ALLOW turned into WAIT)',
    'ALLOW with a wrong contextHash signs nothing',
    'ALLOW with an expired expiresAt signs nothing',
    'a malformed answer (no decision object) signs nothing',
    'a malformed answer (an unknown verdict) signs nothing',
    'a malformed answer (a non-numeric expiresAt) signs nothing',
    'an answer after the timeout signs nothing',
];
const ALLOW_CASE = ALL[0];
const DERIVED = ALL.slice(2); // built on the engine's own ALLOW

// The suite itself, registered as node:test tests, against the reference engine.
runPolicyConformance(target(() => engine()));
runPolicyConformance(target(() => engine(), { name: 'reference with native WAIT', wait: { amount: '1', payTo: blocked } }));

describe('conformance suite has teeth', () => {
    test('lists the seven cases from #226 (malformed split in three shapes)', () => {
        assert.deepEqual(policyConformanceCases(target(() => engine())).map((c) => c.name), ALL);
    });

    test('a correct engine passes every case', async () => {
        assert.deepEqual(await failing(target(() => engine())), []);
    });

    test('an engine that ignores contextHash fails the ALLOW case', async () => {
        const f = await failing(target(() => engine({}, (_c, d) => d.decision === 'ALLOW' ? { ...d, contextHash: 'f'.repeat(64) } : d)));
        assert.deepEqual(f, [ALLOW_CASE]);
    });

    test('an engine that omits contextHash fails the ALLOW case', async () => {
        const f = await failing(target(() => engine({}, (_c, d) => d.decision === 'ALLOW' ? { ...d, contextHash: undefined } : d)));
        assert.deepEqual(f, [ALLOW_CASE]);
    });

    test('an engine that ALLOWs everything fails the DENY case', async () => {
        const f = await failing(target(() => engine({}, (ctx) => ({ decision: 'ALLOW', contextHash: ctx.contextHash, policyVersion: 'v1', expiresAt: Date.now() + 2_000 }))));
        assert.deepEqual(f, ['DENY signs nothing']);
    });

    test('an engine that DENYs everything fails ALLOW and every case built on ALLOW', async () => {
        const f = await failing(target(() => engine({}, () => ({ decision: 'DENY' }))));
        assert.deepEqual(f, [ALLOW_CASE, ...DERIVED]);
    });

    test('an engine with no WAIT fails a declared native WAIT case', async () => {
        const f = await failing(target(() => engine({}, (ctx, d) => d.decision === 'WAIT'
            ? { decision: 'ALLOW', contextHash: ctx.contextHash, policyVersion: 'v1', expiresAt: Date.now() + 2_000 } : d),
        { wait: { amount: '1', payTo: blocked } }));
        assert.deepEqual(f, ['WAIT signs nothing']);
    });

    test('an engine that hangs fails every case that needs an answer', async () => {
        const hang = () => engine({ timeoutMs: 50, evaluate: (_c, { signal }) => new Promise((_, rej) => signal.addEventListener('abort', () => rej(new Error('aborted')))) });
        const f = await failing(target(hang));
        assert.deepEqual(f, [ALLOW_CASE, 'DENY signs nothing', ...DERIVED]);
    });

    test('an engine that throws fails every case that needs an answer', async () => {
        const f = await failing(target(() => engine({ evaluate: async () => { throw new Error('boom'); } })));
        assert.deepEqual(f, [ALLOW_CASE, 'DENY signs nothing', ...DERIVED]);
    });

    test('an engine whose ALLOW is already expired fails the ALLOW case', async () => {
        const f = await failing(target(() => engine({}, (_c, d) => d.decision === 'ALLOW' ? { ...d, expiresAt: Date.now() - 1 } : d)));
        assert.ok(f.includes(ALLOW_CASE), f.join('; '));
    });

    test('an engine with requireExpiry and no expiresAt fails the ALLOW case', async () => {
        const f = await failing(target(() => engine({}, (_c, d) => d.decision === 'ALLOW' ? { ...d, expiresAt: undefined } : d)));
        assert.ok(f.includes(ALLOW_CASE), f.join('; '));
    });

    test('an engine whose ALLOW carries a stale policyVersion fails the ALLOW case', async () => {
        const f = await failing(target(() => engine({}, (_c, d) => d.decision === 'ALLOW' ? { ...d, policyVersion: 'v0' } : d)));
        assert.ok(f.includes(ALLOW_CASE), f.join('; '));
    });

    test('an engine that returns a malformed verdict fails the ALLOW case', async () => {
        const f = await failing(target(() => engine({}, (_c, d) => (d.decision === 'ALLOW' ? { ...d, decision: 'yes' } : d) as X402PolicyDecision)));
        assert.ok(f.includes(ALLOW_CASE), f.join('; '));
    });

    test('a gate that signs whatever the engine says fails every refusal case', async () => {
        const leaky: typeof createPolicyGatedSigner = (base, policy, getCall, onRefused) => {
            const real = createPolicyGatedSigner(base, policy, getCall, onRefused);
            return { address: base.address, signAuthEntry: async (x, o) => {
                try { return await real.signAuthEntry(x, o); } catch { return base.signAuthEntry(x, o); }
            } };
        };
        const f = await failing(target(() => engine()), { gate: leaky });
        assert.deepEqual(f, ALL.slice(1));
    });

    test('a gate that never signs fails the ALLOW case', async () => {
        const closed: typeof createPolicyGatedSigner = (base) => ({ address: base.address, signAuthEntry: async () => { throw new Error('closed'); } });
        const f = await failing(target(() => engine()), { gate: closed });
        assert.ok(f.includes(ALLOW_CASE), f.join('; '));
    });

    test('createHook is called once per case', async () => {
        let n = 0;
        await failing(target(() => { n++; return engine(); }));
        assert.equal(n, ALL.length);
    });
});
