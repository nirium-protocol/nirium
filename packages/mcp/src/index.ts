#!/usr/bin/env node
// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 Nirium Protocol Contributors

// ═══════════════════════════════════════════════════════════════
// Nirium MCP Server — x402 + MPP + node tool suite
// ═══════════════════════════════════════════════════════════════
//
// Exposes Nirium Protocol capabilities to any MCP-compatible AI:
//   Claude, GPT, Codex, Cursor, VS Code Copilot, etc.
//
// Three tiers of tools:
//   FREE  — market data, loop status, node catalog, audit anchoring,
//           reporting summaries (standard HTTP to agent API)
//   PAID (x402) — premium signals via the OpenZeppelin Channels facilitator
//   PAID (MPP)  — same signals via direct Soroban SAC transfer,
//                 no external facilitator required
//
// Paid tools need STELLAR_SECRET_KEY, and on mainnet also SOROBAN_RPC_URL
// (Stellar publishes no open mainnet RPC). Free tools need neither.
//
// Usage (stdio transport, from source):
//   STELLAR_SECRET_KEY=S... AGENT_API_URL=http://localhost:3002 npx tsx src/index.ts
//
// Claude Desktop config (published package):
//   {
//     "mcpServers": {
//       "nirium": {
//         "command": "npx",
//         "args": ["-y", "nirium-mcp"],
//         "env": {
//           "STELLAR_SECRET_KEY": "S...",
//           "AGENT_API_URL": "https://nirium-agent.fly.dev"
//         }
//       }
//     }
//   }
//
// ═══════════════════════════════════════════════════════════════

import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import { z } from 'zod';
import { wrapFetchWithPayment, x402Client } from '@x402/fetch';
import { ExactStellarScheme } from '@x402/stellar';
import { createEd25519Signer, STELLAR_TESTNET_CAIP2, DEFAULT_TESTNET_RPC_URL } from '@x402/stellar';
import { Mppx as MppxClient } from 'mppx/client';
import { stellar as mppStellar } from '@stellar/mpp/charge/client';

// ─── Configuration ────────────────────────────────────────────

const API_URL        = process.env.AGENT_API_URL       || 'http://127.0.0.1:3002';
const STELLAR_KEY    = process.env.STELLAR_SECRET_KEY  || '';
const NIRIUM_API_KEY = process.env.NIRIUM_API_KEY      || '';
const IS_MAINNET     = process.env.STELLAR_NETWORK === 'mainnet';
const STELLAR_NET    = (IS_MAINNET
    ? 'stellar:pubnet'
    : STELLAR_TESTNET_CAIP2) as 'stellar:testnet' | 'stellar:pubnet';

// El default de RPC solo sirve para testnet: Stellar no publica un RPC de
// mainnet abierto (el propio @x402/stellar lanza "mainnet requires a non-empty
// rpcUrl"). Sin este guard, mainnet caía al RPC de testnet con el network id de
// pubnet y el pago fallaba de forma confusa, con fondos reales. El RPC lo pone
// quien corre el server — el endpoint dedicado de Nirium lleva token y vive
// como secreto del backend, nunca dentro de un paquete publicado.
const RPC_URL = process.env.SOROBAN_RPC_URL
    || (IS_MAINNET ? '' : DEFAULT_TESTNET_RPC_URL);

// Sin RPC válido no se puede firmar un pago; las herramientas gratuitas siguen vivas.
const PAYMENTS_ENABLED = !!STELLAR_KEY && !!RPC_URL;
const PAYMENTS_DISABLED_REASON = PAYMENTS_ENABLED
    ? ''
    : !STELLAR_KEY
        ? 'STELLAR_SECRET_KEY is not set — paid tools need a funded Stellar wallet.'
        : 'STELLAR_NETWORK=mainnet requires SOROBAN_RPC_URL (Stellar publishes no open mainnet RPC). '
          + 'Pick a provider at https://developers.stellar.org/docs/data/apis/rpc/providers';

// Derive public key from secret key if available, or use explicit env var
const STELLAR_PUBLIC_KEY = (() => {
    if (process.env.STELLAR_PUBLIC_KEY) return process.env.STELLAR_PUBLIC_KEY;
    if (STELLAR_KEY) {
        try { return createEd25519Signer(STELLAR_KEY, STELLAR_NET).address; } catch { return ''; }
    }
    return '';
})();

// Auth headers for authenticated endpoints
const authHeaders = (): Record<string, string> =>
    NIRIUM_API_KEY ? { 'x-api-key': NIRIUM_API_KEY } : {};

