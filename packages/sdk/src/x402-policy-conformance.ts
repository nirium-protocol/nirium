// ═══════════════════════════════════════════════════════════════
// Conformance suite for pre-sign policy engines (#226).
//
// Any engine that plugs into initX402({ policy }) can run the same seven
// cases through the SDK's real gate (createPolicyGatedSigner) and the real
// stellar-sdk: ALLOW with the exact contextHash, DENY, WAIT, a wrong
// contextHash, an expired expiresAt, a malformed answer and a timeout. Only
// the first one may end in a signature.
//
// The engine supplies two payments: one it must ALLOW and one it must DENY
// (and, optionally, one it must WAIT). The last four cases start from the
// engine's own ALLOW for the allow payment and change it in the way each case
// names, so they check that the engine's answer and the gate together still
// fail closed, without asking the engine to misbehave.
//
// No RPC, no network, nothing broadcast. Experimental, like the hook itself;
// not exported from the package index. Import it from
// `nirium/dist/x402-policy-conformance.js`.
// ═══════════════════════════════════════════════════════════════

import { test as nodeTest } from 'node:test';
import {
    Keypair, Networks, xdr, Address, nativeToScVal, authorizeEntry, hash,
} from '@stellar/stellar-sdk';
import {
    createPolicyGatedSigner, X402PolicyError,
    type X402PolicyHook, type X402PolicyDecision, type X402PolicyRecord,
    type X402PaymentRequirementsView, type X402BaseSigner,
} from './x402-policy';

/** One payment the engine is asked about. Unset fields get test defaults. */
export interface ConformancePayment {
    /** Amount in the asset's base units (USDC has 7 decimals). */
    amount: string;
    /** Destination G... address. Default: a fresh random account. */
    payTo?: string;
    /** Asset contract C... address. Default: testnet USDC. */
    asset?: string;
    /** Default 'https://conformance.test/paid'. */
    url?: string;
    /** Default 'GET'. */
    method?: string;
}

export interface PolicyConformanceTarget {
    /** Used in test names. */
    name: string;
    /**
     * Returns the hook to test. Called once per case, so state such as a spent
     * budget does not leak between cases.
     */
    createHook: () => X402PolicyHook | Promise<X402PolicyHook>;
    /** A payment the engine must ALLOW. */
    allow: ConformancePayment;
    /** A payment the engine must DENY. */
    deny: ConformancePayment;
    /**
     * A payment the engine itself answers WAIT for. Engines that never wait
     * leave it out; the WAIT case then turns the engine's ALLOW into a WAIT.
     */
    wait?: ConformancePayment;
    /** Payer keypair. Default: a fresh random one (never funded). */
    payer?: Keypair;
}

export interface ConformanceOptions {
    /**
     * The gate under test. Default: the SDK's createPolicyGatedSigner. Only the
     * suite's own meta-tests replace it, to prove the refusal cases catch a
     * gate that signs when it should not.
     */
    gate?: typeof createPolicyGatedSigner;
    /** timeoutMs for the timeout case. Default 100. */
    timeoutMs?: number;
}

export interface ConformanceCase {
    name: string;
    run: () => Promise<void>;
}

const USDC_TESTNET = 'CBIELTK6YBZJU5UP2WWQEUCYKLPU6AUNZ2BQ4WWFEIE3USCIHMXQDAMA';

class ConformanceFailure extends Error {
    constructor(message: string) { super(message); this.name = 'ConformanceFailure'; }
}
const check = (cond: unknown, message: string): void => {
    if (!cond) throw new ConformanceFailure(message);
};

let nonceSeq = BigInt(Date.now()) * 1000n;

