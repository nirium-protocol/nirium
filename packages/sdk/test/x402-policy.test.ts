/**
 * Pre-sign policy hook (#96) - unit tests against the real stellar-sdk.
 *
 * No RPC, no network, nothing broadcast: each test builds the auth entry that
 * ExactStellarScheme would ask to sign and runs it through `authorizeEntry`,
 * which is what `AssembledTransaction.signAuthEntries` calls internally (and
 * where stellar-sdk verifies the returned signature against sha256(preimage)).
 */
import { describe, test } from 'node:test';
import assert from 'node:assert/strict';
import {
    Keypair, Networks, xdr, Address, nativeToScVal, authorizeEntry, hash,
} from '@stellar/stellar-sdk';
import {
    createPolicyGatedSigner, effectiveTimeoutMs, assertValidPolicyHook, X402PolicyError,
} from '../src/x402-policy.ts';
import type {
    X402PolicyHook, X402PaymentRequirementsView, X402PolicyContext, X402PolicyRecord,
} from '../src/x402-policy.ts';

const payer = Keypair.random();
const merchant = Keypair.random().publicKey();
const USDC_TESTNET = 'CBIELTK6YBZJU5UP2WWQEUCYKLPU6AUNZ2BQ4WWFEIE3USCIHMXQDAMA';
const LEDGER = 1_000_000;

const reqs = (over: Partial<X402PaymentRequirementsView> = {}): X402PaymentRequirementsView => ({
    scheme: 'exact', network: 'stellar:testnet', asset: USDC_TESTNET, payTo: merchant,
    amount: '200000', maxTimeoutSeconds: 60, ...over,
});

function invocation(opts: { amount?: string; to?: string; fn?: string; sub?: boolean }, nested = false): xdr.SorobanAuthorizedInvocation {
    return new xdr.SorobanAuthorizedInvocation({
        function: xdr.SorobanAuthorizedFunction.sorobanAuthorizedFunctionTypeContractFn(
            new xdr.InvokeContractArgs({
                contractAddress: new Address(USDC_TESTNET).toScAddress(),
                functionName: opts.fn ?? 'transfer',
                args: [
                    nativeToScVal(payer.publicKey(), { type: 'address' }),
                    nativeToScVal(opts.to ?? merchant, { type: 'address' }),
                    nativeToScVal(opts.amount ?? '200000', { type: 'i128' }),
                ],
            }),
        ),
        subInvocations: opts.sub && !nested ? [invocation({}, true)] : [],
    });
}

let nonceSeq = 1n;
/** transfer(from,to,amount) auth entry, as the simulation would return it. */
function transferEntry(opts: { amount?: string; to?: string; fn?: string; nonce?: bigint; sub?: boolean } = {}) {
    return new xdr.SorobanAuthorizationEntry({
        credentials: xdr.SorobanCredentials.sorobanCredentialsAddress(new xdr.SorobanAddressCredentials({
            address: new Address(payer.publicKey()).toScAddress(),
            nonce: xdr.Int64.fromString(String(opts.nonce ?? nonceSeq++)),
            signatureExpirationLedger: 0,
            signature: xdr.ScVal.scvVoid(),
        })),
        rootInvocation: invocation(opts),
    });
}

/** Instrumented base signer: counts calls and records the exact bytes. */
function instrumentedSigner(opts: { mutate?: (preimageXdr: string) => string } = {}) {
    const calls: string[] = [];
    const signer = {
        address: payer.publicKey(),
        signAuthEntry: async (preimageXdr: string) => {
            calls.push(preimageXdr);
            const signed = opts.mutate ? opts.mutate(preimageXdr) : preimageXdr;
            const pre = xdr.HashIdPreimage.fromXdr(signed, 'base64');
            return { signedAuthEntry: Buffer.from(payer.sign(hash(pre.toXdr()))).toString('base64'), signerAddress: payer.publicKey() };
        },
    };
    return { calls, signer };
}

/** What stellar-sdk `signAuthEntries` does with each entry. */
async function sign(gated: { signAuthEntry: (...a: any[]) => Promise<any> }, entry = transferEntry(), passphrase = Networks.TESTNET) {
    return authorizeEntry(entry, async (preimage: any) => {
        const { signedAuthEntry } = await gated.signAuthEntry(preimage.toXDR('base64'), { address: payer.publicKey() });
        return Buffer.from(signedAuthEntry, 'base64');
    }, LEDGER, passphrase);
}

const call = (url = 'https://api.example/paid', requirements = reqs()) => () => ({ url, method: 'GET', requirements });
const allow = (extra = {}): X402PolicyHook['evaluate'] => async (ctx) => ({ decision: 'ALLOW', contextHash: ctx.contextHash, ...extra });
const outcomeOf = async (p: Promise<unknown>) => {
    try { await p; return 'SIGNED'; } catch (e) {
        if (!(e instanceof X402PolicyError)) throw e;
        return e.outcome;
    }
};
const delay = (ms: number) => new Promise((r) => setTimeout(r, ms));

