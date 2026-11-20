import test from 'node:test';
import assert from 'node:assert/strict';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { InMemoryTransport } from '@modelcontextprotocol/sdk/inMemory.js';
import { createNiriumMcpServer, NiriumMcpOptions } from '../src/index.js';

// Mock response creator
function createMockResponse(data: unknown, status = 200) {
    return new Response(JSON.stringify(data), {
        status,
        headers: { 'Content-Type': 'application/json' },
    });
}

// Mock fetch handler simulating Nirium Agent API
const mockAgentApiFetch: typeof fetch = async (input, init) => {
    const url = typeof input === 'string' ? input : input instanceof URL ? input.toString() : input.url;

    if (url.includes('/api/tickers')) {
        return createMockResponse({ xlmUsdc: 0.12, sdexSpread: 0.001, baseFee: 100 });
    }
    if (url.includes('/api/loop/status')) {
        return createMockResponse({ running: false, scanCount: 42, uptime: 3600 });
    }
    if (url.includes('/api/loop/start')) {
        return createMockResponse({ started: true, config: init?.body ? JSON.parse(String(init.body)) : {} });
    }
    if (url.includes('/api/loop/stop')) {
        return createMockResponse({ stopped: true });
    }
    if (url.includes('/api/execute-demo')) {
        return createMockResponse({ simulation: true, executed: true });
    }
    if (url.includes('/api/nodes')) {
        return createMockResponse([{ id: 'node-1', status: 'online', network: 'testnet' }]);
    }
    if (url.includes('/api/audit/log')) {
        return createMockResponse({ cid: 'bafybeigdyrzt5sfp7udm7hu76uh7y26nf3efuylqabf3oclgtqy55fbzdi' });
    }
    if (url.includes('/api/reporting/summary')) {
        return createMockResponse({ settledPayouts: 10, totalUsdc: '500.00' });
    }
    if (url.includes('/api/treasury/info')) {
        return createMockResponse({ role: 'RebalanceManager', defindexSupported: true });
    }
    if (url.includes('/api/treasury/vault/')) {
        return createMockResponse({ vaultId: 'CVAULT123', assets: ['CUSDC'] });
    }
    if (url.includes('/api/treasury/vaults')) {
        return createMockResponse([{ vaultId: 'CVAULT123' }]);
    }
    if (url.includes('/api/treasury/strategy/')) {
        return createMockResponse({ strategyId: 'CSTRAT123', asset: 'CUSDC' });
    }
    if (url.includes('/api/treasury/deploy')) {
        return createMockResponse({ unsignedXdr: 'AAAA...deploy' });
    }
    if (url.includes('/api/treasury/deposit')) {
        return createMockResponse({ unsignedXdr: 'AAAA...deposit' });
    }
    if (url.includes('/api/treasury/withdraw')) {
        return createMockResponse({ unsignedXdr: 'AAAA...withdraw' });
    }
    if (url.includes('/api/treasury/set-rebalance-manager')) {
        return createMockResponse({ unsignedXdr: 'AAAA...set-rebalance' });
    }
    if (url.includes('/api/treasury/rebalance/execute')) {
        return createMockResponse({ txHash: '1234...hash', status: 'confirmed' });
    }
    if (url.includes('/api/treasury/rebalance')) {
        return createMockResponse({ unsignedXdr: 'AAAA...rebalance' });
    }
    if (url.includes('/api/treasury/submit')) {
        return createMockResponse({ txHash: '5678...hash', status: 'confirmed' });
    }
    if (url.includes('/api/v1/premium/') || url.includes('/api/v1/mpp/')) {
        return createMockResponse({ paidData: true, signals: [{ id: 1, action: 'BUY' }] });
    }

    return createMockResponse({ error: 'Not found' }, 404);
};

// Mock paid fetch handler representing a mock signer / payment facilitator
const mockPaidFetch: typeof fetch = async (input, init) => {
    return createMockResponse({ paid: true, facilitator: 'mock-signer', signals: [{ token: 'USDC' }] });
};