// Auth + legal consent headers (required by loop/start and execute endpoints)
const consentHeaders = (): Record<string, string> => ({
    ...authHeaders(),
    ...(STELLAR_PUBLIC_KEY ? { 'x-stellar-account': STELLAR_PUBLIC_KEY } : {}),
});

// ─── x402 Payment Client ──────────────────────────────────────
//
// Set up once; reused for all x402 premium tool calls.
// Requires STELLAR_SECRET_KEY env var with funded testnet wallet.
//

let paidFetch: typeof fetch = fetch;

if (PAYMENTS_ENABLED) {
    const signer = createEd25519Signer(STELLAR_KEY, STELLAR_NET);
    const client = new x402Client()
        .register(STELLAR_NET, new ExactStellarScheme(signer, { url: RPC_URL }));
    paidFetch = wrapFetchWithPayment(fetch, client) as typeof fetch;
    console.error(`[Nirium MCP] x402 wallet: ${signer.address} | network: ${STELLAR_NET}`);
} else {
    console.error(`[Nirium MCP] Paid tools disabled — ${PAYMENTS_DISABLED_REASON}`);
}

// ─── MPP Payment Client ───────────────────────────────────────
//
// MPP Charge mode: per-request Soroban SAC transfer.
// No external facilitator — server verifies directly.
// Same STELLAR_SECRET_KEY funds both x402 and MPP payments.
//

let mppFetch: typeof fetch = fetch;

if (PAYMENTS_ENABLED) {
    const mppx = MppxClient.create({
        methods: [
            mppStellar.charge({
                secretKey: STELLAR_KEY,
                rpcUrl: RPC_URL,
            }),
        ],
    });
    mppFetch = mppx.fetch as typeof fetch;
    console.error(`[Nirium MCP] MPP Charge enabled | network: ${STELLAR_NET}`);
} else {
    console.error(`[Nirium MCP] MPP tools disabled — ${PAYMENTS_DISABLED_REASON}`);
}

// ─── Server ───────────────────────────────────────────────────

// La versión se lee de package.json: antes estaba escrita a mano en tres lugares
// y se quedaba atrás en cada release. dist/ queda un nivel debajo de package.json.
const PKG_VERSION: string = require('../package.json').version;

const server = new McpServer(
    { name: 'nirium-mcp-server', version: PKG_VERSION },
    { capabilities: { tools: {} } },
);

type ToolResult = { content: [{ type: 'text'; text: string }]; isError?: boolean };

const text = (body: unknown): ToolResult =>
    ({ content: [{ type: 'text', text: typeof body === 'string' ? body : JSON.stringify(body, null, 2) }] });

const fail = (message: string): ToolResult =>
    ({ content: [{ type: 'text', text: message }], isError: true });

// Un pago sin wallet o sin RPC de mainnet no puede firmarse: decirlo aquí evita
// que el modelo reciba un 402 opaco y lo reporte como "el servidor falló".
const paymentsUnavailable = (): ToolResult | null =>
    PAYMENTS_ENABLED ? null : fail(`Payment tools unavailable: ${PAYMENTS_DISABLED_REASON}`);

// Los nodos gratuitos comparten forma: GET/POST → JSON, error legible.
async function callJson(
    url: string,
    init?: RequestInit,
    doFetch: typeof fetch = fetch,
): Promise<ToolResult> {
    try {
        const res = await doFetch(url, init);
        if (!res.ok) return fail(`Error ${res.status}: ${await res.text()}`);
        return text(await res.json());
    } catch (err) {
        return fail(`Request failed: ${err instanceof Error ? err.message : String(err)}`);
    }
}

// ─── FREE TOOLS ───────────────────────────────────────────────

server.tool(
    'get_market_state',
    'Fetch real-time market data: XLM/USDC price (CoinGecko), SDEX spread, base fee, Blend supply/borrow rate, CETES rate. Free — no API key required.',
    {},
    async () => {
        const res = await fetch(`${API_URL}/api/tickers`);
        const data = await res.json();
        return { content: [{ type: 'text', text: JSON.stringify(data, null, 2) }] };
    },
);

server.tool(
    'get_loop_status',
    'Check the autonomous scanning loop: running/stopped, scan count, uptime, last AI decision. Free.',
    {},
    async () => {
        const res = await fetch(`${API_URL}/api/loop/status`);
        const data = await res.json();
        return { content: [{ type: 'text', text: JSON.stringify(data, null, 2) }] };
    },
);