describe('decision binding (G1)', () => {
    test('bound, current ALLOW signs once, over the evaluated bytes', async () => {
        const { calls, signer } = instrumentedSigner();
        let seen: X402PolicyContext | undefined;
        const gated = createPolicyGatedSigner(signer, {
            evaluate: async (ctx) => { seen = ctx; return { decision: 'ALLOW', contextHash: ctx.contextHash }; },
        }, call());
        const signed = await sign(gated);
        assert.equal(calls.length, 1);
        assert.equal(calls[0], seen!.authorization.preimageXdr);
        assert.equal(seen!.authorization.amount, '200000');
        assert.equal(seen!.authorization.to, merchant);
        assert.equal(seen!.authorization.preimageType, 'legacy');
        assert.equal(seen!.url, 'https://api.example/paid');
        assert.equal(signed.credentials.address.signatureExpirationLedger, LEDGER);
    });

    for (const verdict of ['DENY', 'WAIT'] as const) test(`${verdict} never reaches the signer`, async () => {
        const { calls, signer } = instrumentedSigner();
        const gated = createPolicyGatedSigner(signer, {
            evaluate: async (ctx) => ({ decision: verdict, contextHash: ctx.contextHash, reason: 'x' }),
        }, call());
        assert.equal(await outcomeOf(sign(gated)), verdict);
        assert.equal(calls.length, 0);
    });

    test('engine exception fails closed', async () => {
        const { calls, signer } = instrumentedSigner();
        const gated = createPolicyGatedSigner(signer, { evaluate: async () => { throw new Error('engine down'); } }, call());
        assert.equal(await outcomeOf(sign(gated)), 'ENGINE_ERROR');
        assert.equal(calls.length, 0);
    });

    test('timeout: a late ALLOW produces no signature, not even afterwards', async () => {
        const { calls, signer } = instrumentedSigner();
        let aborted = false;
        const gated = createPolicyGatedSigner(signer, {
            timeoutMs: 20,
            evaluate: (ctx, { signal }) => new Promise((r) => {
                signal.addEventListener('abort', () => { aborted = true; });
                setTimeout(() => r({ decision: 'ALLOW', contextHash: ctx.contextHash }), 80);
            }),
        }, call());
        const err = await sign(gated).catch((e) => e);
        assert.ok(err instanceof X402PolicyError);
        assert.equal(err.outcome, 'TIMEOUT');
        assert.equal(err.message, 'x402 policy TIMEOUT: no decision within 20 ms');
        await delay(120);
        assert.equal(calls.length, 0);
        assert.equal(aborted, true);
    });

    test('decision resolved but the clock is already past the deadline: no signature', async () => {
        const { calls, signer } = instrumentedSigner();
        let t = 0;
        const gated = createPolicyGatedSigner(signer, {
            timeoutMs: 1000, now: () => t,
            evaluate: async (ctx) => { t = 5000; return { decision: 'ALLOW', contextHash: ctx.contextHash }; },
        }, call());
        assert.equal(await outcomeOf(sign(gated)), 'TIMEOUT');
        assert.equal(calls.length, 0);
    });

    test('a decision for one auth entry does not authorize another (engine cache/replay)', async () => {
        const { calls, signer } = instrumentedSigner();
        let cached: string | undefined;
        const gated = createPolicyGatedSigner(signer, {
            evaluate: async (ctx) => { cached ??= ctx.contextHash; return { decision: 'ALLOW', contextHash: cached }; },
        }, call());
        assert.equal(await outcomeOf(sign(gated, transferEntry({ nonce: 1n }))), 'SIGNED');
        assert.equal(await outcomeOf(sign(gated, transferEntry({ nonce: 2n }))), 'UNBOUND');
        assert.equal(calls.length, 1);
    });

    test('ALLOW without contextHash: no signature', async () => {
        const { calls, signer } = instrumentedSigner();
        const gated = createPolicyGatedSigner(signer, { evaluate: async () => ({ decision: 'ALLOW' }) }, call());
        assert.equal(await outcomeOf(sign(gated)), 'UNBOUND');
        assert.equal(calls.length, 0);
    });

    for (const [label, bad] of [
        ['null', null], ['empty', {}], ['lowercase', { decision: 'allow' }],
    ] as const) test(`malformed answer (${label}): no signature`, async () => {
        const { calls, signer } = instrumentedSigner();
        const gated = createPolicyGatedSigner(signer, { evaluate: async () => bad as any }, call());
        assert.equal(await outcomeOf(sign(gated)), 'MALFORMED');
        assert.equal(calls.length, 0);
    });

    test('expiresAt that is not epoch ms: no signature', async () => {
        const { calls, signer } = instrumentedSigner();
        const gated = createPolicyGatedSigner(signer, { evaluate: allow({ expiresAt: '2099-01-01' }) }, call());
        assert.equal(await outcomeOf(sign(gated)), 'MALFORMED');
        assert.equal(calls.length, 0);
    });

    test('the engine cannot rewrite what gets signed (frozen context)', async () => {
        const { calls, signer } = instrumentedSigner();
        let original = '';
        const gated = createPolicyGatedSigner(signer, {
            evaluate: async (ctx) => {
                original = ctx.authorization.preimageXdr;
                assert.throws(() => { (ctx.authorization as any).preimageXdr = 'AAAA'; });
                return { decision: 'ALLOW', contextHash: ctx.contextHash };
            },
        }, call());
        await sign(gated);
        assert.equal(calls[0], original);
    });

    test('mutating the decision object after returning it cannot extend it', async () => {
        const { calls, signer } = instrumentedSigner();
        let t = 1000;
        const decision: any = {};
        const gated = createPolicyGatedSigner(signer, {
            now: () => t,
            evaluate: async (ctx) => Object.assign(decision, { decision: 'ALLOW', contextHash: ctx.contextHash, policyVersion: 'v7', expiresAt: 2000 }),
            currentVersion: async () => { decision.expiresAt = 9999; t = 2000; return 'v7'; },
        }, call());
        assert.equal(await outcomeOf(sign(gated)), 'EXPIRED');
        assert.equal(calls.length, 0);
    });

    test('a throwing onDecision observer does not change the outcome', async () => {
        const { calls, signer } = instrumentedSigner();
        const gated = createPolicyGatedSigner(signer, {
            evaluate: async () => ({ decision: 'DENY' }), onDecision: () => { throw new Error('boom'); },
        }, call());
        assert.equal(await outcomeOf(sign(gated)), 'DENY');
        assert.equal(calls.length, 0);
    });

    test('concurrency: each call stays bound to its own decision', async () => {
        const { calls, signer } = instrumentedSigner();
        const hashes = new Map<string, string>();
        // Engine that tries to hand B the decision made for A.
        const engine: X402PolicyHook['evaluate'] = async (ctx) => {
            hashes.set(ctx.url, ctx.contextHash);
            await delay(5);
            return { decision: 'ALLOW', contextHash: hashes.get('https://a.example')! };
        };
        const a = createPolicyGatedSigner(signer, { evaluate: engine }, call('https://a.example'));
        const b = createPolicyGatedSigner(signer, { evaluate: engine }, call('https://b.example'));
        const out = await Promise.all([outcomeOf(sign(a)), outcomeOf(sign(b))]);
        assert.deepEqual(out, ['SIGNED', 'UNBOUND']);
        assert.equal(calls.length, 1);
    });

    test('fractionation: the gate obeys an aggregate cap held by the engine', async () => {
        const { calls, signer } = instrumentedSigner();
        let spent = 0n;
        const engine: X402PolicyHook['evaluate'] = async (ctx) => {
            const amt = BigInt(ctx.authorization.amount);
            if (spent + amt > 2000n) return { decision: 'DENY', reason: 'aggregate cap' };
            spent += amt;
            return { decision: 'ALLOW', contextHash: ctx.contextHash };
        };
        const outs: string[] = [];
        for (let i = 0; i < 5; i++) {
            const gated = createPolicyGatedSigner(signer, { evaluate: engine }, call('https://api.example/paid', reqs({ amount: '499' })));
            outs.push(await outcomeOf(sign(gated, transferEntry({ amount: '499' }))));
        }
        assert.deepEqual(outs, ['SIGNED', 'SIGNED', 'SIGNED', 'SIGNED', 'DENY']);
        assert.equal(calls.length, 4);
    });
});

