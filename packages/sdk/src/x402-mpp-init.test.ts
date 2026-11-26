/**
 * initMpp() construction path, offline (issue #349).
 *
 * Mocks ESM-only dependencies before importing index.ts (same pattern as
 * x402serve-smoke.test.ts) so the test satisfies jest.no-network.js (#126).
 *
 * A real paid mppFetch() still fails inside npm @stellar/mpp@0.7.1 on
 * stellar-sdk 17 (`prepared.toEnvelope(...).v1 is not a function`) and is
 * skipped until stellar/stellar-mpp-sdk#108 publishes.
 */

jest.mock('ws', () => ({ default: class WS {}, WebSocket: class WS {} }));
jest.mock('@x402/fetch', () => ({
  x402Client: class {},
  wrapFetchWithPayment: () => (url: string, init?: RequestInit) => fetch(url, init),
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
  Mppx: {
    create: jest.fn((config: { methods: unknown[]; polyfill?: boolean }) => ({
      fetch: jest.fn(async () => new Response('{}')),
      config,
    })),
  },
}));
jest.mock('@stellar/mpp/charge/client', () => ({
  stellar: {
    charge: jest.fn((opts: { secretKey: string; mode?: string }) => ({
      name: 'stellar',
      opts,
    })),
  },
}));
jest.mock('@stellar/stellar-sdk', () => ({
  Networks: { TESTNET: 'Test SDF Network ; September 2015', PUBLIC: 'Public Global Stellar Network ; September 2015' },
}));

import { Agent } from './index';

type MockCharge = jest.Mock;
type MockCreate = jest.Mock;

const { stellar: mockedStellar } = jest.requireMock('@stellar/mpp/charge/client') as {
  stellar: { charge: MockCharge };
};
const { Mppx: mockedMppx } = jest.requireMock('mppx/client') as {
  Mppx: { create: MockCreate };
};

const TEST_SECRET = 'test-secret-key-not-a-stellar-seed';

function agent(): Agent {
  return new Agent({ apiKey: 'test-placeholder', baseUrl: 'http://127.0.0.1' });
}

describe('initMpp construction (#349)', () => {
  beforeEach(() => {
    mockedStellar.charge.mockClear();
    mockedMppx.create.mockClear();
  });

  it('builds the MPP client with stellar.charge and polyfill:false, in pull and push mode', () => {
    for (const mode of ['pull', 'push', undefined] as const) {
      const instance = agent();
      expect(() => instance.initMpp({ secretKey: TEST_SECRET, network: 'stellar:testnet', mode })).not.toThrow();
      expect(mockedStellar.charge).toHaveBeenLastCalledWith({ secretKey: TEST_SECRET, mode: mode || 'pull' });
      expect(mockedMppx.create).toHaveBeenLastCalledWith({
        methods: [expect.anything()],
        polyfill: false,
      });
    }
  });

  it('does not replace globalThis.fetch (it would also intercept x402Fetch)', () => {
    const before = globalThis.fetch;
    agent().initMpp({ secretKey: TEST_SECRET });
    expect(globalThis.fetch).toBe(before);
  });

  it('mppFetch before initMpp fails with the documented message', async () => {
    await expect(agent().mppFetch('http://127.0.0.1/x')).rejects.toThrow('Call agent.initMpp() first');
  });

  it('mppFetch after initMpp uses the client returned by Mppx.create', async () => {
    const instance = agent();
    instance.initMpp({ secretKey: TEST_SECRET, mode: 'pull' });
    const created = mockedMppx.create.mock.results[0].value as { fetch: jest.Mock };
    created.fetch.mockResolvedValueOnce(new Response('paid', { status: 200 }));
    const response = await instance.mppFetch('http://127.0.0.1/resource');
    expect(response.status).toBe(200);
    expect(created.fetch).toHaveBeenCalledWith('http://127.0.0.1/resource', undefined);
  });

  it.skip(
    'paid mppFetch against an upstream Charge server (blocked on stellar-mpp-sdk#108: npm @stellar/mpp@0.7.1 throws prepared.toEnvelope(...).v1 is not a function on stellar-sdk 17)',
    () => {
      // Once a published @stellar/mpp contains the sdk 17 XDR fix, exercise
      // the paid path with a loopback Charge stub (or a recorded 402) and
      // assert settlement without opening outbound sockets (#126).
    },
  );
});
