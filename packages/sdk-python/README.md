# nirium

Autonomous treasury and agentic-payments infrastructure for **Nirium Protocol** on Stellar/Soroban — Python client.

Nirium agents rebalance USDC ↔ CETES (tokenized Mexican T-bills via Etherfuse) 24/7 without human intervention. Built for developers who want to integrate autonomous treasury management, agentic payments (x402 + MPP), and real-time market signals into their applications.

## Install

```bash
pip install nirium
# Optional LangChain adapter
pip install 'nirium[langchain]'
```

## Quick Start

```python
import asyncio
from nirium import Agent

agent = Agent(
    api_url="https://nirium-agent.fly.dev",
    api_key="sk_inst_your_key_here",
)

async def main():
    # Health check
    alive = await agent.ping()
    print(f"Agent alive: {alive}")

    # Real market data from Stellar Horizon
    market = await agent.get_market()
    print(f"XLM Price: ${market['xlmPrice']:.4f}")

    # Trigger a demo strategy on Nirium's own shared testnet vault — a real,
    # working transaction, not a simulation, but it moves Nirium's testnet
    # funds, not yours. To rebalance YOUR OWN vault, see Treasury Rebalance below.
    result = await agent.execute("blend-yield", "USDC", {"amount": 5000})
    print(f"Success: {result['success']} | TX: {result.get('txHash')}")

asyncio.run(main())
```

## Real-Time Signals (Resilient WebSocket)

The Python SDK includes a hardened, self-healing WebSocket signals client with exponential backoff, randomized jitter, configurable retry caps, automatic deduplication, and typed status/error channels.

```python
from nirium import Agent, WebSocketMaxRetriesExceeded, WebSocketStatus

agent = Agent(api_url="https://nirium-agent.fly.dev", api_key="sk_inst_...", token="eyJhbG...")

# 1. Listen for market signals
@agent.on("signal")
async def on_signal(data):
    print(f"Signal received: {data['signal_type']} — {data['data']['details']}")

# 2. Monitor connection status (connecting, connected, reconnecting, disconnected, closed)
@agent.on("status")
def on_status(status: str):
    print(f"WS Status changed to: {status}")

# 3. Handle connection & transport errors
@agent.on("error")
def on_error(err: dict):
    print(f"WS Warning (attempt {err['attempt']}): {err['error']}")

async def start_stream():
    try:
        # Connect with exponential backoff, jitter, and retry limits
        await agent.subscribe(
            max_retries=10,        # Max reconnect attempts (raises WebSocketMaxRetriesExceeded if reached)
            initial_delay=1.0,     # Initial retry backoff in seconds
            max_delay=30.0,        # Max backoff cap in seconds
            backoff_factor=2.0,    # Exponential backoff multiplier
            jitter=0.2,            # Random jitter factor (±20%)
            dedupe_size=1000,      # Automatic deduplication buffer size
        )
    except WebSocketMaxRetriesExceeded as e:
        print(f"Fatal connection failure: {e}")

# Graceful shutdown when needed:
# await agent.close()
```

## Authentication

```python
# API Key for REST endpoints
agent = Agent(api_url="https://nirium-agent.fly.dev", api_key="sk_inst_...")

# With JWT token for WebSocket
agent = Agent(api_url="https://nirium-agent.fly.dev", api_key="sk_inst_...", token="eyJhbG...")
```

## Payment Protocols

### x402 — Pay-Per-Request
```python
agent.init_x402(
    secret_key="S...",          # Stellar secret key
    network="stellar:testnet"
)

response = await agent.x402_fetch("https://nirium-agent.fly.dev/api/v1/premium/signals")
```

### LangChain tool — pay x402 from any agent

`NiriumX402Tool` is a LangChain `BaseTool` that wraps the same `init_x402` / `x402_fetch` client. A ReAct-style agent can pay a protected Stellar endpoint as a normal tool call. The Stellar secret is constructor/env configuration only: it never appears in the tool description, args schema, error text, or return value.

```python
import os
from langchain.agents import create_agent
from nirium import NiriumX402Tool

tool = NiriumX402Tool(
    secret_key=os.environ["STELLAR_SECRET_KEY"],  # or set the env var and omit this
    network="stellar:testnet",
)

agent = create_agent(model="gpt-4o-mini", tools=[tool])
result = agent.invoke({
    "messages": [{
        "role": "user",
        "content": "Fetch https://nirium-agent.fly.dev/api/v1/premium/signals",
    }]
})
```

Environment variables: `STELLAR_SECRET_KEY` (or `STELLAR_TESTNET_SECRET_KEY`), optional `NIRIUM_X402_NETWORK` (default `stellar:testnet`).

Runnable example: [`examples/langchain-x402-agent`](../../examples/langchain-x402-agent).

### MPP — Session-Based Budget Delegation
```python
agent.init_mpp(
    secret_key="S...",
    network="stellar:testnet",
)

response = await agent.mpp_fetch("https://nirium-agent.fly.dev/api/v1/mpp/signals")
```

### Endpoint Access Model

| Access | Endpoints |
|---|---|
| **Public** (no key) | `health`, `loop/status`, `execute-demo`, `signals/recent`, `skills` list |
| **Protected** (API key) | `execute`, `market`, `loop/start\|stop\|scan`, `subscriptions`, `skills/install`, `webhooks` |
| **WebSocket** (JWT) | `/ws/signals` — real-time signal stream |
| **x402 Premium** | `/api/v1/premium/signals` ($0.02 USDC), `/api/v1/premium/market` ($0.05 USDC) |
| **MPP** | `/api/v1/mpp/signals`, `/api/v1/mpp/market` |

