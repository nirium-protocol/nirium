/**
 * Optional replay/rate-limit protection for x402Serve() — off by default.
 *
 * x402Serve() verifies and settles a payment; on its own it does not stop
 * the same signed payment proof from being replayed against a route (a
 * concurrent-request "free shopping" window), and it does not rate-limit
 * callers. See https://github.com/nirium-protocol/nirium/issues/91.
 *
 * The design here (single-use claim keyed on the payment proof + method +
 * route, released only if the request did NOT end in 2xx so a legitimate
 * retry after a facilitator hiccup still works; fail-closed for the replay
 * guard and fail-open for rate limiting, both by the same reasoning) is
 * generalized from a real production x402Serve() integration —
 * Edgadafi/remesa-liquidez (commit 1e0cbd5902cb224d3c6a2320cc009cf4df84f513,
 * `backend/src/middleware/paymentGuard.ts` and `backend/src/middleware/
 * rateLimit.ts`) — credited here and in CHANGELOG.md. The store interface
 * and this module's code are our own; nothing here is copied from theirs.
 */

import { createHash } from 'node:crypto';

/**
 * A pluggable KV backend. Implement this against Upstash, another
 * Redis-compatible store, or anything else with the same semantics — see
 * `createUpstashX402GuardStore()` for a ready-made Upstash implementation.
 */
export interface X402GuardStore {
    /**
     * Atomically claims `key` for `ttlMs`. Returns `true` if THIS call made
     * the claim, `false` if `key` was already claimed (and is still within
     * its TTL) by an earlier call.
     */
    claimOnce(key: string, ttlMs: number): Promise<boolean>;
    /**
     * Releases a claim early. Used after a request that did not succeed, so
     * a legitimate retry with the same payment proof is not blocked.
     */
    release(key: string): Promise<void>;
    /**
     * Registers one hit for `key` (a caller-unique `member` id, so repeat
     * calls within the same millisecond don't collide) and returns how many
     * hits are still inside the trailing `windowMs` sliding window.
     */
    slidingWindowHit(key: string, windowMs: number, member: string): Promise<number>;
}

export interface X402GuardConfig {
    /**
     * Backing store. Providing this is what turns the guard on — with no
     * `guard` config at all, x402Serve() behaves exactly as before (no
     * replay protection, no rate limiting, zero overhead).
     */
    store: X402GuardStore;
    /** How long a used payment proof stays claimed. Default 15 minutes. */
    replayTtlMs?: number;
    /**
     * Sliding-window rate limit per caller IP. Omit to skip rate limiting
     * even with `store` configured — replay protection and rate limiting
     * are independent knobs.
     */
    rateLimit?: { max: number; windowMs: number };
}

export interface GuardRequest {
    method: string;
    url: string;
    headers: Record<string, string | string[] | undefined>;
    ip?: string;
}

export interface GuardDenied {
    status: number;
    body: Record<string, unknown>;
    headers?: Record<string, string>;
}

export interface ReplayCheck {
    allowed: boolean;
    denied?: GuardDenied;
    /** Call after the response is known — releases the claim on non-2xx. */
    release?: () => Promise<void>;
}

export interface RateLimitCheck {
    allowed: boolean;
    denied?: GuardDenied;
}

const DEFAULT_REPLAY_TTL_MS = 15 * 60 * 1000;

// @x402/express reads the payment proof from `payment-signature` (x402
// v2), falling back to `x-payment` (v1) — verified directly against the
// published @x402/express package (dist/cjs/index.js), not assumed from
// either header name alone. The guard has to hash the SAME header the real
// middleware will read, or it protects nothing.
function readPaymentHeader(headers: GuardRequest['headers']): string | undefined {
    const v2 = headers['payment-signature'];
    const v1 = headers['x-payment'];
    const pick = (v: typeof v2) => (Array.isArray(v) ? v[0] : v);
    return pick(v2) ?? pick(v1);
}

/** Single-use guard against replaying a payment proof. */
export async function checkReplay(req: GuardRequest, config: X402GuardConfig): Promise<ReplayCheck> {
    const raw = readPaymentHeader(req.headers);
    if (!raw) return { allowed: true }; // no proof yet — let x402Serve issue its 402

    // The key binds the proof to method + route, same binding the exact
    // scheme itself already puts on resource.url — a proof burned against
    // route A doesn't block its own legitimate use against route B.
    const digest = createHash('sha256').update(raw).update('\n').update(`${req.method} ${req.url}`).digest('hex');
    const key = `nirium:x402guard:replay:${digest}`;

    let claimed: boolean;
    try {
        claimed = await config.store.claimOnce(key, config.replayTtlMs ?? DEFAULT_REPLAY_TTL_MS);
    } catch {
        // Fail-closed: once a store is configured, its failure must never
        // silently become "no protection" — a payment gate that only
        // protects when convenient isn't a payment gate.
        return {
            allowed: false,
            denied: {
                status: 503,
                body: {
                    error: 'replay_protection_unavailable',
                    message: 'The payment replay guard\'s store is unavailable right now. Retry later.',
                },
            },
        };
    }

    if (!claimed) {
        return {
            allowed: false,
            denied: {
                status: 409,
                body: {
                    error: 'payment_replayed',
                    message: 'This payment proof was already used. Each request needs a freshly signed payment.',
                },
            },
        };
    }

    return { allowed: true, release: () => config.store.release(key).catch(() => { /* best-effort */ }) };
}

/** Sliding-window rate limit per caller IP. */
export async function checkRateLimit(req: GuardRequest, config: X402GuardConfig): Promise<RateLimitCheck> {
    if (!config.rateLimit) return { allowed: true };

    const ip = req.ip || 'unknown';
    const key = `nirium:x402guard:rl:${ip}`;
    const member = `${Date.now()}:${Math.random().toString(36).slice(2, 10)}`;

    let count: number;
    try {
        count = await config.store.slidingWindowHit(key, config.rateLimit.windowMs, member);
    } catch {
        // Fail-open: a store outage must not turn into a self-inflicted
        // denial of service for every caller — rate limiting protects
        // availability, and denying all traffic because the counter is
        // unreachable would be the opposite of that.
        return { allowed: true };
    }

    if (count > config.rateLimit.max) {
        return {
            allowed: false,
            denied: {
                status: 429,
                headers: { 'Retry-After': String(Math.ceil(config.rateLimit.windowMs / 1000)) },
                body: {
                    error: 'rate_limited',
                    message: `Max ${config.rateLimit.max} requests per ${Math.ceil(config.rateLimit.windowMs / 1000)}s.`,
                },
            },
        };
    }

    return { allowed: true };
}