describe('expiry (stale ALLOW, without a version source)', () => {
    test('expired ALLOW does not sign and keeps policyVersion on the error', async () => {
        const { calls, signer } = instrumentedSigner();
        const gated = createPolicyGatedSigner(signer, { evaluate: allow({ policyVersion: 'v7', expiresAt: Date.now() - 1 }) }, call());
        const err = await sign(gated).catch((e) => e);
        assert.equal(err.outcome, 'EXPIRED');
        assert.equal(err.decision.policyVersion, 'v7');
        assert.equal(calls.length, 0);
    });

    test('expiresAt equal to now counts as expired', async () => {
        const { calls, signer } = instrumentedSigner();
        const gated = createPolicyGatedSigner(signer, { now: () => 2000, evaluate: allow({ expiresAt: 2000 }) }, call());
        assert.equal(await outcomeOf(sign(gated)), 'EXPIRED');
        assert.equal(calls.length, 0);
    });

    test('requireExpiry: ALLOW without expiresAt does not sign; with a future one it does', async () => {
        const a = instrumentedSigner();
        assert.equal(await outcomeOf(sign(createPolicyGatedSigner(a.signer, { requireExpiry: true, evaluate: allow() }, call()))), 'EXPIRED');
        assert.equal(a.calls.length, 0);
        const b = instrumentedSigner();
        assert.equal(await outcomeOf(sign(createPolicyGatedSigner(b.signer, { requireExpiry: true, evaluate: allow({ expiresAt: Date.now() + 10_000 }) }, call()))), 'SIGNED');
        assert.equal(b.calls.length, 1);
    });

    test('without currentVersion, policyVersion is opaque and not required', async () => {
        const { calls, signer } = instrumentedSigner();
        const gated = createPolicyGatedSigner(signer, { evaluate: allow() }, call());
        assert.equal(await outcomeOf(sign(gated)), 'SIGNED');
        assert.equal(calls.length, 1);
    });
});