// All 25 registered tools with sample valid arguments for testing
const TOOL_DEFINITIONS: Record<string, { validArgs: Record<string, unknown>; invalidArgs: Record<string, unknown> }> = {
    get_market_state: {
        validArgs: {},
        invalidArgs: { unknownKey: 'extra' }, // schema is empty, should still pass or ignore
    },
    get_loop_status: {
        validArgs: {},
        invalidArgs: {},
    },
    start_loop: {
        validArgs: { minProfitPercentage: 0.5, maxBaseFee: 200 },
        invalidArgs: { minProfitPercentage: 'invalid-string' },
    },
    stop_loop: {
        validArgs: {},
        invalidArgs: {},
    },
    execute_demo: {
        validArgs: { strategy: 'flash-loan-arb', asset: 'XLM-USDC' },
        invalidArgs: { strategy: 12345 }, // invalid type
    },
    get_premium_signals: {
        validArgs: { count: 10 },
        invalidArgs: { count: 'not-a-number' },
    },
    get_premium_market: {
        validArgs: {},
        invalidArgs: {},
    },
    execute_paid_strategy: {
        validArgs: { strategy: 'blend-yield', asset: 'USDC', params: { amount: '100' } },
        invalidArgs: { strategy: 42 }, // invalid type
    },
    get_wallet_info: {
        validArgs: {},
        invalidArgs: {},
    },
    get_nodes: {
        validArgs: {},
        invalidArgs: {},
    },
    anchor_audit_record: {
        validArgs: { hash: 'e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855', network: 'testnet' },
        invalidArgs: {}, // missing both hash and record -> returns semantic error
    },
    get_reporting_summary: {
        validArgs: { from: '2026-01-01', to: '2026-02-01', network: 'testnet' },
        invalidArgs: { network: 'unsupported-network-xyz' }, // invalid enum
    },
    get_mpp_signals: {
        validArgs: { count: 5 },
        invalidArgs: { count: 'bad' },
    },
    get_mpp_market: {
        validArgs: {},
        invalidArgs: {},
    },
    get_treasury_info: {
        validArgs: {},
        invalidArgs: {},
    },
    get_treasury_vault: {
        validArgs: { vaultId: 'CVAULT123456789', holder: 'GABC123' },
        invalidArgs: { vaultId: 12345 }, // invalid type
    },
    get_treasury_vaults: {
        validArgs: { manager: 'GABC123' },
        invalidArgs: { manager: 12345 }, // invalid type
    },
    get_treasury_strategy_asset: {
        validArgs: { strategyId: 'CSTRAT123456789' },
        invalidArgs: { strategyId: 12345 }, // invalid type
    },
    deploy_treasury_vault: {
        validArgs: {
            manager: 'GMANAGER123',
            caller: 'GCALLER123',
            name: 'Yield Vault',
            symbol: 'YVLT',
            assets: [
                {
                    address: 'CASSET123',
                    strategies: [{ address: 'CSTRAT123', name: 'Blend' }],
                },
            ],
        },
        invalidArgs: { manager: 'GMANAGER123' }, // missing required fields: caller, name, symbol, assets
    },
    deposit_to_treasury_vault: {
        validArgs: { vault: 'CVAULT123', from: 'GFROM123', amounts: ['10000000'] },
        invalidArgs: { vault: 'CVAULT123', from: 'GFROM123', amounts: [] }, // amounts min(1) violation
    },
    withdraw_from_treasury_vault: {
        validArgs: { vault: 'CVAULT123', from: 'GFROM123', shares: '500' },
        invalidArgs: { vault: 12345 }, // invalid type
    },
    set_treasury_rebalance_manager: {
        validArgs: { vault: 'CVAULT123', manager: 'GMANAGER123', rebalanceManager: 'GNEWREBALANCE123' },
        invalidArgs: { vault: 'CVAULT123' }, // missing manager & rebalanceManager
    },
    build_treasury_rebalance: {
        validArgs: {
            vault: 'CVAULT123',
            instructions: [{ kind: 'Invest', strategy: 'CSTRAT123', amount: '1000000' }],
        },
        invalidArgs: { vault: 'CVAULT123', instructions: [] }, // min(1) instructions violation
    },
    execute_treasury_rebalance: {
        validArgs: {
            vault: 'CVAULT123',
            instructions: [{ kind: 'Unwind', strategy: 'CSTRAT123', amount: '500000' }],
        },
        invalidArgs: { vault: 'CVAULT123', instructions: [] }, // min(1) instructions violation
    },
    submit_treasury_tx: {
        validArgs: { xdr: 'AAAA...signedXdr' },
        invalidArgs: { xdr: 99999 }, // invalid type
    },
};

test('Nirium MCP Server: verifies tool registry completeness', () => {
    const server = createNiriumMcpServer({ fetchFn: mockAgentApiFetch });
    const tools = (server as any)._registeredTools;

    const registeredNames = Object.keys(tools);
    assert.equal(registeredNames.length, 25, `Expected exactly 25 tools, found ${registeredNames.length}`);

    const expectedNames = Object.keys(TOOL_DEFINITIONS);
    for (const name of expectedNames) {
        assert.ok(tools[name], `Tool ${name} must be registered on server`);
        assert.ok(tools[name].description, `Tool ${name} must have a non-empty description`);
        assert.ok(typeof tools[name].handler === 'function', `Tool ${name} must have an executable handler`);
    }
});

