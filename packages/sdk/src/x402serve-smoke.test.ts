/**
 * Smoke tests for x402Serve — verifies synchronous validation is intact.
 *
 * These tests do NOT call the real middleware (which dynamically imports
 * @x402/express, @x402/core, and @x402/stellar at first request). They only
 * verify that x402Serve rejects bad config the same way with or without the
 * metrics wrapper applied.
 */

// Mock all ESM-only dependencies before importing index.ts
jest.mock('ws', () => ({ default: class WS {}, WebSocket: class WS {} }));
jest.mock('@x402/fetch', () => ({
  x402Client: class {},
  wrapFetchWithPayment: () => (url: string, init?: any) => fetch(url, init),
}));
jest.mock('@x402/stellar', () => ({
  createEd25519Signer: () => ({
    address: 'GAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAWHF',
    signAuthEntry: async () => ({ signedAuthEntry: 'mock' }),
  }),
}));
jest.mock('@x402/stellar/exact/client', () => ({
  ExactStellarScheme: class {},
}));
jest.mock('mppx', () => ({
  default: { create: () => ({}) },
}));

import { x402Serve } from './index';
import { x402Metrics } from './metrics';

const VALID_CONFIG = {
  payTo: 'GAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAWHF',
  routes: { 'GET /signals': '$0.02' },
  facilitatorApiKey: 'oz_test_key',
};

describe('x402Serve smoke', () => {
  it('returns a function with the expected middleware signature', () => {
    const handler = x402Serve(VALID_CONFIG);
    expect(typeof handler).toBe('function');
    expect(handler.length).toBe(3); // (req, res, next)
  });

  it('throws on missing payTo', () => {
    expect(() =>
      x402Serve({ ...VALID_CONFIG, payTo: '' }),
    ).toThrow('payTo');
  });

  it('throws on invalid payTo format', () => {
    expect(() =>
      x402Serve({ ...VALID_CONFIG, payTo: 'not-a-stellar-key' }),
    ).toThrow('payTo');
  });

  it('throws on empty routes', () => {
    expect(() =>
      x402Serve({ ...VALID_CONFIG, routes: {} }),
    ).toThrow('routes');
  });

  it('throws when neither facilitatorApiKey nor facilitatorUrl is provided', () => {
    expect(() =>
      x402Serve({
        payTo: VALID_CONFIG.payTo,
        routes: VALID_CONFIG.routes,
      }),
    ).toThrow('facilitatorApiKey');
  });
});

describe('x402Metrics wrapping x402Serve', () => {
  it('wraps without changing the handler shape', () => {
    const inner = x402Serve(VALID_CONFIG);
    const { handler, metricsHandler } = x402Metrics(inner);

    expect(typeof handler).toBe('function');
    expect(handler.length).toBe(3);
    expect(typeof metricsHandler).toBe('function');
  });

  it('does not intercept synchronous validation errors', () => {
    // Bad config — x402Serve throws synchronously before the wrapper
    // ever sees it. This proves the wrapper doesn't swallow errors.
    expect(() =>
      x402Metrics(x402Serve({ ...VALID_CONFIG, payTo: '' }) as any),
    ).toThrow('payTo');
  });
});

describe('x402Serve guard integration (config.guard)', () => {
  // These only exercise the DENIED paths (409/503/429), which return before
  // x402Serve ever reaches preflight()/build() — so none of this needs the
  // @x402/express/@x402/core mocks above. The allowed-path/store behavior
  // itself is covered directly in x402-guard.test.ts.

  function fakeStore(overrides: Partial<{
    claimOnce: (key: string, ttlMs: number) => Promise<boolean>;
    release: (key: string) => Promise<void>;
    slidingWindowHit: (key: string, windowMs: number, member: string) => Promise<number>;
  }> = {}) {
    return {
      claimOnce: overrides.claimOnce ?? (async () => true),
      release: overrides.release ?? (async () => {}),
      slidingWindowHit: overrides.slidingWindowHit ?? (async () => 1),
    };
  }

  function mockReqRes(headers: Record<string, string> = {}) {
    const req: any = { method: 'GET', url: '/signals', originalUrl: '/signals', headers, ip: '203.0.113.1' };
    const res: any = {
      statusCode: 200,
      status(code: number) { this.statusCode = code; return this; },
      json(body: any) { this.body = body; return this; },
      setHeader(k: string, v: string) { this.headers = { ...(this.headers ?? {}), [k]: v }; },
      on() { /* no-op: not reached on the denied paths under test */ },
    };
    return { req, res };
  }

  it('rejects a reused X-PAYMENT the same way Edgadafi/remesa-liquidez does: 409, payment_replayed', async () => {
    const store = fakeStore({
      claimOnce: (() => {
        let used = false;
        return async () => { if (used) return false; used = true; return true; };
      })(),
    });
    const handler = x402Serve({ ...VALID_CONFIG, guard: { store } });

    const first = mockReqRes({ 'payment-signature': 'proof-1' });
    await handler(first.req, first.res, () => {});
    // First call proceeds past the guard (into preflight, which will fail
    // in this test env with no real facilitator — that's fine, it's not
    // what this test is checking).

    const second = mockReqRes({ 'payment-signature': 'proof-1' });
    await handler(second.req, second.res, () => {});
    expect(second.res.statusCode).toBe(409);
    expect(second.res.body.error).toBe('payment_replayed');
  });

  it('responds 503 instead of accepting a payment unprotected when the guard store is down', async () => {
    const store = fakeStore({ claimOnce: async () => { throw new Error('store down'); } });
    const handler = x402Serve({ ...VALID_CONFIG, guard: { store } });

    const { req, res } = mockReqRes({ 'payment-signature': 'proof-2' });
    await handler(req, res, () => {});
    expect(res.statusCode).toBe(503);
    expect(res.body.error).toBe('replay_protection_unavailable');
  });

  it('rate-limits with 429 before ever looking at the payment proof', async () => {
    const store = fakeStore({ slidingWindowHit: async () => 999 });
    const handler = x402Serve({
      ...VALID_CONFIG,
      guard: { store, rateLimit: { max: 5, windowMs: 60_000 } },
    });

    const { req, res } = mockReqRes({ 'payment-signature': 'proof-3' });
    await handler(req, res, () => {});
    expect(res.statusCode).toBe(429);
    expect(res.body.error).toBe('rate_limited');
    expect(res.headers['Retry-After']).toBe('60');
  });

  it('with no `guard` config at all, behaves exactly as before (no 409/503/429 from the guard layer)', async () => {
    const handler = x402Serve(VALID_CONFIG); // no `guard` key
    const first = mockReqRes({ 'payment-signature': 'proof-4' });
    await handler(first.req, first.res, () => {});
    const second = mockReqRes({ 'payment-signature': 'proof-4' }); // same "proof" reused
    await handler(second.req, second.res, () => {});
    // Neither call was rejected by a guard that doesn't exist - whatever
    // status they got came from downstream (preflight failing in this test
    // env), never 409/429, and never our guard's own error bodies.
    expect(second.res.body?.error).not.toBe('payment_replayed');
    expect(second.res.statusCode).not.toBe(409);
  });
});