describe('currentVersion: stale-ALLOW check right before signing', () => {
    const versioned = (extra = {}) => allow({ policyVersion: 'v7', ...extra });

    test('ALLOW under the current version signs once, and the source is read once', async () => {
        const { calls, signer } = instrumentedSigner();
        let reads = 0;
        const gated = createPolicyGatedSigner(signer, {
            evaluate: versioned(), currentVersion: async () => { reads++; return 'v7'; },
        }, call());
        assert.equal(await outcomeOf(sign(gated)), 'SIGNED');
        assert.equal(reads, 1);
        assert.equal(calls.length, 1);
    });

    test('version changed between decision and signing: STALE, zero signer calls', async () => {
        const { calls, signer } = instrumentedSigner();
        let current = 'v7';
        const gated = createPolicyGatedSigner(signer, {
            evaluate: async (ctx) => { const d = await versioned()(ctx, { signal: new AbortController().signal }); current = 'v8'; return d; },
            currentVersion: async () => current,
        }, call());
        const err = await sign(gated).catch((e) => e);
        assert.equal(err.outcome, 'STALE');
        assert.equal(err.decision.policyVersion, 'v7');
        assert.equal(calls.length, 0);
    });

    test('source rejects: VERSION_UNAVAILABLE, zero signer calls', async () => {
        const { calls, signer } = instrumentedSigner();
        const gated = createPolicyGatedSigner(signer, {
            evaluate: versioned(), currentVersion: async () => { throw new Error('source offline'); },
        }, call());
        assert.equal(await outcomeOf(sign(gated)), 'VERSION_UNAVAILABLE');
        assert.equal(calls.length, 0);
    });

    for (const [label, value] of [['empty', ''], ['blank', '   '], ['not a string', 7]] as const) test(`source returns ${label}: VERSION_UNAVAILABLE`, async () => {
        const { calls, signer } = instrumentedSigner();
        const gated = createPolicyGatedSigner(signer, {
            evaluate: versioned(), currentVersion: async () => value as any,
        }, call());
        assert.equal(await outcomeOf(sign(gated)), 'VERSION_UNAVAILABLE');
        assert.equal(calls.length, 0);
    });

    test('source never resolves: TIMEOUT within the same deadline, zero signer calls', async () => {
        const { calls, signer } = instrumentedSigner();
        let aborted = false;
        const gated = createPolicyGatedSigner(signer, {
            timeoutMs: 20, evaluate: versioned(),
            currentVersion: (_c, { signal }) => new Promise(() => { signal.addEventListener('abort', () => { aborted = true; }); }),
        }, call());
        const err = await sign(gated).catch((e) => e);
        assert.equal(err.outcome, 'TIMEOUT');
        assert.equal(err.message, 'x402 policy TIMEOUT: no current policy version within 20 ms');
        assert.equal(calls.length, 0);
        assert.equal(aborted, true);
    });

    test('ALLOW without policyVersion when a source is configured: MALFORMED, source not read', async () => {
        const { calls, signer } = instrumentedSigner();
        let reads = 0;
        const gated = createPolicyGatedSigner(signer, {
            evaluate: allow(), currentVersion: async () => { reads++; return 'v7'; },
        }, call());
        assert.equal(await outcomeOf(sign(gated)), 'MALFORMED');
        assert.equal(reads, 0);
        assert.equal(calls.length, 0);
    });

    test('expiry is rechecked after the source is read', async () => {
        const { calls, signer } = instrumentedSigner();
        let t = 1000;
        const gated = createPolicyGatedSigner(signer, {
            now: () => t, evaluate: versioned({ expiresAt: 2000 }),
            currentVersion: async () => { t = 2000; return 'v7'; },
        }, call());
        assert.equal(await outcomeOf(sign(gated)), 'EXPIRED');
        assert.equal(calls.length, 0);
    });

    test('already-expired ALLOW is refused before the source is read', async () => {
        const { calls, signer } = instrumentedSigner();
        let reads = 0;
        const gated = createPolicyGatedSigner(signer, {
            now: () => 3000, evaluate: versioned({ expiresAt: 2000 }),
            currentVersion: async () => { reads++; return 'v7'; },
        }, call());
        assert.equal(await outcomeOf(sign(gated)), 'EXPIRED');
        assert.equal(reads, 0);
        assert.equal(calls.length, 0);
    });

    test('concurrent revision: A checked at v7 signs, B checked at v8 does not', async () => {
        const { calls, signer } = instrumentedSigner();
        let current = 'v7';
        const gate: Record<string, () => void> = {};
        const source: X402PolicyHook['currentVersion'] = (ctx) =>
            new Promise((r) => { gate[ctx.url] = () => r(current); });
        const a = createPolicyGatedSigner(signer, { evaluate: versioned(), currentVersion: source }, call('https://a.example'));
        const b = createPolicyGatedSigner(signer, { evaluate: versioned(), currentVersion: source }, call('https://b.example'));
        const pa = outcomeOf(sign(a));
        const pb = outcomeOf(sign(b));
        while (!gate['https://a.example'] || !gate['https://b.example']) await delay(1);
        gate['https://a.example']();
        assert.equal(await pa, 'SIGNED');
        current = 'v8';
        gate['https://b.example']();
        assert.equal(await pb, 'STALE');
        assert.equal(calls.length, 1);
    });
});

describe('signer identity', () => {
    test('base signer address changes while the policy is evaluated: SIGNER_CHANGED, zero signer calls', async () => {
        const { calls, signer } = instrumentedSigner();
        const gated = createPolicyGatedSigner(signer, {
            evaluate: async (ctx) => { signer.address = Keypair.random().publicKey(); return { decision: 'ALLOW', contextHash: ctx.contextHash }; },
        }, call());
        assert.equal(await outcomeOf(sign(gated)), 'SIGNER_CHANGED');
        assert.equal(calls.length, 0);
    });

    test('base signer address changes while the version source is read: SIGNER_CHANGED', async () => {
        const { calls, signer } = instrumentedSigner();
        const gated = createPolicyGatedSigner(signer, {
            evaluate: allow({ policyVersion: 'v7' }),
            currentVersion: async () => { signer.address = Keypair.random().publicKey(); return 'v7'; },
        }, call());
        assert.equal(await outcomeOf(sign(gated)), 'SIGNER_CHANGED');
        assert.equal(calls.length, 0);
    });

    test('base signer address changed before the call: SIGNER_CHANGED without consulting the policy', async () => {
        const { calls, signer } = instrumentedSigner();
        let asked = 0;
        const gated = createPolicyGatedSigner(signer, { evaluate: async (ctx) => { asked++; return { decision: 'ALLOW', contextHash: ctx.contextHash }; } }, call());
        signer.address = Keypair.random().publicKey();
        assert.equal(await outcomeOf(sign(gated)), 'SIGNER_CHANGED');
        assert.equal(asked, 0);
        assert.equal(calls.length, 0);
    });
});

describe('rejected before the policy is consulted', () => {
    test('authorization that does not match the requirements', async () => {
        const { calls, signer } = instrumentedSigner();
        let asked = 0;
        const gated = createPolicyGatedSigner(signer, { evaluate: async (ctx) => { asked++; return { decision: 'ALLOW', contextHash: ctx.contextHash }; } }, call());
        assert.equal(await outcomeOf(sign(gated, transferEntry({ amount: '999999999' }))), 'CONTEXT_MISMATCH');
        assert.equal(await outcomeOf(sign(gated, transferEntry({ to: Keypair.random().publicKey() }))), 'CONTEXT_MISMATCH');
        assert.equal(await outcomeOf(sign(gated, transferEntry({ sub: true }))), 'CONTEXT_MISMATCH');
        assert.equal(await outcomeOf(sign(gated, transferEntry(), Networks.PUBLIC)), 'CONTEXT_MISMATCH');
        assert.equal(asked, 0);
        assert.equal(calls.length, 0);
    });

    test('self-escalation: an invocation that is not transfer (e.g. set_admin)', async () => {
        const { calls, signer } = instrumentedSigner();
        let asked = 0;
        const gated = createPolicyGatedSigner(signer, { evaluate: async (ctx) => { asked++; return { decision: 'ALLOW', contextHash: ctx.contextHash }; } }, call());
        assert.equal(await outcomeOf(sign(gated, transferEntry({ fn: 'set_admin' }))), 'CONTEXT_MISMATCH');
        assert.equal(asked, 0);
        assert.equal(calls.length, 0);
    });

    test('transfer.from different from the signer', async () => {
        const { calls, signer } = instrumentedSigner();
        const other = Keypair.random();
        const gated = createPolicyGatedSigner({ ...signer, address: other.publicKey() }, { evaluate: allow() }, call());
        const pre = xdr.HashIdPreimage.envelopeTypeSorobanAuthorization(new xdr.HashIdPreimageSorobanAuthorization({
            networkId: hash(Buffer.from(Networks.TESTNET)), nonce: xdr.Int64.fromString('5'),
            signatureExpirationLedger: LEDGER, invocation: invocation({}),
        })).toXDR('base64');
        assert.equal(await outcomeOf(gated.signAuthEntry(pre, { address: other.publicKey() })), 'CONTEXT_MISMATCH');
        assert.equal(calls.length, 0);
    });
});