test('Nirium MCP Server: checks input schema validation for every tool', () => {
    const server = createNiriumMcpServer({ fetchFn: mockAgentApiFetch });
    const tools = (server as any)._registeredTools;

    for (const [toolName, def] of Object.entries(TOOL_DEFINITIONS)) {
        const tool = tools[toolName];
        assert.ok(tool, `Tool ${toolName} not found`);

        const schema = tool.inputSchema;
        assert.ok(schema, `Tool ${toolName} has no inputSchema`);

        // Validate valid arguments pass schema validation
        const validParsed = schema.safeParse(def.validArgs);
        assert.ok(validParsed.success, `Tool ${toolName} schema rejected valid args: ${JSON.stringify(validParsed.error?.format())}`);

        // If defined, test schema rejects invalid arguments
        if (Object.keys(def.invalidArgs).length > 0 && toolName !== 'get_market_state' && toolName !== 'anchor_audit_record') {
            const invalidParsed = schema.safeParse(def.invalidArgs);
            assert.equal(invalidParsed.success, false, `Tool ${toolName} schema unexpectedly accepted invalid args`);
        }
    }
});

test('Nirium MCP Server: calls every tool handler with valid input and verifies result shape', async () => {
    const server = createNiriumMcpServer({
        fetchFn: mockAgentApiFetch,
        paidFetch: mockPaidFetch,
        mppFetch: mockPaidFetch,
        niriumApiKey: 'test-api-key',
    });
    const tools = (server as any)._registeredTools;

    for (const [toolName, def] of Object.entries(TOOL_DEFINITIONS)) {
        const tool = tools[toolName];
        const res = await tool.handler(def.validArgs, {});

        // Result shape assertions
        assert.ok(res, `Tool ${toolName} returned null or undefined`);
        assert.ok(Array.isArray(res.content), `Tool ${toolName} content must be an array`);
        assert.ok(res.content.length >= 1, `Tool ${toolName} content array must have at least 1 element`);
        assert.equal(res.content[0].type, 'text', `Tool ${toolName} content[0].type must be 'text'`);
        assert.ok(typeof res.content[0].text === 'string' && res.content[0].text.length > 0, `Tool ${toolName} text must be a non-empty string`);
        assert.notEqual(res.isError, true, `Tool ${toolName} unexpectedly returned isError=true for valid input: ${res.content[0].text}`);
    }
});

test('Nirium MCP Server: calls tools with invalid input and checks clear error instead of throwing', async () => {
    const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();
    const server = createNiriumMcpServer({
        fetchFn: mockAgentApiFetch,
        paidFetch: mockPaidFetch,
        mppFetch: mockPaidFetch,
    });
    const client = new Client({ name: 'test-client', version: '1.0.0' });

    await Promise.all([server.connect(serverTransport), client.connect(clientTransport)]);

    // 1. Invalid argument type
    const invalidTypeRes = await client.callTool({
        name: 'execute_demo',
        arguments: { strategy: 12345, asset: 'XLM-USDC' },
    });
    assert.equal(invalidTypeRes.isError, true, 'execute_demo must return isError=true on invalid argument type');
    assert.ok(String(invalidTypeRes.content[0].text).includes('Invalid arguments'), 'Must return clear validation error');

    // 2. Missing required fields in deploy_treasury_vault
    const missingDeployRes = await client.callTool({
        name: 'deploy_treasury_vault',
        arguments: { manager: 'G123' },
    });
    assert.equal(missingDeployRes.isError, true, 'deploy_treasury_vault must return isError=true on missing required fields');

    // 3. Invalid enum in get_reporting_summary
    const invalidEnumRes = await client.callTool({
        name: 'get_reporting_summary',
        arguments: { network: 'not-a-valid-network' },
    });
    assert.equal(invalidEnumRes.isError, true, 'get_reporting_summary must return isError=true on invalid network enum');

    // 4. Semantic error in anchor_audit_record (neither hash nor record provided)
    const emptyAnchorRes = await client.callTool({
        name: 'anchor_audit_record',
        arguments: {},
    });
    assert.equal(emptyAnchorRes.isError, true, 'anchor_audit_record must return isError=true when both hash and record are missing');
    assert.ok(String(emptyAnchorRes.content[0].text).includes('Provide `hash`'), 'Must provide clear guidance on missing fields');

    await client.close();
});

