/**
 * Unit tests for the replay guard / rate limit checks that back
 * X402ServeConfig['guard']. Pure functions against a fake in-memory store,
 * no network or Express involved — the integration-level tests (guard
 * wired through x402Serve() itself) live in x402serve-smoke.test.ts.
 *
 * These reproduce the exact scenarios a real production x402Serve() user
 * (Edgadafi/remesa-liquidez) built their own version of this against, per
 * https://github.com/nirium-protocol/nirium/issues/91.
 */

import { checkReplay, checkRateLimit, type X402GuardStore, type X402GuardConfig, type GuardRequest } from './x402-guard';

function fakeStore(): X402GuardStore & { claims: Map<string, number> } {
    const claims = new Map<string, number>();
    return {
        claims,
        async claimOnce(key, ttlMs) {
            const now = Date.now();
            const expiresAt = claims.get(key);
            if (expiresAt !== undefined && expiresAt > now) return false;
            claims.set(key, now + ttlMs);
            return true;
        },
        async release(key) {
            claims.delete(key);
        },
        async slidingWindowHit() {
            throw new Error('slidingWindowHit not used by replay tests');
        },
    };
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

describe('checkReplay', () => {
    it('allows a request with no payment proof yet (lets x402Serve issue its 402)', async () => {
        const store = fakeStore();
        const config: X402GuardConfig = { store };
        const result = await checkReplay(req({ headers: {} }), config);
        expect(result.allowed).toBe(true);
    });

    it('allows the first use of a payment proof', async () => {
        const store = fakeStore();
        const config: X402GuardConfig = { store };
        const result = await checkReplay(req(), config);
        expect(result.allowed).toBe(true);
        expect(store.claims.size).toBe(1);
    });

    it('rejects a reused payment proof against the same route with 409', async () => {
        const store = fakeStore();
        const config: X402GuardConfig = { store };
        const first = await checkReplay(req(), config);
        expect(first.allowed).toBe(true);

        const second = await checkReplay(req(), config);
        expect(second.allowed).toBe(false);
        expect(second.denied?.status).toBe(409);
        expect(second.denied?.body.error).toBe('payment_replayed');
    });

    it('allows the same proof against a DIFFERENT route (binds proof + method + route)', async () => {
        const store = fakeStore();
        const config: X402GuardConfig = { store };
        await checkReplay(req({ url: '/signals' }), config);
        const other = await checkReplay(req({ url: '/market' }), config);
        expect(other.allowed).toBe(true);
    });

    it('reads the x402 v2 header "payment-signature" and the v1 fallback "x-payment"', async () => {
        const store = fakeStore();
        const config: X402GuardConfig = { store };
        const v2 = await checkReplay(req({ headers: { 'payment-signature': 'same-proof' } }), config);
        expect(v2.allowed).toBe(true);
        const v1Reuse = await checkReplay(req({ headers: { 'x-payment': 'same-proof' } }), config);
        // Same underlying proof string, same method+url -> same digest -> replay.
        expect(v1Reuse.allowed).toBe(false);
    });

    it('releases the claim when the caller reports the request did not succeed, allowing a legitimate retry', async () => {
        const store = fakeStore();
        const config: X402GuardConfig = { store };
        const first = await checkReplay(req(), config);
        expect(first.allowed).toBe(true);
        await first.release!(); // simulates: response ended non-2xx (e.g. facilitator down)

        const retry = await checkReplay(req(), config);
        expect(retry.allowed).toBe(true);
    });

    it('fails CLOSED (503) when the store is unavailable, never silently letting the payment through unprotected', async () => {
        const brokenStore: X402GuardStore = {
            async claimOnce() { throw new Error('store down'); },
            async release() {},
            async slidingWindowHit() { throw new Error('store down'); },
        };
        const config: X402GuardConfig = { store: brokenStore };
        const result = await checkReplay(req(), config);
        expect(result.allowed).toBe(false);
        expect(result.denied?.status).toBe(503);
        expect(result.denied?.body.error).toBe('replay_protection_unavailable');
    });
});

describe('checkRateLimit', () => {
    it('allows when no rateLimit config is set, even with a store present', async () => {
        const store = fakeStore();
        const config: X402GuardConfig = { store };
        const result = await checkRateLimit(req(), config);
        expect(result.allowed).toBe(true);
    });

    it('allows requests under the limit', async () => {
        let hits = 0;
        const store: X402GuardStore = {
            async claimOnce() { return true; },
            async release() {},
            async slidingWindowHit() { hits += 1; return hits; },
        };
        const config: X402GuardConfig = { store, rateLimit: { max: 5, windowMs: 60_000 } };
        const result = await checkRateLimit(req(), config);
        expect(result.allowed).toBe(true);
    });

    it('rejects with 429 once the sliding window count exceeds max', async () => {
        const store: X402GuardStore = {
            async claimOnce() { return true; },
            async release() {},
            async slidingWindowHit() { return 6; },
        };
        const config: X402GuardConfig = { store, rateLimit: { max: 5, windowMs: 60_000 } };
        const result = await checkRateLimit(req(), config);
        expect(result.allowed).toBe(false);
        expect(result.denied?.status).toBe(429);
        expect(result.denied?.headers?.['Retry-After']).toBe('60');
    });

    it('fails OPEN when the store errors, so a store outage never becomes a self-inflicted denial of service', async () => {
        const store: X402GuardStore = {
            async claimOnce() { return true; },
            async release() {},
            async slidingWindowHit() { throw new Error('store down'); },
        };
        const config: X402GuardConfig = { store, rateLimit: { max: 5, windowMs: 60_000 } };
        const result = await checkRateLimit(req(), config);
        expect(result.allowed).toBe(true);
    });
});