server.tool(
    'start_loop',
    'Start the autonomous market scanning loop. Requires NIRIUM_API_KEY env var.',
    {
        minProfitPercentage: z.number().optional().describe('Minimum profit % to trigger (default: 0.3)'),
        maxBaseFee: z.number().optional().describe('Max Stellar base fee in stroops (default: 500)'),
    },
    async (args) => {
        const res = await fetch(`${API_URL}/api/loop/start`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json', ...consentHeaders() },
            body: JSON.stringify({ config: args }),
        });
        const data = await res.json();
        return { content: [{ type: 'text', text: JSON.stringify(data, null, 2) }] };
    },
);

server.tool(
    'stop_loop',
    'Stop the autonomous scanning loop. Requires NIRIUM_API_KEY env var.',
    {},
    async () => {
        const res = await fetch(`${API_URL}/api/loop/stop`, {
            method: 'POST',
            headers: authHeaders(),
        });
        const data = await res.json();
        return { content: [{ type: 'text', text: JSON.stringify(data, null, 2) }] };
    },
);

server.tool(
    'execute_demo',
    'Dry-run a strategy via Soroban simulation — no real transaction. Free.',
    {
        strategy: z.string().describe('Strategy name: flash-loan-arb, path-arbitrage, cross-dex, blend-yield, soroswap-swap'),
        asset: z.string().describe('Trading pair, e.g. XLM-USDC'),
    },
    async (args) => {
        const res = await fetch(`${API_URL}/api/execute-demo`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(args),
        });
        const data = await res.json();
        return { content: [{ type: 'text', text: JSON.stringify(data, null, 2) }] };
    },
);

// ─── PAID TOOLS (x402) ────────────────────────────────────────
//
// Each call automatically:
//   1. Hits the endpoint → receives HTTP 402 + payment requirements
//   2. Signs a Soroban auth entry for the USDC amount
//   3. Submits X-PAYMENT header → receives 200 + data
//
// Cost: $0.02 USDC per signals call, $0.05 per market call, $0.25 per execution.
// Requires STELLAR_SECRET_KEY env var with funded testnet wallet.
//

server.tool(
    'get_premium_signals',
    'PAID ($0.02 USDC via x402) — TESTNET ONLY: signals are produced by the autonomous loop, which runs on testnet; the mainnet box has no loop and returns 501 without charging. Signals reference testnet tokens, which have no monetary value, and are not a recommendation to buy, sell or hold anything. Requires funded Stellar wallet.',
    {
        count: z.number().optional().describe('Number of signals to fetch (default: 20, max: 100)'),
    },
    async (args) =>
        paymentsUnavailable()
        ?? callJson(`${API_URL}/api/v1/premium/signals?count=${args.count || 20}`, undefined, paidFetch),
);

server.tool(
    'get_premium_market',
    'PAID ($0.05 USDC via x402) — Market state with reference rates attributed to their source, network fee pressure, and a description of current network conditions. Factual data only: no recommendation, no advice, no signal to act. Requires funded Stellar wallet.',
    {},
    async () =>
        paymentsUnavailable()
        ?? callJson(`${API_URL}/api/v1/premium/market`, undefined, paidFetch),
);

server.tool(
    'execute_paid_strategy',
    'PAID ($0.25 USDC via x402) — Execute a DeFi strategy on Stellar via Soroban. No Nirium account required — pay per execution. Requires funded Stellar wallet.',
    {
        strategy: z.string().describe('Strategy: flash-loan-arb | path-arbitrage | cross-dex | blend-yield | soroswap-swap'),
        asset: z.string().describe('Trading pair, e.g. XLM-USDC'),
        params: z.record(z.unknown()).optional().describe('Strategy-specific parameters'),
    },
    async (args) =>
        paymentsUnavailable()
        ?? callJson(`${API_URL}/api/v1/premium/execute`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(args),
        }, paidFetch),
);