test('Nirium MCP Server: tools that sign or spend refuse without explicit amount limits', async () => {
    const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();
    const server = createNiriumMcpServer({ fetchFn: mockAgentApiFetch });
    const client = new Client({ name: 'test-client', version: '1.0.0' });

    await Promise.all([server.connect(serverTransport), client.connect(clientTransport)]);

    // 1. deposit_to_treasury_vault: empty amounts array must be refused
    const emptyAmountsRes = await client.callTool({
        name: 'deposit_to_treasury_vault',
        arguments: { vault: 'CVAULT123', from: 'GFROM123', amounts: [] },
    });
    assert.equal(emptyAmountsRes.isError, true, 'deposit_to_treasury_vault must refuse empty amounts array');
    assert.ok(String(emptyAmountsRes.content[0].text).includes('Array must contain at least 1 element(s)'));

    // 2. build_treasury_rebalance: empty instructions array must be refused
    const emptyRebalanceRes = await client.callTool({
        name: 'build_treasury_rebalance',
        arguments: { vault: 'CVAULT123', instructions: [] },
    });
    assert.equal(emptyRebalanceRes.isError, true, 'build_treasury_rebalance must refuse empty instructions array');

    // 3. execute_treasury_rebalance: empty instructions or missing amount must be refused
    const emptyExecuteRes = await client.callTool({
        name: 'execute_treasury_rebalance',
        arguments: { vault: 'CVAULT123', instructions: [] },
    });
    assert.equal(emptyExecuteRes.isError, true, 'execute_treasury_rebalance must refuse empty instructions array');

    const missingAmountRes = await client.callTool({
        name: 'execute_treasury_rebalance',
        arguments: {
            vault: 'CVAULT123',
            instructions: [{ kind: 'Invest', strategy: 'CSTRAT123' }], // missing amount
        },
    });
    assert.equal(missingAmountRes.isError, true, 'execute_treasury_rebalance must refuse instruction without explicit amount');

    await client.close();
});

test('Nirium MCP Server: paid tools refuse when wallet/RPC is unset (zero keys)', async () => {
    const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();
    // Default server with zero keys/secrets
    const server = createNiriumMcpServer({ fetchFn: mockAgentApiFetch, stellarKey: '', rpcUrl: '' });
    const client = new Client({ name: 'test-client', version: '1.0.0' });

    await Promise.all([server.connect(serverTransport), client.connect(clientTransport)]);

    const paidTools = [
        'get_premium_signals',
        'get_premium_market',
        'execute_paid_strategy',
        'get_mpp_signals',
        'get_mpp_market',
    ];

    for (const toolName of paidTools) {
        const res = await client.callTool({
            name: toolName,
            arguments: TOOL_DEFINITIONS[toolName].validArgs,
        });

        assert.equal(res.isError, true, `Paid tool ${toolName} must return isError=true when wallet is unset`);
        assert.ok(
            String(res.content[0].text).includes('Payment tools unavailable'),
            `Paid tool ${toolName} must return clear unavailable message, got: ${res.content[0].text}`,
        );
    }

    await client.close();
});

test('Nirium MCP Server: paid tools refuse when STELLAR_SECRET_KEY is invalid (signer error handling)', async () => {
    const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();
    // Server with invalid key that causes signer creation to throw
    const server = createNiriumMcpServer({
        fetchFn: mockAgentApiFetch,
        stellarKey: 'S_INVALID_KEY_NOT_ED25519',
        rpcUrl: 'https://soroban-testnet.stellar.org',
    });
    const client = new Client({ name: 'test-client', version: '1.0.0' });

    await Promise.all([server.connect(serverTransport), client.connect(clientTransport)]);

    const res = await client.callTool({
        name: 'get_premium_signals',
        arguments: {},
    });

    assert.equal(res.isError, true, 'Paid tool must return isError=true when secret key is invalid');
    assert.ok(
        String(res.content[0].text).includes('Failed to initialize x402 signer'),
        `Expected error mentioning failed signer initialization, got: ${res.content[0].text}`,
    );

    await client.close();
});

test('Nirium MCP Server: end-to-end client lists all 25 tools over InMemoryTransport', async () => {
    const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();
    const server = createNiriumMcpServer({ fetchFn: mockAgentApiFetch });
    const client = new Client({ name: 'test-client', version: '1.0.0' });

    await Promise.all([server.connect(serverTransport), client.connect(clientTransport)]);

    const result = await client.listTools();
    assert.equal(result.tools.length, 25, `Expected 25 tools listed, got ${result.tools.length}`);

    // Verify wallet info tool response format
    const walletInfoRes = await client.callTool({ name: 'get_wallet_info', arguments: {} });
    assert.equal(walletInfoRes.isError, undefined);
    const walletData = JSON.parse(walletInfoRes.content[0].text as string);
    assert.equal(walletData.freeTools.length, 10);
    assert.equal(walletData.authenticatedTools.length, 9);
    assert.equal(walletData.paidToolsX402.length, 3);
    assert.equal(walletData.paidToolsMpp.length, 2);

    await client.close();
});