describe('CAP-71 preimage (…WithAddress, stellar-sdk >= 16)', () => {
    const cap71 = (address: string) => xdr.HashIdPreimage.envelopeTypeSorobanAuthorizationWithAddress(
        new xdr.HashIdPreimageSorobanAuthorizationWithAddress({
            networkId: hash(Buffer.from(Networks.TESTNET)),
            nonce: xdr.Int64.fromString('7'),
            invocation: invocation({}),
            address: new Address(address).toScAddress(),
            signatureExpirationLedger: LEDGER,
        }),
    ).toXDR('base64');

    test('bound to the signer: decoded and evaluated', async () => {
        const { calls, signer } = instrumentedSigner();
        let seen: X402PolicyContext | undefined;
        const gated = createPolicyGatedSigner(signer, { evaluate: async (ctx) => { seen = ctx; return { decision: 'ALLOW', contextHash: ctx.contextHash }; } }, call());
        assert.equal(await outcomeOf(gated.signAuthEntry(cap71(payer.publicKey()), { address: payer.publicKey() })), 'SIGNED');
        assert.equal(seen!.authorization.preimageType, 'cap71');
        assert.equal(calls.length, 1);
    });

    test('bound to another address: rejected before the policy', async () => {
        const { calls, signer } = instrumentedSigner();
        let asked = 0;
        const gated = createPolicyGatedSigner(signer, { evaluate: async (ctx) => { asked++; return { decision: 'ALLOW', contextHash: ctx.contextHash }; } }, call());
        assert.equal(await outcomeOf(gated.signAuthEntry(cap71(Keypair.random().publicKey()), { address: payer.publicKey() })), 'CONTEXT_MISMATCH');
        assert.equal(asked, 0);
        assert.equal(calls.length, 0);
    });
});

// El gate no verifica la firma que devuelve el signer: esa garantía la da
// stellar-sdk >= 16, cuyo authorizeEntry comprueba la firma contra
// sha256(preimage) antes de meterla en el entry. Si alguien baja el piso de
// stellar-sdk o cambia el camino de firma, esto tiene que fallar.
describe('signature/preimage mismatch is rejected by stellar-sdk, not by the gate', () => {
    const mutateAmount = (preimageXdr: string) => {
        const p: any = xdr.HashIdPreimage.fromXdr(preimageXdr, 'base64');
        p.sorobanAuthorization.invocation.function.contractFn.args[2] = nativeToScVal('999', { type: 'i128' });
        return p.toXdr('base64');
    };

    test('a signature over altered bytes never becomes a signed entry', async () => {
        const { calls, signer } = instrumentedSigner({ mutate: mutateAmount });
        const gated = createPolicyGatedSigner(signer, { evaluate: allow() }, call());
        await assert.rejects(sign(gated), (e: any) => e.message.includes("signature doesn't match payload"));
        assert.equal(calls.length, 1);
    });

    test('a signature by a different key never becomes a signed entry', async () => {
        const intruder = Keypair.random();
        const signer = {
            address: payer.publicKey(),
            signAuthEntry: async (preimageXdr: string) => ({
                signedAuthEntry: Buffer.from(intruder.sign(hash(xdr.HashIdPreimage.fromXdr(preimageXdr, 'base64').toXdr()))).toString('base64'),
            }),
        };
        const gated = createPolicyGatedSigner(signer, { evaluate: allow() }, call());
        await assert.rejects(sign(gated), (e: any) => e.message.includes("signature doesn't match payload"));
    });
});

describe('timeout budget', () => {
    test('never more than half the payment window', () => {
        assert.equal(effectiveTimeoutMs({ evaluate: allow() }, 60), 5000);
        assert.equal(effectiveTimeoutMs({ evaluate: allow() }, 4), 2000);
        assert.equal(effectiveTimeoutMs({ evaluate: allow(), timeoutMs: 100 }, 60), 100);
        assert.equal(effectiveTimeoutMs({ evaluate: allow() }, undefined), 5000);
    });
});

