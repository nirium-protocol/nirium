/**
 * Unit tests for Payouts and Treasury client methods in packages/sdk (issue #354).
 * Covers createPayoutRun, submitPayout, submitPayoutOnboard, getPayoutRuns,
 * getTreasuryVault, getTreasuryVaults, buildTreasuryRebalance, and withdrawFromTreasuryVault.
 *
 * Mocks ESM dependencies and globalThis.fetch to avoid outbound connections and satisfy jest.no-network.js (#126).
 */

// Mock all ESM-only dependencies before importing index.ts (same pattern as x402serve-smoke.test.ts)
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
// stellar-sdk 16 loads ESM-only @noble/hashes; index.ts pulls it in through
// x402-policy.ts. Only the constants read at module load are needed here.
jest.mock('@stellar/stellar-sdk', () => ({
  Networks: { TESTNET: 'Test SDF Network ; September 2015', PUBLIC: 'Public Global Stellar Network ; September 2015' },
}), { virtual: true });

import { Agent } from './index';

describe('Agent - Payouts and Treasury client methods (issue #354)', () => {
    const originalFetch = globalThis.fetch;
    let agent: Agent;

    beforeEach(() => {
        agent = new Agent({
            apiKey: 'test-api-key-123',
            baseUrl: 'http://localhost:3002',
        });
    });

    afterEach(() => {
        globalThis.fetch = originalFetch;
        jest.restoreAllMocks();
    });

    // ─── Payouts Methods ─────────────────────────────────────────────────────

    describe('createPayoutRun', () => {
        it('sends POST to /api/payroll/run with options and returns response', async () => {
            const mockResponse = { runId: 'run-xyz-123', xdr: 'AAAA...', recipientCount: 2 };
            globalThis.fetch = jest.fn().mockResolvedValueOnce({
                ok: true,
                json: async () => mockResponse,
            }) as any;

            const payload = {
                recipients: [
                    { address: 'GBX5ZID6H4G365G7O4W6U4E6U4E6U4E6U4E6U4E6U4E6U4E6U4E6U4E6', amount: '10' },
                    { address: 'GD6W5F67P6D2M3H6C4U7O8P9Q1R2S3T4U5V6W7X8Y9Z0A1B2C3D4E5F6', amount: '20' },
                ],
                asset: 'USDC',
            };

            const result = await agent.createPayoutRun(payload as any);
            expect(result).toEqual(mockResponse);

            expect(globalThis.fetch).toHaveBeenCalledTimes(1);
            const [url, init] = (globalThis.fetch as jest.Mock).mock.calls[0];
            expect(url).toBe('http://localhost:3002/api/payroll/run');
            expect(init.method).toBe('POST');
            expect(init.headers['x-api-key']).toBe('test-api-key-123');
            expect(JSON.parse(init.body)).toEqual(payload);
        });

        it('throws descriptive error on API failure', async () => {
            globalThis.fetch = jest.fn().mockResolvedValueOnce({
                ok: false,
                status: 400,
                json: async () => ({ error: 'Invalid recipient list' }),
            }) as any;

            await expect(agent.createPayoutRun({} as any)).rejects.toThrow('Nirium API Error [400]');
        });
    });

    describe('submitPayout', () => {
        it('sends POST to /api/payroll/submit with runId and signedXdr', async () => {
            const mockResponse = { runId: 'run-xyz-123', txHash: 'tx-hash-789' };
            globalThis.fetch = jest.fn().mockResolvedValueOnce({
                ok: true,
                json: async () => mockResponse,
            }) as any;

            const result = await agent.submitPayout('run-xyz-123', 'AAAA-SIGNED-XDR');
            expect(result).toEqual(mockResponse);

            const [url, init] = (globalThis.fetch as jest.Mock).mock.calls[0];
            expect(url).toBe('http://localhost:3002/api/payroll/submit');
            expect(init.method).toBe('POST');
            expect(JSON.parse(init.body)).toEqual({ runId: 'run-xyz-123', signedXdr: 'AAAA-SIGNED-XDR' });
        });

        it('handles submission error gracefully', async () => {
            globalThis.fetch = jest.fn().mockResolvedValueOnce({
                ok: false,
                status: 422,
                json: async () => ({ error: 'Transaction rejected on-chain' }),
            }) as any;

            await expect(agent.submitPayout('run-xyz-123', 'invalid-xdr')).rejects.toThrow('Nirium API Error [422]');
        });
    });

    describe('submitPayoutOnboard', () => {
        it('sends POST to /api/payroll/onboard/submit with signedXdr', async () => {
            const mockResponse = { ok: true, txHash: 'trustline-tx-hash' };
            globalThis.fetch = jest.fn().mockResolvedValueOnce({
                ok: true,
                json: async () => mockResponse,
            }) as any;

            const result = await agent.submitPayoutOnboard('TRUSTLINE-SIGNED-XDR');
            expect(result).toEqual(mockResponse);

            const [url, init] = (globalThis.fetch as jest.Mock).mock.calls[0];
            expect(url).toBe('http://localhost:3002/api/payroll/onboard/submit');
            expect(init.method).toBe('POST');
            expect(JSON.parse(init.body)).toEqual({ signedXdr: 'TRUSTLINE-SIGNED-XDR' });
        });

        it('throws on onboarding failure', async () => {
            globalThis.fetch = jest.fn().mockResolvedValueOnce({
                ok: false,
                status: 500,
                statusText: 'Internal Server Error',
                json: async () => ({ error: 'Horizon timeout' }),
            }) as any;

            await expect(agent.submitPayoutOnboard('bad-xdr')).rejects.toThrow('Nirium API Error [500]');
        });
    });

    describe('getPayoutRuns', () => {
        it('sends GET to /api/payroll/runs and returns public run history', async () => {
            const mockResponse = {
                network: 'testnet',
                runs: [
                    { asset: 'USDC', totalAmount: '500', recipientCount: 5, txHash: 'tx-1' },
                ],
            };
            globalThis.fetch = jest.fn().mockResolvedValueOnce({
                ok: true,
                json: async () => mockResponse,
            }) as any;

            const result = await agent.getPayoutRuns();
            expect(result).toEqual(mockResponse);

            const [url, init] = (globalThis.fetch as jest.Mock).mock.calls[0];
            expect(url).toBe('http://localhost:3002/api/payroll/runs');
            expect(init.method).toBe('GET');
        });

        it('throws descriptive error on server failure', async () => {
            globalThis.fetch = jest.fn().mockResolvedValueOnce({
                ok: false,
                status: 500,
                json: async () => ({ error: 'Internal Server Error' }),
            }) as any;

            await expect(agent.getPayoutRuns()).rejects.toThrow('Nirium API Error [500]');
        });
    });

    // ─── Treasury Methods ────────────────────────────────────────────────────

    describe('getTreasuryVault', () => {
        it('sends GET to /api/treasury/vault/:vaultId without holder query if omitted', async () => {
            const mockResponse = { vaultId: 'vault-001', asset: 'USDC', balance: '10000' };
            globalThis.fetch = jest.fn().mockResolvedValueOnce({
                ok: true,
                json: async () => mockResponse,
            }) as any;

            const result = await agent.getTreasuryVault('vault-001');
            expect(result).toEqual(mockResponse);

            const [url, init] = (globalThis.fetch as jest.Mock).mock.calls[0];
            expect(url).toBe('http://localhost:3002/api/treasury/vault/vault-001');
            expect(init.method).toBe('GET');
        });

        it('appends holder query parameter when holder address is provided', async () => {
            const mockResponse = { vaultId: 'vault-001', holderBalance: '500' };
            globalThis.fetch = jest.fn().mockResolvedValueOnce({
                ok: true,
                json: async () => mockResponse,
            }) as any;

            const result = await agent.getTreasuryVault('vault-001', 'GBX5ZID6H4G365G7O4W6U4E6U4E6U4E6U4E6U4E6U4E6U4E6U4E6U4E6');
            expect(result).toEqual(mockResponse);

            const [url] = (globalThis.fetch as jest.Mock).mock.calls[0];
            expect(url).toContain('/api/treasury/vault/vault-001?holder=GBX5ZID6H4G365G7O4W6U4E6U4E6U4E6U4E6U4E6U4E6U4E6U4E6U4E6');
        });

        it('throws error when vaultId is not found', async () => {
            globalThis.fetch = jest.fn().mockResolvedValueOnce({
                ok: false,
                status: 404,
                json: async () => ({ error: 'Vault not found' }),
            }) as any;

            await expect(agent.getTreasuryVault('unknown-vault')).rejects.toThrow('Nirium API Error [404]');
        });
    });

    describe('getTreasuryVaults', () => {
        it('sends GET to /api/treasury/vaults without query if manager omitted', async () => {
            const mockResponse = { ok: true, network: 'testnet', vaults: [] };
            globalThis.fetch = jest.fn().mockResolvedValueOnce({
                ok: true,
                json: async () => mockResponse,
            }) as any;

            const result = await agent.getTreasuryVaults();
            expect(result).toEqual(mockResponse);

            const [url, init] = (globalThis.fetch as jest.Mock).mock.calls[0];
            expect(url).toBe('http://localhost:3002/api/treasury/vaults');
            expect(init.method).toBe('GET');
        });

        it('appends manager query when specified', async () => {
            const mockResponse = { ok: true, network: 'testnet', vaults: [{ vaultId: 'v-1' }] };
            globalThis.fetch = jest.fn().mockResolvedValueOnce({
                ok: true,
                json: async () => mockResponse,
            }) as any;

            const result = await agent.getTreasuryVaults('G-MANAGER-ADDR');
            expect(result).toEqual(mockResponse);

            const [url] = (globalThis.fetch as jest.Mock).mock.calls[0];
            expect(url).toBe('http://localhost:3002/api/treasury/vaults?manager=G-MANAGER-ADDR');
        });

        it('throws descriptive error on API failure', async () => {
            globalThis.fetch = jest.fn().mockResolvedValueOnce({
                ok: false,
                status: 500,
                json: async () => ({ error: 'Failed to retrieve vaults' }),
            }) as any;

            await expect(agent.getTreasuryVaults()).rejects.toThrow('Nirium API Error [500]');
        });
    });

    describe('buildTreasuryRebalance', () => {
        it('sends POST to /api/treasury/rebalance with rebalance payload', async () => {
            const mockResponse = { ok: true, xdr: 'REBALANCE-XDR-UNSIGNED' };
            globalThis.fetch = jest.fn().mockResolvedValueOnce({
                ok: true,
                json: async () => mockResponse,
            }) as any;

            const rebalancePayload = {
                vaultId: 'vault-001',
                fromStrategy: 'strat-a',
                toStrategy: 'strat-b',
                amount: '1000',
            };

            const result = await agent.buildTreasuryRebalance(rebalancePayload as any);
            expect(result).toEqual(mockResponse);

            const [url, init] = (globalThis.fetch as jest.Mock).mock.calls[0];
            expect(url).toBe('http://localhost:3002/api/treasury/rebalance');
            expect(init.method).toBe('POST');
            expect(JSON.parse(init.body)).toEqual(rebalancePayload);
        });

        it('throws on invalid rebalance parameters', async () => {
            globalThis.fetch = jest.fn().mockResolvedValueOnce({
                ok: false,
                status: 400,
                json: async () => ({ error: 'Invalid strategy allocation' }),
            }) as any;

            await expect(agent.buildTreasuryRebalance({} as any)).rejects.toThrow('Nirium API Error [400]');
        });
    });

    describe('withdrawFromTreasuryVault', () => {
        it('sends POST to /api/treasury/withdraw with withdrawal options', async () => {
            const mockResponse = { ok: true, xdr: 'WITHDRAW-XDR-UNSIGNED' };
            globalThis.fetch = jest.fn().mockResolvedValueOnce({
                ok: true,
                json: async () => mockResponse,
            }) as any;

            const withdrawPayload = {
                vaultId: 'vault-001',
                from: 'G-HOLDER-ADDR',
                shares: '50',
            };

            const result = await agent.withdrawFromTreasuryVault(withdrawPayload as any);
            expect(result).toEqual(mockResponse);

            const [url, init] = (globalThis.fetch as jest.Mock).mock.calls[0];
            expect(url).toBe('http://localhost:3002/api/treasury/withdraw');
            expect(init.method).toBe('POST');
            expect(JSON.parse(init.body)).toEqual(withdrawPayload);
        });

        it('throws error when withdrawal exceeds available shares', async () => {
            globalThis.fetch = jest.fn().mockResolvedValueOnce({
                ok: false,
                status: 400,
                json: async () => ({ error: 'Insufficient shares in vault' }),
            }) as any;

            await expect(agent.withdrawFromTreasuryVault({} as any)).rejects.toThrow('Nirium API Error [400]');
        });
    });
});
