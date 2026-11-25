/**
 * Unit tests for createUpstashX402GuardStore (issue #214) — the Upstash
 * REST-backed X402GuardStore from x402-guard-upstash.ts, which until now
 * had no coverage at all while the in-memory fake in x402-guard.test.ts
 * carried every guard test.
 *
 * The Upstash REST client is faked in-process: globalThis.fetch is
 * replaced with an in-memory emulation of the five Redis commands the
 * store issues (SET NX PX / DEL / ZADD / ZREMRANGEBYSCORE / PEXPIRE /
 * ZCARD), so the store's real request/response handling runs end to end
 * with no outbound connection (jest.no-network.js, issue #126).
 *
 * The guard-level tests at the bottom pin issue #91's split with THIS
 * store, not just the fake: replay protection fails CLOSED when Upstash
 * errors or times out, rate limiting fails OPEN.
 */

import { createUpstashX402GuardStore } from './x402-guard-upstash';
import { checkReplay, checkRateLimit, type X402GuardConfig, type GuardRequest } from './x402-guard';

const BASE_URL = 'https://example.upstash.io';
const TOKEN = 'test-token';

type Cmd = (string | number)[];

interface FakeUpstash {
    fetchMock: jest.Mock;
    /** Every command array the store sent, in order. */
    calls: Cmd[];
    /** Request URL of each call, in order. */
    urls: string[];
    /** Request headers of each call, in order. */
    headers: Record<string, string>[];
    /** AbortSignal of each call, in order. */
    signals: (AbortSignal | undefined)[];
}

/**
 * In-memory emulation of the Upstash REST endpoint for exactly the
 * commands createUpstashX402GuardStore sends. Honors SET NX + PX expiry
 * and sorted-set score ranges against Date.now(), so tests control time
 * by mocking Date.now(). `failOn` makes one command answer HTTP 503.
 */
function fakeUpstash(opts: { failOn?: string } = {}): FakeUpstash {
    const strings = new Map<string, { value: string; expiresAt: number }>();
    const zsets = new Map<string, { members: Map<string, number>; expiresAt?: number }>();
    const calls: Cmd[] = [];
    const urls: string[] = [];
    const headers: Record<string, string>[] = [];
    const signals: (AbortSignal | undefined)[] = [];

    const liveZset = (key: string) => {
        const z = zsets.get(key);
        if (z && z.expiresAt !== undefined && z.expiresAt <= Date.now()) {
            zsets.delete(key);
            return undefined;
        }
        return z;
    };

    const run = (cmd: Cmd): unknown => {
        const [name, key] = cmd as [string, string];
        switch (name) {
            case 'SET': {
                // ['SET', key, value, 'PX', ttlMs, 'NX']
                const existing = strings.get(key);
                if (existing && existing.expiresAt > Date.now()) return null;
                strings.set(key, { value: String(cmd[2]), expiresAt: Date.now() + Number(cmd[4]) });
                return 'OK';
            }
            case 'DEL': {
                const had = strings.delete(key) || zsets.delete(key);
                return had ? 1 : 0;
            }
            case 'ZADD': {
                // ['ZADD', key, score, member]
                let z = liveZset(key);
                if (!z) {
                    z = { members: new Map() };
                    zsets.set(key, z);
                }
                z.members.set(String(cmd[3]), Number(cmd[2]));
                return 1;
            }
            case 'ZREMRANGEBYSCORE': {
                // ['ZREMRANGEBYSCORE', key, min, max] — inclusive range.
                const z = liveZset(key);
                if (!z) return 0;
                let removed = 0;
                for (const [member, score] of z.members) {
                    if (score >= Number(cmd[2]) && score <= Number(cmd[3])) {
                        z.members.delete(member);
                        removed += 1;
                    }
                }
                return removed;
            }
            case 'PEXPIRE': {
                const z = liveZset(key);
                if (!z) return 0;
                z.expiresAt = Date.now() + Number(cmd[2]);
                return 1;
            }
            case 'ZCARD': {
                const z = liveZset(key);
                return z ? z.members.size : 0;
            }
            default:
                throw new Error(`fake Upstash: unsupported command ${name}`);
        }
    };

    const fetchMock = jest.fn(async (url: string, init: any) => {
        const cmd = JSON.parse(init.body) as Cmd;
        calls.push(cmd);
        urls.push(url);
        headers.push(init.headers);
        signals.push(init.signal);
        if (opts.failOn && cmd[0] === opts.failOn) {
            return { ok: false, status: 503, json: async () => ({}) };
        }
        return { ok: true, status: 200, json: async () => ({ result: run(cmd) }) };
    });

    return { fetchMock, calls, urls, headers, signals };
}