describe('clock (fails closed when it is not a finite number)', () => {
    // Antes: now() => NaN dejaba falsas todas las comparaciones y el pago se firmaba.
    const bad: Array<[string, unknown]> = [
        ['NaN', NaN], ['undefined', undefined], ['null', null], ['a numeric string', '123'],
        ['Infinity', Infinity], ['-Infinity', -Infinity],
    ];

    for (const [label, value] of bad) test(`now() returns ${label} from the start: CLOCK_INVALID, policy not consulted, zero signer calls`, async () => {
        const { calls, signer } = instrumentedSigner();
        let asked = 0;
        const gated = createPolicyGatedSigner(signer, {
            now: () => value as any,
            evaluate: async (ctx) => { asked++; return { decision: 'ALLOW', contextHash: ctx.contextHash }; },
        }, call());
        assert.equal(await outcomeOf(sign(gated)), 'CLOCK_INVALID');
        assert.equal(asked, 0);
        assert.equal(calls.length, 0);
    });

    for (const [label, value] of bad) for (const withExpiry of [false, true]) {
        test(`now() turns ${label} after the policy answered${withExpiry ? ' (ALLOW carries expiresAt)' : ''}: CLOCK_INVALID, zero signer calls`, async () => {
            const { calls, signer } = instrumentedSigner();
            let reads = 0;
            const gated = createPolicyGatedSigner(signer, {
                now: () => (++reads === 1 ? 1000 : (value as any)),
                evaluate: allow(withExpiry ? { expiresAt: 2000 } : {}),
            }, call());
            assert.equal(await outcomeOf(sign(gated)), 'CLOCK_INVALID');
            assert.equal(calls.length, 0);
        });
    }

    test('now() turns NaN after the version source was read: CLOCK_INVALID, zero signer calls', async () => {
        const { calls, signer } = instrumentedSigner();
        let t: number = 1000;
        const gated = createPolicyGatedSigner(signer, {
            now: () => t, evaluate: allow({ policyVersion: 'v7', expiresAt: 5000 }),
            currentVersion: async () => { t = NaN; return 'v7'; },
        }, call());
        assert.equal(await outcomeOf(sign(gated)), 'CLOCK_INVALID');
        assert.equal(calls.length, 0);
    });

    for (const when of ['first read', 'later read'] as const) test(`now() throws on the ${when}: CLOCK_INVALID, not a raw error`, async () => {
        const { calls, signer } = instrumentedSigner();
        let reads = 0;
        const gated = createPolicyGatedSigner(signer, {
            now: () => { if (++reads === (when === 'first read' ? 1 : 2)) throw new Error('clock offline'); return 1000; },
            evaluate: allow(),
        }, call());
        const err = await sign(gated).catch((e) => e);
        assert.ok(err instanceof X402PolicyError);
        assert.equal(err.outcome, 'CLOCK_INVALID');
        assert.match(err.message, /clock threw \(clock offline\)/);
        assert.equal(calls.length, 0);
    });

    test('the refusal reaches the observer and onRefused', async () => {
        const { signer } = instrumentedSigner();
        const records: X402PolicyRecord[] = [];
        const refused: X402PolicyError[] = [];
        const gated = createPolicyGatedSigner(signer, {
            now: () => NaN, evaluate: allow(), onDecision: (r) => records.push(r),
        }, call(), (e) => refused.push(e));
        await sign(gated).catch(() => {});
        assert.deepEqual(records.map((r) => r.outcome), ['CLOCK_INVALID']);
        assert.equal(refused.length, 1);
        assert.equal(refused[0].outcome, 'CLOCK_INVALID');
    });

    test('a finite clock still signs', async () => {
        const { calls, signer } = instrumentedSigner();
        const gated = createPolicyGatedSigner(signer, { now: () => 1000, evaluate: allow({ expiresAt: 2000 }) }, call());
        assert.equal(await outcomeOf(sign(gated)), 'SIGNED');
        assert.equal(calls.length, 1);
    });

    test('a `now` that is not a function is rejected when the hook is configured', () => {
        assert.throws(() => assertValidPolicyHook({ evaluate: allow(), now: 5 as any }), /policy\.now/);
        assert.doesNotThrow(() => assertValidPolicyHook({ evaluate: allow(), now: () => 1 }));
    });
});

describe('receipts: SIGNED only exists once the signer returned a signature', () => {
    // Antes: SIGNED se registraba justo ANTES de llamar al signer, aunque luego rechazara o fallara.
    const watch = () => {
        const records: X402PolicyRecord[] = [];
        const refused: X402PolicyError[] = [];
        return { records, refused, outcomes: () => records.map((r) => r.outcome), onDecision: (r: X402PolicyRecord) => { records.push(r); } };
    };
    const customSigner = (signAuthEntry: (p: string) => any) => {
        const calls: string[] = [];
        return { calls, signer: { address: payer.publicKey(), signAuthEntry: (p: string) => { calls.push(p); return signAuthEntry(p); } } as any };
    };

    test('success: ALLOWED, then SIGNED only after the signer resolved', async () => {
        const w = watch();
        let release!: () => void;
        const gate = new Promise<void>((r) => { release = r; });
        const base = instrumentedSigner();
        const slow = { address: base.signer.address, signAuthEntry: async (p: string) => { await gate; return base.signer.signAuthEntry(p); } };
        const gated = createPolicyGatedSigner(slow, { evaluate: allow(), onDecision: w.onDecision }, call());
        const pending = sign(gated);
        while (base.calls.length === 0 && w.outcomes().length < 1) await delay(1);
        await delay(10);
        assert.deepEqual(w.outcomes(), ['ALLOWED'], 'signer still running: nothing may say SIGNED yet');
        release();
        await pending;
        assert.deepEqual(w.outcomes(), ['ALLOWED', 'SIGNED']);
        assert.equal(w.records[1].context!.url, 'https://api.example/paid');
        assert.equal(w.records[1].decision!.decision, 'ALLOW');
    });

    test('signer rejects: ALLOWED then SIGNER_ERROR, never SIGNED, and its own error comes through untouched', async () => {
        const w = watch();
        const { calls, signer } = customSigner(async () => { throw new Error('hsm offline'); });
        const gated = createPolicyGatedSigner(signer, { evaluate: allow(), onDecision: w.onDecision }, call(), (e) => w.refused.push(e));
        const err = await sign(gated).catch((e) => e);
        assert.ok(!(err instanceof X402PolicyError), 'a signer failure is not a policy refusal');
        assert.match(err.message, /hsm offline/);
        assert.equal(calls.length, 1);
        assert.deepEqual(w.outcomes(), ['ALLOWED', 'SIGNER_ERROR']);
        assert.equal(w.records[1].error, 'hsm offline');
        assert.equal(w.refused.length, 0);
    });

    test('signer throws synchronously: same records, same untouched error', async () => {
        const w = watch();
        const { calls, signer } = customSigner(() => { throw new Error('sync boom'); });
        const gated = createPolicyGatedSigner(signer, { evaluate: allow(), onDecision: w.onDecision }, call());
        const err = await sign(gated).catch((e) => e);
        assert.ok(!(err instanceof X402PolicyError));
        assert.match(err.message, /sync boom/);
        assert.equal(calls.length, 1);
        assert.deepEqual(w.outcomes(), ['ALLOWED', 'SIGNER_ERROR']);
    });

    const unusable: Array<[string, unknown]> = [
        ['undefined', undefined], ['null', null], ['an empty object', {}],
        ['an empty signedAuthEntry', { signedAuthEntry: '' }], ['a non-string signedAuthEntry', { signedAuthEntry: 7 }],
    ];
    for (const [label, value] of unusable) test(`signer resolves with ${label}: SIGNER_ERROR refusal, never SIGNED`, async () => {
        const w = watch();
        const { calls, signer } = customSigner(async () => value);
        const gated = createPolicyGatedSigner(signer, { evaluate: allow(), onDecision: w.onDecision }, call(), (e) => w.refused.push(e));
        const err = await sign(gated).catch((e) => e);
        assert.ok(err instanceof X402PolicyError);
        assert.equal(err.outcome, 'SIGNER_ERROR');
        assert.equal(err.message, 'x402 policy SIGNER_ERROR: signer returned no signedAuthEntry');
        assert.equal(calls.length, 1);
        assert.deepEqual(w.outcomes(), ['ALLOWED', 'SIGNER_ERROR']);
        assert.equal(w.refused.length, 1);
    });

    test('a refusal before the signer is one record and never mentions ALLOWED or SIGNED', async () => {
        for (const [engine, expected] of [
            [async (ctx: X402PolicyContext) => ({ decision: 'DENY' as const, contextHash: ctx.contextHash }), 'DENY'],
            [async () => ({ decision: 'ALLOW' as const, contextHash: 'nope' }), 'UNBOUND'],
        ] as const) {
            const w = watch();
            const { calls, signer } = instrumentedSigner();
            const gated = createPolicyGatedSigner(signer, { evaluate: engine, onDecision: w.onDecision }, call());
            assert.equal(await outcomeOf(sign(gated)), expected);
            assert.deepEqual(w.outcomes(), [expected]);
            assert.equal(calls.length, 0);
        }
    });
});