server.tool(
    'get_wallet_info',
    'Show the x402 (MPP experimental) wallet address and payment configuration for this MCP session. Free.',
    {},
    async () => text({
        address: STELLAR_PUBLIC_KEY || null,
        network: STELLAR_NET,
        rpcUrl: RPC_URL || null,
        agentApiUrl: API_URL,
        niriumApiKeySet: !!NIRIUM_API_KEY,
        x402Enabled: PAYMENTS_ENABLED,
        mppEnabled: PAYMENTS_ENABLED,
        ...(PAYMENTS_ENABLED ? {} : { paymentsDisabledReason: PAYMENTS_DISABLED_REASON }),
        freeTools: [
            'get_market_state', 'get_loop_status', 'execute_demo', 'get_nodes',
            'anchor_audit_record', 'get_reporting_summary',
            'get_treasury_info', 'get_treasury_vault', 'get_treasury_vaults', 'get_treasury_strategy_asset',
        ],
        authenticatedTools: [
            'start_loop', 'stop_loop',
            'deploy_treasury_vault', 'deposit_to_treasury_vault', 'withdraw_from_treasury_vault',
            'set_treasury_rebalance_manager', 'build_treasury_rebalance', 'execute_treasury_rebalance',
            'submit_treasury_tx',
        ],
        paidToolsX402: ['get_premium_signals', 'get_premium_market', 'execute_paid_strategy'],
        paidToolsMpp: ['get_mpp_signals', 'get_mpp_market'],
    }),
);

// ─── NODE CATALOG + AUDIT + REPORTING (free) ──────────────────
//
// Los nodos non-custodial que ya corren en mainnet. Ninguno mueve fondos:
// el catálogo es lectura, el anclaje sube un hash a IPFS y el reporting
// agrega recibos existentes — por eso no llevan wallet ni pago.
//

server.tool(
    'get_nodes',
    'List the Nirium execution nodes with their live status, custody model and network (testnet/mainnet). Free — reads the protocol registry.',
    {},
    async () => callJson(`${API_URL}/api/nodes`),
);

server.tool(
    'anchor_audit_record',
    'Anchor evidence to IPFS and get back a CID (immutable integrity seal, not notarization). '
    + 'Pass `hash` (sha-256 hex of your own file/event) or `record` (small JSON object, max 8KB). '
    + 'Anchor hashes rather than raw personal data — IPFS content cannot be deleted. Free during open beta.',
    {
        hash: z.string().optional().describe('sha-256 hex (64 chars), optionally prefixed "sha-256:"'),
        record: z.record(z.unknown()).optional().describe('Small JSON object to anchor verbatim (max 8KB)'),
        txHash: z.string().optional().describe('Related Stellar transaction hash, if any'),
        network: z.string().optional().describe('Network label to store with the anchor, e.g. mainnet'),
        tag: z.string().optional().describe('Free-form label to group anchors'),
    },
    async (args) => {
        if (!args.hash && !args.record)
            return fail('Provide `hash` (sha-256 of your evidence) or `record` (small JSON object).');
        return callJson(`${API_URL}/api/audit/log`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json', ...authHeaders() },
            body: JSON.stringify(args),
        });
    },
);

server.tool(
    'get_reporting_summary',
    'Institutional-format summary of settled payouts, x402 payment receipts and IPFS anchors for a period. '
    + 'Not certified regulatory reporting — filings remain the client\'s responsibility. Free.',
    {
        from: z.string().optional().describe('ISO start date, e.g. 2026-07-01 (defaults to last 30 days)'),
        to: z.string().optional().describe('ISO end date'),
        network: z.enum(['testnet', 'mainnet']).optional().describe('Filter by network; omit for all'),
    },
    async (args) => {
        const q = new URLSearchParams(
            Object.entries(args).filter(([, v]) => v !== undefined) as [string, string][],
        ).toString();
        return callJson(`${API_URL}/api/reporting/summary${q ? `?${q}` : ''}`, { headers: authHeaders() });
    },
);

// ─── PAID TOOLS (MPP) ─────────────────────────────────────────
//
// MPP Charge mode: no external facilitator.
// The client signs a Soroban SAC transfer and sends it inline.
// Server verifies the on-chain transfer and returns 200.
//
// Advantage over x402: no Coinbase facilitator dependency.
// Both x402 and MPP tools are available — client chooses.
//

server.tool(
    'get_mpp_signals',
    'PAID ($0.02 USDC via MPP Charge) — TESTNET ONLY, same data as get_premium_signals, settled via direct Soroban SAC transfer with no external facilitator. Testnet tokens have no monetary value; this is not a recommendation to buy, sell or hold anything. Requires funded Stellar wallet.',
    {
        count: z.number().optional().describe('Number of signals to fetch (default: 20, max: 100)'),
    },
    async (args) =>
        paymentsUnavailable()
        ?? callJson(`${API_URL}/api/v1/mpp/signals?count=${args.count || 20}`, undefined, mppFetch),
);