## Payouts

Batch disbursement, non-custodial: the node builds an **unsigned** transaction, you sign it with your own wallet and broadcast it. Nirium never holds funds and never sees your keys.

```python
run = await agent.create_payout_run(
    recipients=[{"wallet": "GABC...", "amount": "250.00"}],
    acknowledge_terms=True,   # required on every network — 403 without it
)

signed_xdr = sign_with_your_wallet(run["xdr"])
settled = await agent.submit_payout(run["runId"], signed_xdr)
print(settled["txHash"], settled["cid"])   # on-chain hash + IPFS receipt
```

Licensed for **independent service payments only** — contractors, freelancers, B2B. Not for subordinate-employee salary. Read `get_payout_terms()` before integrating; classifying recipients and meeting tax and labor obligations is the client's responsibility.

Mainnet is invite-only during early access and additionally requires `client_info`.

## Treasury Rebalance

Two ways to rebalance a DeFindex vault between idle cash and an invested strategy. Neither is a swap — the contract's `rebalance()` exposes exactly two instructions, `Unwind` and `Invest`, and neither accepts a destination address, so withdrawing anywhere but back into the vault itself is not expressible.

### Propose — you review and sign, available to everyone today

The agent decides what it would do, using the same decision logic as the autonomous signer below, but it never signs. Public, no allowlist, no invite required — works for any vault where you're already the on-chain rebalance manager.

```python
proposal = await agent.propose_treasury_rebalance(
    vault="CABC...",
    caller="GABC...",   # must already be this vault's rebalanceManager on-chain
    enter_at=2.5,        # your own mandate — Nirium never supplies a default here
    exit_at=2.0,
)

if proposal["instructions"]:
    signed_xdr = sign_with_your_wallet(proposal["xdr"])
    await agent.submit_treasury_tx(signed_xdr)
else:
    print("Nothing to propose:", proposal["reason"])
```

### Autonomous — Nirium signs, invite-only during legal review

`execute_treasury_rebalance()` has Nirium sign and submit with its own RebalanceManager key — full autonomy, no per-cycle approval. **This is invite-only while a specific legal question stays open**: whether executing on a client's behalf without taking custody still counts as regulated facilitation under Mexican law. It only runs against vaults explicitly allowlisted server-side; calling it against any other vault returns 403, and Nirium's mainnet infrastructure returns 501 for it entirely, since that box holds no signing key by design. Ask if you want autonomous execution today — otherwise, `propose_treasury_rebalance()` above gives you the same decision-making with you as the one who signs.

## Audit Trail

Anchor evidence to IPFS and get back a CID — an integrity seal, not notarization.

```python
anchor = await agent.anchor_audit_record(
    hash="sha-256:9f86d081...",   # hash of your own file or event
    tag="invoice-batch-jul",
)
print(anchor["cid"])
```

Anchor a **hash** rather than the data itself: IPFS content cannot be deleted, so raw personal data would outlive any erasure request.

## API Coverage

| Category | Methods |
|---|---|
| Health | `ping()`, `health()`, `system_health()` |
| Execution | `execute()`, `execute_demo()` |
| Market | `get_tickers()`, `get_market()`, `get_stats()`, `get_loop_status()`, `start_loop()`, `stop_loop()`, `trigger_scan()` |
| Signals | `create_subscription()`, `get_subscriptions()`, `delete_subscription()`, `get_subscription_stats()`, `get_recent_signals()` |
| Skills | `get_skills()`, `install_skill()`, `uninstall_skill()`, `get_skill_marketplace()`, `execute_skill_action()` |
| Strategies | `get_strategies()` |
| Webhooks | `register_webhook()`, `get_webhooks()`, `delete_webhook()`, `test_webhook()` |
| Auth | `get_auth_token()`, `create_auth_key()`, `get_auth_keys()`, `revoke_auth_key()` |
| Revenue | `get_revenue()`, `get_info()` |
| Nodes | `get_nodes()` |
| Payouts | `create_payout_run()`, `submit_payout()`, `onboard_payout_recipient()`, `submit_payout_onboard()`, `get_payout_runs()`, `get_payout_terms()`, `get_payout_info()` |
| Treasury | `get_treasury_info()`, `get_treasury_vault()`, `get_treasury_vaults()`, `get_treasury_strategy_asset()`, `deploy_treasury_vault()`, `deposit_to_treasury_vault()`, `withdraw_from_treasury_vault()`, `set_treasury_rebalance_manager()`, `build_treasury_rebalance()`, `propose_treasury_rebalance()`, `execute_treasury_rebalance()`, `submit_treasury_tx()` |
| Audit Trail | `anchor_audit_record()`, `get_audit_info()` |
| Reporting | `get_reporting_summary()`, `get_reporting_export()` |
| Admin | `configure_llm()` |
| WebSocket | `subscribe()`, `on()` decorator |
| x402 Payments | `init_x402()`, `x402_fetch()` |
| LangChain | `NiriumX402Tool`, `create_nirium_x402_tool()` |
| MPP Payments | `init_mpp()`, `mpp_fetch()` |

## Requirements

- Python >= 3.10
- aiohttp >= 3.9.0
- websockets >= 13.0
- langchain-core >= 0.3.0 (only for `nirium[langchain]`)

## Links

- [Documentation](https://nirium.xyz/docs)
- [Developer Sandbox](https://nirium.xyz/sandbox)
- [API Reference](https://nirium.xyz/docs/api)
- [MCP Server Integration](https://nirium.xyz/docs/mcp)
- [GitHub](https://github.com/nirium-protocol/nirium-sdk)

## License

Apache 2.0 — Nirium Protocol
