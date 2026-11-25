// Pre-sign policy hook backed by an Open Policy Agent server (#142).
// Reference example; see README for what it does NOT solve.
//
// Fail-closed by construction: anything other than a well-formed OPA answer
// throws, and the SDK turns a throw (or a timeout) into "nothing signed".
// Nothing here catches those errors.

import type { X402PolicyContext, X402PolicyDecision, X402PolicyHook } from 'nirium';

export interface OpaPolicyConfig {
    /** OPA base URL, e.g. http://127.0.0.1:8181 */
    url: string;
    /** Data API path of the decision rule. Default 'nirium/x402/decision'. */
    path?: string;
    /** Bundle name as OPA reports it in provenance (the --bundle argument). Default 'policy'. */
    bundle?: string;
    /** How long an ALLOW stays valid, in ms. Keep it short. Default 2000. */
    ttlMs?: number;
    /** Injectable fetch and clock, for tests. */
    fetch?: typeof fetch;
    now?: () => number;
}

/** What is sent to OPA as `input`. */
export interface OpaInput {
    amount: string;
    destination: string;
    asset: string;
    network: string;
    agent: string;
}

export function toOpaInput(ctx: X402PolicyContext): OpaInput {
    return {
        amount: ctx.authorization.amount,
        destination: ctx.authorization.to,
        asset: ctx.authorization.contractId,
        network: ctx.requirements.network,
        agent: ctx.signer,
    };
}

export class OpaPolicy {
    private readonly cfg: Required<Omit<OpaPolicyConfig, 'fetch' | 'now'>>;
    private readonly fetch: typeof fetch;
    private readonly now: () => number;

    constructor(config: OpaPolicyConfig) {
        this.cfg = { path: 'nirium/x402/decision', bundle: 'policy', ttlMs: 2_000, ...config };
        this.fetch = config.fetch ?? globalThis.fetch;
        this.now = config.now ?? Date.now;
    }

    private endpoint(): string {
        return `${this.cfg.url.replace(/\/+$/, '')}/v1/data/${this.cfg.path}?provenance`;
    }

    /** POST to the Data API; returns the parsed body or throws. */
    private async query(input: OpaInput | undefined, signal: AbortSignal): Promise<{ result: unknown; revision: string }> {
        const res = await this.fetch(this.endpoint(), {
            method: 'POST',
            headers: { 'content-type': 'application/json' },
            body: JSON.stringify(input === undefined ? {} : { input }),
            signal,
        });
        if (res.status !== 200) throw new Error(`OPA answered HTTP ${res.status}`);
        const body: any = await res.json(); // throws on non-JSON
        const revision = body?.provenance?.bundles?.[this.cfg.bundle]?.revision;
        if (typeof revision !== 'string' || revision === '') {
            throw new Error(`OPA answer has no revision for bundle "${this.cfg.bundle}"`);
        }
        return { result: body.result, revision };
    }

    async evaluate(ctx: X402PolicyContext, opts: { signal: AbortSignal }): Promise<X402PolicyDecision> {
        const { result, revision } = await this.query(toOpaInput(ctx), opts.signal);
        const r = result as { allow?: unknown; reason?: unknown } | undefined;
        if (typeof r !== 'object' || r === null || typeof r.allow !== 'boolean') {
            throw new Error('OPA result is not {allow: boolean}'); // undefined rule, wrong shape, ...
        }
        if (r.reason !== undefined && typeof r.reason !== 'string') throw new Error('OPA reason is not a string');
        if (!r.allow) return { decision: 'DENY', reason: (r.reason as string) ?? 'denied by OPA', policyVersion: revision };
        return {
            decision: 'ALLOW',
            contextHash: ctx.contextHash, // exact echo: binds this ALLOW to this authorization
            policyVersion: revision,
            expiresAt: this.now() + this.cfg.ttlMs,
            decisionId: `${revision}:${ctx.authorization.nonce}`,
        };
    }

    /** The bundle revision OPA has loaded right now. */
    async currentVersion(opts: { signal: AbortSignal }): Promise<string> {
        return (await this.query(undefined, opts.signal)).revision;
    }

    /** The object to pass as `initX402({ policy })`. */
    hook(extra: Partial<Pick<X402PolicyHook, 'onDecision' | 'timeoutMs'>> = {}): X402PolicyHook {
        return {
            evaluate: (ctx, opts) => this.evaluate(ctx, opts),
            currentVersion: (_ctx, opts) => this.currentVersion(opts),
            requireExpiry: true,
            ...extra,
        };
    }
}
