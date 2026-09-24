/**
 * Reference X402GuardStore backed by Upstash's REST API — plain `fetch`,
 * no extra dependency. Any other Redis-compatible store can implement the
 * three-method X402GuardStore interface instead; this one is provided
 * because it's the store the production reference implementation this
 * feature is modeled on actually uses. See x402-guard.ts.
 */

import type { X402GuardStore } from './x402-guard';

export interface UpstashX402GuardStoreOptions {
    /** e.g. https://usw1-xxxx.upstash.io */
    url: string;
    token: string;
}

export function createUpstashX402GuardStore(opts: UpstashX402GuardStoreOptions): X402GuardStore {
    const base = opts.url.replace(/\/$/, '');

    const call = async (cmd: (string | number)[]): Promise<any> => {
        const r = await fetch(base, {
            method: 'POST',
            headers: { Authorization: `Bearer ${opts.token}`, 'Content-Type': 'application/json' },
            body: JSON.stringify(cmd),
            signal: AbortSignal.timeout(5000),
        });
        if (!r.ok) throw new Error(`Upstash returned HTTP ${r.status}`);
        const j = await r.json();
        if (j.error) throw new Error(`Upstash error: ${j.error}`);
        return j.result;
    };

    return {
        async claimOnce(key, ttlMs) {
            const result = await call(['SET', key, '1', 'PX', ttlMs, 'NX']);
            return result === 'OK';
        },
        async release(key) {
            await call(['DEL', key]);
        },
        async slidingWindowHit(key, windowMs, member) {
            const now = Date.now();
            await call(['ZADD', key, now, member]);
            await call(['ZREMRANGEBYSCORE', key, 0, now - windowMs]);
            await call(['PEXPIRE', key, windowMs]);
            const count = await call(['ZCARD', key]);
            return Number(count);
        },
    };
}