describe('observer runs before the final checks (what it provokes is detected)', () => {
    // Antes: el observador corría DESPUES de la última comprobación y justo antes del signer,
    // así que un callback síncrono podía mover el reloj, la versión o la identidad sin que nada lo viera.
    const onAllowed = (fn: () => void, sink: X402PolicyRecord[] = []) => (r: X402PolicyRecord) => {
        sink.push(r);
        if (r.outcome === 'ALLOWED') fn();
    };
    const outcomes = (rs: X402PolicyRecord[]) => rs.map((r) => r.outcome);

    test('observer pushes the injected clock past expiresAt: EXPIRED, zero signer calls', async () => {
        const { calls, signer } = instrumentedSigner();
        const rs: X402PolicyRecord[] = [];
        let t = 1000;
        const gated = createPolicyGatedSigner(signer, {
            now: () => t, evaluate: allow({ expiresAt: 2000 }), onDecision: onAllowed(() => { t = 2000; }, rs),
        }, call());
        assert.equal(await outcomeOf(sign(gated)), 'EXPIRED');
        assert.equal(calls.length, 0);
        assert.deepEqual(outcomes(rs), ['ALLOWED', 'EXPIRED']);
    });

    test('observer pushes the clock past the deadline (no currentVersion configured): TIMEOUT', async () => {
        const { calls, signer } = instrumentedSigner();
        let t = 1000;
        const gated = createPolicyGatedSigner(signer, {
            timeoutMs: 50, now: () => t, evaluate: allow(), onDecision: onAllowed(() => { t = 1050; }),
        }, call());
        assert.equal(await outcomeOf(sign(gated)), 'TIMEOUT');
        assert.equal(calls.length, 0);
    });

    test('observer that makes the clock NaN: CLOCK_INVALID', async () => {
        const { calls, signer } = instrumentedSigner();
        let t = 1000;
        const gated = createPolicyGatedSigner(signer, {
            now: () => t, evaluate: allow({ expiresAt: 2000 }), onDecision: onAllowed(() => { t = NaN; }),
        }, call());
        assert.equal(await outcomeOf(sign(gated)), 'CLOCK_INVALID');
        assert.equal(calls.length, 0);
    });

    test('observer changes the policy version: the later read sees it, STALE', async () => {
        const { calls, signer } = instrumentedSigner();
        const rs: X402PolicyRecord[] = [];
        let current = 'v7';
        const gated = createPolicyGatedSigner(signer, {
            evaluate: allow({ policyVersion: 'v7' }), currentVersion: async () => current,
            onDecision: onAllowed(() => { current = 'v8'; }, rs),
        }, call());
        assert.equal(await outcomeOf(sign(gated)), 'STALE');
        assert.equal(calls.length, 0);
        assert.deepEqual(outcomes(rs), ['ALLOWED', 'STALE']);
    });

    for (const withVersion of [false, true]) test(`observer changes the base signer's address${withVersion ? ' (with currentVersion)' : ''}: SIGNER_CHANGED`, async () => {
        const { calls, signer } = instrumentedSigner();
        const rs: X402PolicyRecord[] = [];
        const gated = createPolicyGatedSigner(signer, {
            evaluate: allow(withVersion ? { policyVersion: 'v7' } : {}),
            ...(withVersion ? { currentVersion: async () => 'v7' } : {}),
            onDecision: onAllowed(() => { signer.address = Keypair.random().publicKey(); }, rs),
        }, call());
        assert.equal(await outcomeOf(sign(gated)), 'SIGNER_CHANGED');
        assert.equal(calls.length, 0);
        assert.deepEqual(outcomes(rs), ['ALLOWED', 'SIGNER_CHANGED']);
    });

    test('a throwing observer is still swallowed and the payment is still decided by the checks', async () => {
        const { calls, signer } = instrumentedSigner();
        const gated = createPolicyGatedSigner(signer, {
            evaluate: allow(), onDecision: (r) => { if (r.outcome === 'ALLOWED') throw new Error('observer bug'); },
        }, call());
        assert.equal(await outcomeOf(sign(gated)), 'SIGNED');
        assert.equal(calls.length, 1);
    });

    test('a harmless observer changes nothing: ALLOWED, SIGNED, one signer call', async () => {
        const { calls, signer } = instrumentedSigner();
        const rs: X402PolicyRecord[] = [];
        const gated = createPolicyGatedSigner(signer, {
            evaluate: allow({ policyVersion: 'v7', expiresAt: Date.now() + 60_000 }), currentVersion: async () => 'v7',
            onDecision: (r) => { rs.push(r); },
        }, call());
        assert.equal(await outcomeOf(sign(gated)), 'SIGNED');
        assert.equal(calls.length, 1);
        assert.deepEqual(outcomes(rs), ['ALLOWED', 'SIGNED']);
    });

    test('a malformed ALLOW (no policyVersion with currentVersion set) is refused before ALLOWED is reported', async () => {
        const { calls, signer } = instrumentedSigner();
        const rs: X402PolicyRecord[] = [];
        const gated = createPolicyGatedSigner(signer, {
            evaluate: allow(), currentVersion: async () => 'v7', onDecision: (r) => { rs.push(r); },
        }, call());
        assert.equal(await outcomeOf(sign(gated)), 'MALFORMED');
        assert.deepEqual(outcomes(rs), ['MALFORMED']);
        assert.equal(calls.length, 0);
    });
});