server.tool(
    'get_mpp_market',
    'PAID ($0.05 USDC via MPP Charge) — Market state settled via direct Soroban SAC transfer, no external facilitator. Reference rates with their source, fee pressure, and network conditions. Factual data only: no recommendation or advice. Requires funded Stellar wallet.',
    {},
    async () =>
        paymentsUnavailable()
        ?? callJson(`${API_URL}/api/v1/mpp/market`, undefined, mppFetch),
);

// ─── TREASURY (DeFindex) ───────────────────────────────────────
//
// Nirium never holds these funds. It holds the RebalanceManager role of a
// DeFindex vault the client deploys and owns. The four read tools below hit
// public GET routes — free, no key required. The write tools hit routes
// behind the agent's own auth (NIRIUM_API_KEY) and every one of them returns
// an UNSIGNED XDR *except* execute_treasury_rebalance, which is the one
// route the agent signs itself, with its own server-side key — never the
// caller's. Even then it cannot withdraw: rebalance() takes no destination
// address, so the funds never leave the vault.
//

server.tool(
    'get_treasury_info',
    'Treasury node metadata: what role Nirium holds on DeFindex vaults, what it can and cannot do, fees, security notes. Free.',
    {},
    async () => callJson(`${API_URL}/api/treasury/info`),
);

server.tool(
    'get_treasury_vault',
    "Read a DeFindex vault's roles, assets and managed funds. Pass `holder` to also get that account's balance in the vault's asset. Free.",
    {
        vaultId: z.string().describe('Vault contract id (C...)'),
        holder: z.string().optional().describe('Stellar account (G...) to check the balance of'),
    },
    async (args) => {
        const q = args.holder ? `?holder=${encodeURIComponent(args.holder)}` : '';
        return callJson(`${API_URL}/api/treasury/vault/${args.vaultId}${q}`);
    },
);

server.tool(
    'get_treasury_vaults',
    'List DeFindex vaults Nirium has deployed or read, on the current network. Free.',
    {
        manager: z.string().optional().describe('Filter by vault Manager (G...)'),
    },
    async (args) => {
        const q = args.manager ? `?manager=${encodeURIComponent(args.manager)}` : '';
        return callJson(`${API_URL}/api/treasury/vaults${q}`);
    },
);

server.tool(
    'get_treasury_strategy_asset',
    'Read which asset a DeFindex strategy manages, as declared by the strategy itself — pairs it correctly before deploying a vault. Free.',
    {
        strategyId: z.string().describe('Strategy contract id (C...)'),
    },
    async (args) => callJson(`${API_URL}/api/treasury/strategy/${args.strategyId}`),
);

server.tool(
    'deploy_treasury_vault',
    "Build an UNSIGNED XDR to deploy a DeFindex vault. `manager` keeps control (rescue, pause, revoke); Nirium only ever holds `rebalanceManager`, which cannot withdraw or change roles. Sign the returned XDR with `caller` and broadcast it with submit_treasury_tx. Requires NIRIUM_API_KEY env var.",
    {
        manager: z.string().describe('Stellar account (G...) that owns and controls the vault'),
        caller: z.string().describe('Stellar account (G...) that pays to deploy and signs the returned XDR'),
        assets: z.array(z.object({
            address: z.string().describe('Asset contract id (C...)'),
            strategies: z.array(z.object({
                address: z.string().describe('Strategy contract id (C...)'),
                name: z.string(),
            })).min(1),
        })).min(1),
        name: z.string(),
        symbol: z.string(),
        emergencyManager: z.string().optional().describe('Defaults to `manager`'),
        feeReceiver: z.string().optional().describe('Defaults to `manager`'),
        rebalanceManager: z.string().optional().describe("Defaults to Nirium's configured role address; required as an explicit value on mainnet"),
    },
    async (args) => callJson(`${API_URL}/api/treasury/deploy`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', ...authHeaders() },
        body: JSON.stringify(args),
    }),
);

server.tool(
    'deposit_to_treasury_vault',
    'Build an UNSIGNED XDR to deposit into a DeFindex vault. Sign with `from` and broadcast it with submit_treasury_tx. Requires NIRIUM_API_KEY env var.',
    {
        vault: z.string().describe('Vault contract id (C...)'),
        from: z.string().describe('Stellar account (G...) funding the deposit and signing the returned XDR'),
        amounts: z.array(z.string()).min(1).describe('One amount per vault asset, in stroops, as strings — an i128 does not survive a JSON number'),
        invest: z.boolean().optional().describe('Invest the deposit into the strategy immediately. Default true.'),
        maxSlippageBps: z.number().optional(),
    },
    async (args) => callJson(`${API_URL}/api/treasury/deposit`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', ...authHeaders() },
        body: JSON.stringify(args),
    }),
);