/** The cases, as plain functions, so they can be run under any test runner. */
export function policyConformanceCases(
    target: PolicyConformanceTarget,
    options: ConformanceOptions = {},
): ConformanceCase[] {
    const gate = options.gate ?? createPolicyGatedSigner;
    const payer = target.payer ?? Keypair.random();
    const defaultPayTo = Keypair.random().publicKey();
    const timeoutMs = options.timeoutMs ?? 100;

    const requirements = (p: ConformancePayment): X402PaymentRequirementsView => ({
        scheme: 'exact', network: 'stellar:testnet', asset: p.asset ?? USDC_TESTNET,
        payTo: p.payTo ?? defaultPayTo, amount: p.amount, maxTimeoutSeconds: 60,
    });

    /** The transfer(from,to,amount) auth entry ExactStellarScheme would ask to sign. */
    const entry = (r: X402PaymentRequirementsView) => new xdr.SorobanAuthorizationEntry({
        credentials: xdr.SorobanCredentials.sorobanCredentialsAddress(new xdr.SorobanAddressCredentials({
            address: new Address(payer.publicKey()).toScAddress(),
            nonce: xdr.Int64.fromString(String(nonceSeq++)),
            signatureExpirationLedger: 0,
            signature: xdr.ScVal.scvVoid(),
        })),
        rootInvocation: new xdr.SorobanAuthorizedInvocation({
            function: xdr.SorobanAuthorizedFunction.sorobanAuthorizedFunctionTypeContractFn(new xdr.InvokeContractArgs({
                contractAddress: new Address(r.asset).toScAddress(),
                functionName: 'transfer',
                args: [
                    nativeToScVal(payer.publicKey(), { type: 'address' }),
                    nativeToScVal(r.payTo, { type: 'address' }),
                    nativeToScVal(r.amount, { type: 'i128' }),
                ],
            })),
            subInvocations: [],
        }),
    });

    interface Attempt {
        signed: boolean;
        signerCalls: number;
        error?: unknown;
        records: X402PolicyRecord[];
        /** What the engine itself answered, before any change a case makes. */
        engineDecisions: X402PolicyDecision[];
        contextHashes: string[];
    }

    /**
     * Runs one payment through the gate. `alter` changes the engine's answer
     * (or the hook) the way a case needs; the engine is still asked first.
     */
    const attempt = async (
        p: ConformancePayment,
        alter?: (hook: X402PolicyHook, seen: Attempt) => X402PolicyHook,
    ): Promise<Attempt> => {
        const seen: Attempt = { signed: false, signerCalls: 0, records: [], engineDecisions: [], contextHashes: [] };
        const engine = await target.createHook();
        const userOnDecision = engine.onDecision;
        let hook: X402PolicyHook = {
            ...engine,
            evaluate: async (ctx, opts) => {
                seen.contextHashes.push(ctx.contextHash);
                const d = await engine.evaluate(ctx, opts);
                seen.engineDecisions.push(d);
                return d;
            },
            onDecision: (r) => { seen.records.push(r); return userOnDecision?.(r); },
        };
        if (alter) hook = alter(hook, seen);
        const base: X402BaseSigner = {
            address: payer.publicKey(),
            signAuthEntry: async (preimageXdr) => {
                seen.signerCalls++;
                const pre = xdr.HashIdPreimage.fromXDR(preimageXdr, 'base64');
                return { signedAuthEntry: payer.sign(hash(pre.toXDR())).toString('base64'), signerAddress: payer.publicKey() };
            },
        };
        const r = requirements(p);
        const call = { url: p.url ?? 'https://conformance.test/paid', method: p.method ?? 'GET', requirements: r };
        const gated = gate(base, hook, () => call);
        try {
            // What stellar-sdk's signAuthEntries does: it also verifies the
            // returned signature against sha256(preimage).
            await authorizeEntry(entry(r), async (preimage: any) => {
                const { signedAuthEntry } = await gated.signAuthEntry(preimage.toXDR('base64'), { address: payer.publicKey() });
                return Buffer.from(signedAuthEntry, 'base64');
            }, 1_000_000, Networks.TESTNET);
            seen.signed = true;
        } catch (e) {
            seen.error = e;
        }
        return seen;
    };

    const describeError = (e: unknown) =>
        e instanceof X402PolicyError ? `${e.outcome}: ${e.message}` : String((e as any)?.message ?? e);

    /** A refusal case: nothing signed, the gate refused with `outcome`. */
    const expectRefused = (a: Attempt, outcome: string) => {
        check(a.signerCalls === 0, `expected no signature (${outcome}), but the signer was called ${a.signerCalls} time(s)`);
        check(!a.signed, `expected no signature (${outcome}), but the authorization was signed`);
        check(a.error instanceof X402PolicyError,
            `expected X402PolicyError ${outcome}, got ${a.error === undefined ? 'no error' : describeError(a.error)}`);
        check((a.error as X402PolicyError).outcome === outcome,
            `expected outcome ${outcome}, got ${describeError(a.error)}`);
        check(!a.records.some((r) => r.outcome === 'SIGNED'), `onDecision saw SIGNED in a ${outcome} case`);
    };

    /** The altered cases only mean something if the engine allowed first. */
    const expectEngineAllowed = (a: Attempt) => {
        const d = a.engineDecisions[0];
        check(d?.decision === 'ALLOW',
            `the engine must ALLOW target.allow for this case to mean anything; it answered ${d ? JSON.stringify(d.decision) : 'nothing'}`);
    };

    /**
     * Replaces the engine's ALLOW with `change(allow)`; other answers pass
     * through. Unless the case is about the hash, the ALLOW is bound to this
     * context first, so each case tests only the fault it names (an engine
     * that gets the hash wrong already fails the ALLOW case).
     */
    const rewriteAllow = (change: (d: X402PolicyDecision) => unknown, keepHash = false) =>
        (hook: X402PolicyHook): X402PolicyHook => ({
            ...hook,
            evaluate: async (ctx, opts) => {
                const d = await hook.evaluate(ctx, opts);
                if (d?.decision !== 'ALLOW') return d;
                return change(keepHash ? d : { ...d, contextHash: ctx.contextHash }) as X402PolicyDecision;
            },
        });

    const cases: ConformanceCase[] = [
        {
            name: 'ALLOW with the exact contextHash signs exactly once',
            run: async () => {
                const a = await attempt(target.allow);
                const d = a.engineDecisions[0];
                check(d !== undefined, 'the engine was never asked');
                check(d.decision === 'ALLOW', `expected the engine to ALLOW target.allow, it answered ${JSON.stringify(d.decision)}${d.reason ? ` (${d.reason})` : ''}`);
                check(d.contextHash === a.contextHashes[0],
                    `ALLOW must echo ctx.contextHash exactly: got ${JSON.stringify(d.contextHash)}, expected ${a.contextHashes[0]}`);
                check(a.signed && a.error === undefined, `expected a signature, got ${describeError(a.error)}`);
                check(a.signerCalls === 1, `expected the signer to be called once, it was called ${a.signerCalls} time(s)`);
                const outcomes = a.records.map((r) => r.outcome).join(',');
                check(outcomes === 'ALLOWED,SIGNED', `expected onDecision ALLOWED,SIGNED, got ${outcomes || 'nothing'}`);
            },
        },
        {
            name: 'DENY signs nothing',
            run: async () => {
                const a = await attempt(target.deny);
                check(a.engineDecisions[0]?.decision === 'DENY',
                    `expected the engine to DENY target.deny, it answered ${JSON.stringify(a.engineDecisions[0]?.decision)}`);
                expectRefused(a, 'DENY');
            },
        },
        {
            name: target.wait ? 'WAIT signs nothing' : 'WAIT signs nothing (engine ALLOW turned into WAIT)',
            run: async () => {
                if (target.wait) {
                    const a = await attempt(target.wait);
                    check(a.engineDecisions[0]?.decision === 'WAIT',
                        `expected the engine to WAIT on target.wait, it answered ${JSON.stringify(a.engineDecisions[0]?.decision)}`);
                    expectRefused(a, 'WAIT');
                    return;
                }
                const a = await attempt(target.allow, rewriteAllow((d) => ({ ...d, decision: 'WAIT', reason: 'conformance: wait' })));
                expectEngineAllowed(a);
                expectRefused(a, 'WAIT');
            },
        },
        {
            name: 'ALLOW with a wrong contextHash signs nothing',
            run: async () => {
                const a = await attempt(target.allow, rewriteAllow((d) => ({
                    ...d,
                    contextHash: typeof d.contextHash === 'string' && d.contextHash.length > 0
                        ? (d.contextHash[0] === '0' ? '1' : '0') + d.contextHash.slice(1)
                        : '0'.repeat(64),
                }), true));
                expectEngineAllowed(a);
                expectRefused(a, 'UNBOUND');
            },
        },
        {
            name: 'ALLOW with an expired expiresAt signs nothing',
            run: async () => {
                const a = await attempt(target.allow, rewriteAllow((d) => ({ ...d, expiresAt: Date.now() - 1 })));
                expectEngineAllowed(a);
                expectRefused(a, 'EXPIRED');
            },
        },
        // Several shapes, each a separate gate run.
        ...([
            ['no decision object', () => null],
            ['an unknown verdict', (d: X402PolicyDecision) => ({ ...d, decision: 'allow' })],
            ['a non-numeric expiresAt', (d: X402PolicyDecision) => ({ ...d, expiresAt: 'soon' })],
        ] as Array<[string, (d: X402PolicyDecision) => unknown]>).map(([what, change]) => ({
            name: `a malformed answer (${what}) signs nothing`,
            run: async () => {
                const a = await attempt(target.allow, rewriteAllow(change));
                expectEngineAllowed(a);
                expectRefused(a, 'MALFORMED');
            },
        })),
        {
            name: 'an answer after the timeout signs nothing',
            run: async () => {
                let aborted = false;
                const a = await attempt(target.allow, (hook) => ({
                    ...hook,
                    timeoutMs,
                    evaluate: async (ctx, opts) => {
                        const d = await hook.evaluate(ctx, opts);
                        // The engine answered; the answer just never arrives in time.
                        await new Promise<void>((resolve) => {
                            const t = setTimeout(resolve, timeoutMs * 20);
                            opts.signal.addEventListener('abort', () => { aborted = true; clearTimeout(t); resolve(); }, { once: true });
                        });
                        return d;
                    },
                }));
                expectEngineAllowed(a);
                expectRefused(a, 'TIMEOUT');
                check(aborted, 'the gate did not abort the engine signal on timeout');
            },
        },
    ];
    return cases;
}

/**
 * Registers every case as a node:test test. Call it at the top level of a
 * test file:
 *
 *     runPolicyConformance({ name: 'my engine', createHook, allow, deny });
 */
export function runPolicyConformance(
    target: PolicyConformanceTarget,
    options: ConformanceOptions & { test?: (name: string, fn: () => Promise<void>) => unknown } = {},
): void {
    const register = options.test ?? ((name: string, fn: () => Promise<void>) => nodeTest(name, fn));
    for (const c of policyConformanceCases(target, options)) {
        register(`policy conformance (${target.name}): ${c.name}`, c.run);
    }
}
