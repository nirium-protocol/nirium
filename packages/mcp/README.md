# nirium-mcp

Model Context Protocol server for [Nirium](https://nirium.xyz) - exposes market data, autonomous treasury loop control, and x402 paid endpoints (MPP tools are experimental) to any MCP-compatible AI: Claude, GPT, Cursor, VS Code Copilot, and others.

Software-only. This server never holds funds - paid tools sign per-request payments from a Stellar wallet you control via `STELLAR_SECRET_KEY`.

## Install

No install needed - run directly with `npx`, or add to your MCP client config.

## Claude Desktop config

```json
{
  "mcpServers": {
    "nirium": {
      "command": "npx",
      "args": ["-y", "nirium-mcp"],
      "env": {
        "AGENT_API_URL": "https://nirium-agent.fly.dev",
        "STELLAR_SECRET_KEY": "S...",
        "NIRIUM_API_KEY": "sk_free_..."
      }
    }
  }
}
```

`STELLAR_SECRET_KEY` and `NIRIUM_API_KEY` are optional - omit them and the free tools still work; paid x402 (MPP experimental) and authenticated tools will tell you what's missing instead of failing silently.

## Tools

**Free - no key required**
- `get_market_state` - XLM/USDC price, SDEX spread, base fee, Blend rate, CETES rate
- `get_loop_status` - autonomous loop status, scan count, last AI decision
- `execute_demo` - dry-run a strategy via real Soroban simulation, no funds moved
- `get_wallet_info` - show the configured x402 (MPP experimental) wallet and enabled tools
- `get_nodes` - list the execution nodes with live status, custody model and network
- `anchor_audit_record` - anchor a hash (or a small JSON record) to IPFS, get back a CID
- `get_reporting_summary` - settled payouts, x402 receipts and anchors for a period

**Authenticated - requires `NIRIUM_API_KEY`**
- `start_loop` - start the autonomous scanning loop
- `stop_loop` - stop it

**Paid via x402 - requires a funded `STELLAR_SECRET_KEY`**
- `get_premium_signals` - $0.02 USDC - **testnet only**; signals come from the autonomous loop, which runs on testnet. They reference testnet tokens, which have no monetary value, and are not a recommendation to buy, sell or hold anything. The mainnet box returns 501 without charging.
- `get_premium_market` - $0.05 USDC - market state with reference rates attributed to their source, fee pressure and network conditions. Factual data, no advice.
- `execute_paid_strategy` - $0.25 USDC - **testnet only**; execution needs a signing key and the mainnet box holds none by design, so it returns 501 without charging.

**Paid via MPP - requires a funded `STELLAR_SECRET_KEY`**
- `get_mpp_signals` - $0.02 USDC - same data and same testnet-only limit as `get_premium_signals`, settled via direct Soroban SAC transfer with no external facilitator
- `get_mpp_market` - $0.05 USDC - same as `get_premium_market`, MPP-settled
**Treasury - requires `NIRIUM_API_KEY`**

Reading a DeFindex vault is free. Changing one needs the key, and ten of these eleven tools only build an unsigned XDR; you sign it yourself and broadcast it with `submit_treasury_tx`. Only `execute_treasury_rebalance` signs anything, and it does so with Nirium's own key, invite-only while a specific legal question stays open (see below) - everywhere else, Nirium never holds a key that can move your funds.

- `get_treasury_info` - Treasury node metadata: what role Nirium holds on DeFindex vaults, what it can and cannot do, fees, security notes
- `get_treasury_vault` - Read a DeFindex vault's roles, assets and managed funds. Pass `holder` to also get that account's balance in the vault's asset
- `get_treasury_vaults` - List DeFindex vaults Nirium has deployed or read, on the current network
- `get_treasury_strategy_asset` - Read which asset a DeFindex strategy manages, as declared by the strategy itself - pairs it correctly before deploying a vault
- `deploy_treasury_vault` (builds unsigned XDR) - Build an UNSIGNED XDR to deploy a DeFindex vault. `manager` keeps control (rescue, pause, revoke); Nirium only ever holds `rebalanceManager`, which cannot withdraw or change roles
- `deposit_to_treasury_vault` (builds unsigned XDR) - Build an UNSIGNED XDR to deposit into a DeFindex vault. Sign with `from` and broadcast it with `submit_treasury_tx`
- `withdraw_from_treasury_vault` (builds unsigned XDR) - Build an UNSIGNED XDR to withdraw from a DeFindex vault. Omit `shares` to withdraw everything the account holds
- `set_treasury_rebalance_manager` (builds unsigned XDR) - Build an UNSIGNED XDR handing the RebalanceManager role to a new address. Only the vault's current Manager can sign it - the same door that grants Nirium the role also revokes it
- `build_treasury_rebalance` (builds unsigned XDR) - Build an UNSIGNED rebalance XDR, Unwind/Invest between a vault's own strategies only; no other instruction is expressible, and none takes a destination address
- `submit_treasury_tx` - Broadcast a treasury XDR you already signed (deploy/deposit/withdraw/rebalance/set-rebalance-manager) and wait for confirmation
- `execute_treasury_rebalance` (Nirium signs, invite-only) - Sign and submit a rebalance with Nirium's OWN RebalanceManager key, server-side, and wait for confirmation - the only treasury tool that signs anything itself, and it still cannot withdraw funds. **This is invite-only while a specific legal question stays open**: whether executing on a client's behalf without taking custody still counts as regulated facilitation under Mexican law. Only available where that key actually lives; a receive-only mainnet box returns 501 by design, not a broken 500


## Environment variables

| Variable | Required | Purpose |
|---|---|---|
| `AGENT_API_URL` | No (defaults to `http://127.0.0.1:3002`) | Nirium agent API base URL |
| `STELLAR_SECRET_KEY` | For paid tools | Funds x402 and MPP payments |
| `NIRIUM_API_KEY` | For `start_loop`/`stop_loop` | Agent API key from [nirium.xyz/keys](https://nirium.xyz/keys) |
| `STELLAR_NETWORK` | No (defaults to `testnet`) | `testnet` or `mainnet` |
| `SOROBAN_RPC_URL` | **Yes on mainnet** | Soroban RPC endpoint. Testnet falls back to the public one; mainnet has no open public RPC, so paid tools stay disabled until you set this. [Providers](https://developers.stellar.org/docs/data/apis/rpc/providers) |

### A note on anchoring

`anchor_audit_record` is an integrity seal - it proves a piece of data existed unchanged at a point in time. It is not notarization and carries no legal presumption of authenticity.

Anchor a **hash** of your data rather than the data itself. IPFS content cannot be deleted, so raw personal data would outlive any erasure request.

## Run from source

```bash
git clone https://github.com/nirium-protocol/nirium
cd nirium/packages/mcp
npm install
STELLAR_SECRET_KEY=S... AGENT_API_URL=http://localhost:3002 npx tsx src/index.ts
```

## License

Apache-2.0 - see [LICENSE](https://github.com/nirium-protocol/nirium/blob/main/packages/mcp/LICENSE).