function req(overrides: Partial<GuardRequest> = {}): GuardRequest {
    return {
        method: 'GET',
        url: '/signals',
        headers: { 'payment-signature': 'proof-abc' },
        ip: '203.0.113.1',
        ...overrides,
    };
}

describe('createUpstashX402GuardStore', () => {
    const originalFetch = globalThis.fetch;
    let upstash: FakeUpstash;
    let now: number;

    beforeEach(() => {
        upstash = fakeUpstash();
        globalThis.fetch = upstash.fetchMock as any;
        now = 1_700_000_000_000;
        jest.spyOn(Date, 'now').mockImplementation(() => now);
    });

    afterEach(() => {
        globalThis.fetch = originalFetch;
        jest.restoreAllMocks();
    });

    const store = () => createUpstashX402GuardStore({ url: BASE_URL, token: TOKEN });

    describe('claimOnce (replay protection)', () => {
        it('claims a fresh key and sends SET with NX + PX as a bearer-authenticated POST', async () => {
            const s = store();
            await expect(s.claimOnce('replay:key', 60_000)).resolves.toBe(true);

            expect(upstash.urls).toEqual([BASE_URL]);
            expect(upstash.calls).toEqual([['SET', 'replay:key', '1', 'PX', 60_000, 'NX']]);
            expect(upstash.headers[0].Authorization).toBe(`Bearer ${TOKEN}`);
            expect(upstash.headers[0]['Content-Type']).toBe('application/json');
        });

        it('blocks a replay: the second claim of the same key within its TTL returns false', async () => {
            const s = store();
            await expect(s.claimOnce('replay:key', 60_000)).resolves.toBe(true);
            await expect(s.claimOnce('replay:key', 60_000)).resolves.toBe(false);
        });

        it('lets the key be claimed again once its TTL has passed', async () => {
            const s = store();
            await expect(s.claimOnce('replay:key', 60_000)).resolves.toBe(true);
            now += 60_001;
            await expect(s.claimOnce('replay:key', 60_000)).resolves.toBe(true);
        });

        it('strips a trailing slash from the configured URL', async () => {
            const s = createUpstashX402GuardStore({ url: `${BASE_URL}/`, token: TOKEN });
            await s.claimOnce('replay:key', 60_000);
            expect(upstash.urls).toEqual([BASE_URL]);
        });

        it('passes an AbortSignal so a hung Upstash call times out instead of hanging the request', async () => {
            const s = store();
            await s.claimOnce('replay:key', 60_000);
            expect(upstash.signals[0]).toBeInstanceOf(AbortSignal);
        });
    });

    describe('release', () => {
        it('sends DEL and frees the key so a legitimate retry can claim it again', async () => {
            const s = store();
            await expect(s.claimOnce('replay:key', 60_000)).resolves.toBe(true);
            await s.release('replay:key');
            expect(upstash.calls[1]).toEqual(['DEL', 'replay:key']);
            await expect(s.claimOnce('replay:key', 60_000)).resolves.toBe(true);
        });
    });

    describe('slidingWindowHit (rate limiting)', () => {
        it('counts the hits still inside the window', async () => {
            const s = store();
            await expect(s.slidingWindowHit('rl:key', 60_000, 'm1')).resolves.toBe(1);
            await expect(s.slidingWindowHit('rl:key', 60_000, 'm2')).resolves.toBe(2);
            await expect(s.slidingWindowHit('rl:key', 60_000, 'm3')).resolves.toBe(3);
        });

        it('issues ZADD, ZREMRANGEBYSCORE, PEXPIRE, ZCARD in that order for one hit', async () => {
            const s = store();
            await s.slidingWindowHit('rl:key', 60_000, 'm1');
            expect(upstash.calls.map((c) => c[0])).toEqual(['ZADD', 'ZREMRANGEBYSCORE', 'PEXPIRE', 'ZCARD']);
            expect(upstash.calls[0]).toEqual(['ZADD', 'rl:key', now, 'm1']);
            expect(upstash.calls[1]).toEqual(['ZREMRANGEBYSCORE', 'rl:key', 0, now - 60_000]);
            expect(upstash.calls[2]).toEqual(['PEXPIRE', 'rl:key', 60_000]);
            expect(upstash.calls[3]).toEqual(['ZCARD', 'rl:key']);
        });

        it('drops hits as they age out of the trailing window', async () => {
            const s = store();
            await expect(s.slidingWindowHit('rl:key', 60_000, 'm1')).resolves.toBe(1);
            now += 30_000;
            await expect(s.slidingWindowHit('rl:key', 60_000, 'm2')).resolves.toBe(2);
            now += 31_000; // m1 is now 61s old — outside the 60s window
            await expect(s.slidingWindowHit('rl:key', 60_000, 'm3')).resolves.toBe(2);
            now += 200_000; // everything before is long gone
            await expect(s.slidingWindowHit('rl:key', 60_000, 'm4')).resolves.toBe(1);
        });

        it('counts a repeated member once — members, not calls, are the hits', async () => {
            const s = store();
            await expect(s.slidingWindowHit('rl:key', 60_000, 'same-member')).resolves.toBe(1);
            await expect(s.slidingWindowHit('rl:key', 60_000, 'same-member')).resolves.toBe(1);
        });
    });

    describe('store-level error handling', () => {
        it('claimOnce rejects when the fetch itself fails (connection error)', async () => {
            globalThis.fetch = jest.fn().mockRejectedValue(new Error('fetch failed')) as any;
            await expect(store().claimOnce('replay:key', 60_000)).rejects.toThrow('fetch failed');
        });

        it('claimOnce rejects on an HTTP error status', async () => {
            globalThis.fetch = jest.fn().mockResolvedValue({
                ok: false,
                status: 500,
                json: async () => ({}),
            }) as any;
            await expect(store().claimOnce('replay:key', 60_000)).rejects.toThrow('Upstash returned HTTP 500');
        });

        it('claimOnce rejects when Upstash answers with an error payload', async () => {
            globalThis.fetch = jest.fn().mockResolvedValue({
                ok: true,
                status: 200,
                json: async () => ({ error: 'ERR wrong number of arguments for \'set\' command' }),
            }) as any;
            await expect(store().claimOnce('replay:key', 60_000)).rejects.toThrow(
                'Upstash error: ERR wrong number of arguments for \'set\' command',
            );
        });

        it('slidingWindowHit rejects when a command mid-sequence fails', async () => {
            upstash = fakeUpstash({ failOn: 'ZCARD' });
            globalThis.fetch = upstash.fetchMock as any;
            await expect(store().slidingWindowHit('rl:key', 60_000, 'm1')).rejects.toThrow(
                'Upstash returned HTTP 503',
            );
            // The three writes before the failed read still went out in order.
            expect(upstash.calls.map((c) => c[0])).toEqual(['ZADD', 'ZREMRANGEBYSCORE', 'PEXPIRE', 'ZCARD']);
        });
    });

    describe('guard semantics through this store (issue #91)', () => {
        it('checkReplay allows the first use of a proof and blocks its replay with 409', async () => {
            const config: X402GuardConfig = { store: store() };
            const first = await checkReplay(req(), config);
            expect(first.allowed).toBe(true);

            const second = await checkReplay(req(), config);
            expect(second.allowed).toBe(false);
            expect(second.denied?.status).toBe(409);
            expect(second.denied?.body.error).toBe('payment_replayed');
        });

        it('checkReplay allows the same proof against a different route', async () => {
            const config: X402GuardConfig = { store: store() };
            await checkReplay(req({ url: '/signals' }), config);
            const other = await checkReplay(req({ url: '/market' }), config);
            expect(other.allowed).toBe(true);
        });

        it('checkReplay lets a legitimate retry through after release (non-2xx path)', async () => {
            const config: X402GuardConfig = { store: store() };
            const first = await checkReplay(req(), config);
            expect(first.allowed).toBe(true);
            await first.release!();

            const retry = await checkReplay(req(), config);
            expect(retry.allowed).toBe(true);
        });

        it('checkReplay fails CLOSED (503) when Upstash is unreachable', async () => {
            globalThis.fetch = jest.fn().mockRejectedValue(new Error('fetch failed')) as any;
            const config: X402GuardConfig = { store: store() };
            const result = await checkReplay(req(), config);
            expect(result.allowed).toBe(false);
            expect(result.denied?.status).toBe(503);
            expect(result.denied?.body.error).toBe('replay_protection_unavailable');
        });

        it('checkReplay fails CLOSED (503) when Upstash answers an HTTP error', async () => {
            globalThis.fetch = jest.fn().mockResolvedValue({
                ok: false,
                status: 500,
                json: async () => ({}),
            }) as any;
            const config: X402GuardConfig = { store: store() };
            const result = await checkReplay(req(), config);
            expect(result.allowed).toBe(false);
            expect(result.denied?.status).toBe(503);
        });

        it('checkReplay fails CLOSED (503) when the Upstash call times out', async () => {
            globalThis.fetch = jest.fn().mockRejectedValue(
                new DOMException('The operation was timed out', 'TimeoutError'),
            ) as any;
            const config: X402GuardConfig = { store: store() };
            const result = await checkReplay(req(), config);
            expect(result.allowed).toBe(false);
            expect(result.denied?.status).toBe(503);
            expect(result.denied?.body.error).toBe('replay_protection_unavailable');
        });

        it('checkRateLimit allows up to max through this store, then denies with 429', async () => {
            const config: X402GuardConfig = { store: store(), rateLimit: { max: 2, windowMs: 60_000 } };
            await expect(checkRateLimit(req(), config)).resolves.toMatchObject({ allowed: true });
            await expect(checkRateLimit(req(), config)).resolves.toMatchObject({ allowed: true });

            const third = await checkRateLimit(req(), config);
            expect(third.allowed).toBe(false);
            expect(third.denied?.status).toBe(429);
            expect(third.denied?.headers?.['Retry-After']).toBe('60');
        });

        it('checkRateLimit allows again once the window has slid past earlier hits', async () => {
            const config: X402GuardConfig = { store: store(), rateLimit: { max: 1, windowMs: 60_000 } };
            await expect(checkRateLimit(req(), config)).resolves.toMatchObject({ allowed: true });
            await expect(checkRateLimit(req(), config)).resolves.toMatchObject({ allowed: false });
            now += 61_000;
            await expect(checkRateLimit(req(), config)).resolves.toMatchObject({ allowed: true });
        });

        it('checkRateLimit fails OPEN when Upstash is unreachable', async () => {
            globalThis.fetch = jest.fn().mockRejectedValue(new Error('fetch failed')) as any;
            const config: X402GuardConfig = { store: store(), rateLimit: { max: 5, windowMs: 60_000 } };
            const result = await checkRateLimit(req(), config);
            expect(result.allowed).toBe(true);
        });

        it('checkRateLimit fails OPEN when the Upstash call times out', async () => {
            globalThis.fetch = jest.fn().mockRejectedValue(
                new DOMException('The operation was timed out', 'TimeoutError'),
            ) as any;
            const config: X402GuardConfig = { store: store(), rateLimit: { max: 5, windowMs: 60_000 } };
            const result = await checkRateLimit(req(), config);
            expect(result.allowed).toBe(true);
        });
    });
});