server.tool(
    'withdraw_from_treasury_vault',
    'Build an UNSIGNED XDR to withdraw from a DeFindex vault. Omit `shares` to withdraw everything the account holds. Sign with `from` and broadcast it with submit_treasury_tx. Requires NIRIUM_API_KEY env var.',
    {
        vault: z.string().describe('Vault contract id (C...)'),
        from: z.string().describe('Stellar account (G...) holding the vault shares and signing the returned XDR'),
        shares: z.string().optional().describe('Vault shares to redeem, as an integer string. Omit to withdraw everything.'),
        maxSlippageBps: z.number().optional(),
    },
    async (args) => callJson(`${API_URL}/api/treasury/withdraw`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', ...authHeaders() },
        body: JSON.stringify(args),
    }),
);

server.tool(
    'set_treasury_rebalance_manager',
    "Build an UNSIGNED XDR handing the RebalanceManager role to a new address. Only the vault's current Manager can sign it — the same door that grants Nirium the role also revokes it. Requires NIRIUM_API_KEY env var.",
    {
        vault: z.string().describe('Vault contract id (C...)'),
        manager: z.string().describe("The vault's current Manager (G...), who must sign the returned XDR"),
        rebalanceManager: z.string().describe('The new RebalanceManager address (G...)'),
    },
    async (args) => callJson(`${API_URL}/api/treasury/set-rebalance-manager`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', ...authHeaders() },
        body: JSON.stringify(args),
    }),
);

const treasuryInstruction = z.object({
    kind: z.enum(['Unwind', 'Invest']),
    strategy: z.string().describe('Strategy contract id (C...)'),
    amount: z.string().describe('Stroops, as a string — an i128 does not survive a JSON number'),
});

server.tool(
    'build_treasury_rebalance',
    "Build an UNSIGNED rebalance XDR — Unwind/Invest between a vault's own strategies only; no other instruction is expressible, and none takes a destination address. Sign with the vault's RebalanceManager and broadcast it with submit_treasury_tx. Requires NIRIUM_API_KEY env var.",
    {
        vault: z.string().describe('Vault contract id (C...)'),
        instructions: z.array(treasuryInstruction).min(1),
        caller: z.string().optional().describe("Defaults to Nirium's configured rebalanceManager address"),
    },
    async (args) => callJson(`${API_URL}/api/treasury/rebalance`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', ...authHeaders() },
        body: JSON.stringify(args),
    }),
);

server.tool(
    'execute_treasury_rebalance',
    "Sign and submit a rebalance with Nirium's OWN RebalanceManager key, server-side, and wait for confirmation — the only treasury tool that signs anything itself, and it still cannot withdraw funds. Only available where that key actually lives; a receive-only mainnet box returns 501 by design, not a broken 500. Requires NIRIUM_API_KEY env var.",
    {
        vault: z.string().describe('Vault contract id (C...)'),
        instructions: z.array(treasuryInstruction).min(1),
        caller: z.string().optional().describe("Defaults to Nirium's configured rebalanceManager address"),
    },
    async (args) => callJson(`${API_URL}/api/treasury/rebalance/execute`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', ...authHeaders() },
        body: JSON.stringify(args),
    }),
);

server.tool(
    'submit_treasury_tx',
    'Broadcast a treasury XDR you already signed (deploy/deposit/withdraw/rebalance/set-rebalance-manager) and wait for confirmation. Requires NIRIUM_API_KEY env var.',
    {
        xdr: z.string().describe('Signed transaction XDR'),
    },
    async (args) => callJson(`${API_URL}/api/treasury/submit`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', ...authHeaders() },
        body: JSON.stringify(args),
    }),
);

// ─── Start ────────────────────────────────────────────────────

async function main(): Promise<void> {
    const transport = new StdioServerTransport();
    await server.connect(transport);
    console.error(`[Nirium MCP] v${PKG_VERSION} running on stdio`);
    console.error(`[Nirium MCP] Agent API: ${API_URL}`);
    console.error(`[Nirium MCP] NIRIUM_API_KEY set: ${!!NIRIUM_API_KEY}`);
    console.error(`[Nirium MCP] x402 enabled: ${!!STELLAR_KEY}`);
    console.error(`[Nirium MCP] MPP Charge enabled: ${!!STELLAR_KEY}`);
}

main().catch((err) => {
    console.error('[Nirium MCP] Fatal error:', err);
    process.exit(1);
});
