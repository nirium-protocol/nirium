/**
 * x402Serve() — Bazaar discovery extension.
 *
 * `routes` in X402ServeConfig can carry optional `input`/`inputSchema`/
 * `output` fields. When present, x402Serve() must declare them via
 * `declareDiscoveryExtension()` (same pattern already used in
 * packages/agent/src/middleware/x402.ts's PREMIUM_ROUTES) and attach the
 * result as `extensions` on that route. Routes without any of those three
 * fields must get no `extensions` key at all — zero behavior change for
 * existing callers.
 *
 * These tests intercept what gets passed into `paymentMiddlewareFromConfig`
 * (the real call x402Serve() makes once it builds, on the first request)
 * rather than re-implementing the facilitator — @x402/express,
 * @x402/core/server, @x402/stellar/exact/server and @x402/extensions/bazaar
 * are all mocked, same as @x402/fetch/@x402/stellar are mocked in
 * x402serve-smoke.test.ts for the same reason (they're ESM-only or require
 * a live facilitator).
 */

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
jest.mock('mppx/client', () => ({
  Mppx: { create: () => ({ fetch: async () => new Response('{}') }) },
}));
jest.mock('@stellar/mpp/charge/client', () => ({
  stellar: { charge: () => ({}) },
}));
jest.mock('@stellar/stellar-sdk', () => ({
  Networks: { TESTNET: 'Test SDF Network ; September 2015', PUBLIC: 'Public Global Stellar Network ; September 2015' },
}));

let capturedRoutes: Record<string, any> | undefined;

jest.mock('@x402/express', () => ({
  paymentMiddlewareFromConfig: jest.fn((routes: Record<string, any>) => {
    capturedRoutes = routes;
    return async (_req: any, _res: any, next: any) => next();
  }),
}));
jest.mock('@x402/core/server', () => ({
  HTTPFacilitatorClient: class {},
}));
jest.mock('@x402/stellar/exact/server', () => ({
  ExactStellarScheme: class {},
}));
// `@x402/extensions/bazaar`'s subpath export isn't resolvable under this
// package's `moduleResolution: "node"` tsconfig (confirmed: tsc reports
// types exist but can't be resolved in that mode) — so this mock, like the
// one above for `@x402/stellar/exact/server`, is referenced only as a
// string. `mockDeclareDiscoveryExtension` is captured via the
// `jest.mock`-hoisting convention (names starting with `mock` survive
// babel-plugin-jest-hoist's hoist-above-imports rewrite) instead of a
// static import of the real module.
const mockDeclareDiscoveryExtension = jest.fn((ext: Record<string, unknown>) => ({ bazaar: ext }));
jest.mock('@x402/extensions/bazaar', () => ({
  declareDiscoveryExtension: mockDeclareDiscoveryExtension,
}));

import { x402Serve } from './index';

const declareDiscoveryExtension = mockDeclareDiscoveryExtension;

const BASE_CONFIG = {
  payTo: 'GAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAWHF',
  facilitatorApiKey: 'oz_test_key',
};

function mockReqRes() {
  const req: any = { method: 'GET', url: '/signals', originalUrl: '/signals', headers: {}, ip: '203.0.113.1' };
  const res: any = {
    headersSent: false,
    statusCode: 200,
    status(code: number) { this.statusCode = code; return this; },
    json(body: any) { this.body = body; return this; },
    setHeader() {},
  };
  return { req, res };
}

describe('x402Serve — discovery extension', () => {
  beforeEach(() => {
    capturedRoutes = undefined;
    jest.clearAllMocks();
    (globalThis as any).fetch = jest.fn(async () => ({ ok: true, status: 200 }));
  });

  it('attaches extensions.bazaar to a route that declares input/inputSchema/output', async () => {
    const handler = x402Serve({
      ...BASE_CONFIG,
      routes: {
        'GET /signals': {
          price: '$0.02',
          input: { count: 20 },
          inputSchema: { properties: { count: { type: 'integer', maximum: 100 } } },
          output: { example: { signals: [] } },
        },
      },
    });

    const { req, res } = mockReqRes();
    await handler(req, res, () => {});

    expect(declareDiscoveryExtension).toHaveBeenCalledTimes(1);
    expect(declareDiscoveryExtension).toHaveBeenCalledWith({
      input: { count: 20 },
      inputSchema: { properties: { count: { type: 'integer', maximum: 100 } } },
      output: { example: { signals: [] } },
    });

    expect(capturedRoutes).toBeDefined();
    expect(capturedRoutes!['GET /signals'].extensions).toEqual({
      bazaar: {
        input: { count: 20 },
        inputSchema: { properties: { count: { type: 'integer', maximum: 100 } } },
        output: { example: { signals: [] } },
      },
    });
  });

  it('declares only the fields actually provided, never `undefined` placeholders', async () => {
    const handler = x402Serve({
      ...BASE_CONFIG,
      routes: {
        'GET /market': { price: '$0.05', output: { example: { market: {} } } },
      },
    });

    const { req, res } = mockReqRes();
    await handler(req, res, () => {});

    expect(declareDiscoveryExtension).toHaveBeenCalledWith({ output: { example: { market: {} } } });
    expect(capturedRoutes!['GET /market'].extensions).toEqual({
      bazaar: { output: { example: { market: {} } } },
    });
  });

  it('leaves a route with no discovery fields with no `extensions` key at all', async () => {
    const handler = x402Serve({
      ...BASE_CONFIG,
      routes: { 'GET /signals': '$0.02' },
    });

    const { req, res } = mockReqRes();
    await handler(req, res, () => {});

    expect(declareDiscoveryExtension).not.toHaveBeenCalled();
    expect(capturedRoutes).toBeDefined();
    expect(capturedRoutes!['GET /signals']).not.toHaveProperty('extensions');
  });

  it('mixed config: only the route with discovery fields gets extensions', async () => {
    const handler = x402Serve({
      ...BASE_CONFIG,
      routes: {
        'GET /signals': '$0.02',
        'GET /market': { price: '$0.05', input: { pair: 'XLM/USDC' } },
      },
    });

    const { req, res } = mockReqRes();
    await handler(req, res, () => {});

    expect(declareDiscoveryExtension).toHaveBeenCalledTimes(1);
    expect(capturedRoutes!['GET /signals']).not.toHaveProperty('extensions');
    expect(capturedRoutes!['GET /market'].extensions).toEqual({
      bazaar: { input: { pair: 'XLM/USDC' } },
    });
  });
});
