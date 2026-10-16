// Per-agent daily spend cap for the pre-sign policy hook of initX402({ policy }).
// Reference example for #127; see README for what it does NOT solve.

import type { X402PolicyContext, X402PolicyDecision, X402PolicyHook } from 'nirium';
import { InMemoryBudgetStore, type BudgetStore } from './budget-store.ts';

export interface DailyBudgetConfig {
    /** Default daily cap per agent (signer address), in the asset's base units. */
    dailyCap: bigint;
    /** Optional per-agent overrides. */
    caps?: Record<string, bigint>;
    /** How long an ALLOW stays valid, in ms. Keep it short. Default 2000. */
    ttlMs?: number;
    store?: BudgetStore;
    /** Injectable clock (epoch ms), for tests. */
    now?: () => number;
}

/** UTC calendar day, e.g. "2026-10-13". */
export function utcDay(ms: number): string {
    return new Date(ms).toISOString().slice(0, 10);
}

export class DailyBudgetPolicy {
    private version = 1;
    private config: DailyBudgetConfig;
    readonly store: BudgetStore;
    private readonly now: () => number;

    constructor(config: DailyBudgetConfig) {
        this.config = config;
        this.store = config.store ?? new InMemoryBudgetStore();
        this.now = config.now ?? Date.now;
    }

    /** Opaque version string; changes on every policy update. */
    currentVersion(): string {
        return `daily-budget-v${this.version}`;
    }

    /** Change caps. Bumps the version, so any ALLOW issued before fails closed (STALE). */
    update(patch: Partial<Pick<DailyBudgetConfig, 'dailyCap' | 'caps' | 'ttlMs'>>): void {
        this.config = { ...this.config, ...patch };
        this.version += 1;
    }

    capFor(agent: string): bigint {
        return this.config.caps?.[agent] ?? this.config.dailyCap;
    }

    async evaluate(ctx: X402PolicyContext): Promise<X402PolicyDecision> {
        const policyVersion = this.currentVersion();
        let amount: bigint;
        try {
            amount = BigInt(ctx.authorization.amount);
        } catch {
            return { decision: 'DENY', reason: 'amount is not an integer', policyVersion };
        }
        const agent = ctx.signer;
        const now = this.now();
        const day = utcDay(now);
        const cap = this.capFor(agent);

        const res = this.store.tryCommit(agent, day, amount, cap);
        if (!res.ok) {
            return {
                decision: 'DENY',
                reason: `daily cap ${cap} exceeded: spent ${res.spent}, requested ${amount}`,
                policyVersion,
            };
        }
        return {
            decision: 'ALLOW',
            contextHash: ctx.contextHash, // exact echo: binds this ALLOW to this authorization
            policyVersion,
            expiresAt: now + (this.config.ttlMs ?? 2_000),
            decisionId: `${agent}:${day}:${ctx.authorization.nonce}`,
        };
    }

    /** The object to pass as `initX402({ policy })`. */
    hook(extra: Partial<Pick<X402PolicyHook, 'onDecision' | 'timeoutMs'>> = {}): X402PolicyHook {
        return {
            evaluate: (ctx) => this.evaluate(ctx),
            currentVersion: async () => this.currentVersion(),
            requireExpiry: true,
            ...extra,
        };
    }
}