describe('observer that returns a promise (never awaited, never unhandled)', () => {
    // Antes: un onDecision async que rechazaba escapaba del try/catch y producia un
    // unhandledRejection, que en Node 22 termina el proceso por defecto.
    async function unhandledDuring(run: () => Promise<unknown>): Promise<unknown[]> {
        const seen: unknown[] = [];
        const on = (reason: unknown) => { seen.push(reason); };
        process.on('unhandledRejection', on);
        try {
            await run();
            await delay(30); // las rechazadas sin manejar se notifican tras el microtask y un tick
            await new Promise((r) => setImmediate(r));
        } finally { process.off('unhandledRejection', on); }
        return seen;
    }

    test('async observer that rejects on every record: the payment signs, nothing is unhandled', async () => {
        const { calls, signer } = instrumentedSigner();
        const outs: string[] = [];
        const gated = createPolicyGatedSigner(signer, {
            evaluate: allow(),
            onDecision: async (r) => { outs.push(r.outcome); throw new Error('async observer bug'); },
        }, call());
        let result: string = '';
        const unhandled = await unhandledDuring(async () => { result = await outcomeOf(sign(gated)); });
        assert.deepEqual(unhandled, []);
        assert.equal(result, 'SIGNED');
        assert.equal(calls.length, 1);
        assert.deepEqual(outs, ['ALLOWED', 'SIGNED']);
    });

    test('async observer that rejects on a refusal: the refusal is unchanged, nothing is unhandled', async () => {
        const { calls, signer } = instrumentedSigner();
        const refused: X402PolicyError[] = [];
        const gated = createPolicyGatedSigner(signer, {
            evaluate: async (ctx) => ({ decision: 'DENY', contextHash: ctx.contextHash, reason: 'no' }),
            onDecision: () => Promise.reject(new Error('async observer bug')),
        }, call(), (e) => refused.push(e));
        let result: string = '';
        const unhandled = await unhandledDuring(async () => { result = await outcomeOf(sign(gated)); });
        assert.deepEqual(unhandled, []);
        assert.equal(result, 'DENY');
        assert.equal(refused.length, 1);
        assert.equal(calls.length, 0);
    });

    test('async observer that rejects after a signer failure: the signer error still comes through', async () => {
        const failing = { address: payer.publicKey(), signAuthEntry: async () => { throw new Error('hsm offline'); } } as any;
        const gated = createPolicyGatedSigner(failing, { evaluate: allow(), onDecision: async () => { throw new Error('async observer bug'); } }, call());
        let err: any;
        const unhandled = await unhandledDuring(async () => { err = await sign(gated).catch((e) => e); });
        assert.deepEqual(unhandled, []);
        assert.match(err.message, /hsm offline/);
        assert.ok(!(err instanceof X402PolicyError));
    });

    test('a thenable that rejects, and one whose then() throws: swallowed, payment unchanged', async () => {
        const { calls, signer } = instrumentedSigner();
        const thenables: unknown[] = [
            { then: (_res: unknown, rej: (e: unknown) => void) => rej(new Error('thenable rejected')) },
            { then: () => { throw new Error('then() threw'); } },
            { get then(): never { throw new Error('then getter threw'); } },
        ];
        let i = 0;
        const gated = createPolicyGatedSigner(signer, {
            evaluate: allow(), onDecision: () => thenables[i++ % thenables.length] as any,
        }, call());
        let result: string = '';
        const unhandled = await unhandledDuring(async () => { result = await outcomeOf(sign(gated)); });
        assert.deepEqual(unhandled, []);
        assert.equal(result, 'SIGNED');
        assert.equal(calls.length, 1);
    });

    test('an observer promise that never settles does not delay or block the payment', async () => {
        const { calls, signer } = instrumentedSigner();
        const gated = createPolicyGatedSigner(signer, {
            evaluate: allow(), onDecision: () => new Promise(() => {}),
        }, call());
        const outcome = await Promise.race([outcomeOf(sign(gated)), delay(1000).then(() => 'BLOCKED')]);
        assert.equal(outcome, 'SIGNED');
        assert.equal(calls.length, 1);
    });

    test('a synchronous throw on every record is swallowed exactly as before', async () => {
        const { calls, signer } = instrumentedSigner();
        const gated = createPolicyGatedSigner(signer, {
            evaluate: allow(), onDecision: () => { throw new Error('sync observer bug'); },
        }, call());
        const unhandled = await unhandledDuring(async () => { assert.equal(await outcomeOf(sign(gated)), 'SIGNED'); });
        assert.deepEqual(unhandled, []);
        assert.equal(calls.length, 1);
    });
});

