# nirium

Verifiable receipts, agentic payments and treasury execution for **Nirium Protocol** on Stellar/Soroban - Python client.

- **Audit Trail:** anchor a SHA-256 of any event to IPFS and get back a CID that anyone can re-check, optionally signed with your agent's own Stellar key so it also proves *who* declared it. See [Audit Trail](#audit-trail).
- **x402 payments:** pay for x402 APIs with `init_x402()` / `x402_fetch()`, or from any LangChain agent with `NiriumX402Tool`.
- **Treasury:** a Nirium agent can move a vault you own between idle cash and its strategy (USDC, or tokenized CETES issued by Etherfuse). Nothing is swapped. It runs on its own on testnet. On mainnet, deploying, depositing, proposals and autonomous execution are invite-only, and withdrawing is always open.

**Status:** x402 and Audit Trail run on Stellar mainnet; MPP Charge does not work in this version; Treasury on mainnet is invite-only (withdrawing stays open). Every claim, with its network, date and transaction hash: [EVIDENCE.md](https://github.com/nirium-protocol/nirium/blob/main/EVIDENCE.md).

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

    # Trigger a demo strategy on Nirium's own shared testnet vault - a real,
    # working transaction, not a simulation, but it moves Nirium's testnet
    # funds, not yours. To rebalance YOUR OWN vault, see Treasury Rebalance below.
    result = await agent.execute("blend-yield", "USDC", {"amount": 5000})
    print(f"Success: {result['success']} | TX: {result.get('txHash')}")

asyncio.run(main())
```

## Audit Trail

Anchor evidence to IPFS and get back a CID - an integrity seal, not notarization.

```python
anchor = await agent.anchor_audit_record(
    hash="sha-256:9f86d081...",   # hash of your own file or event
    tag="invoice-batch-jul",
)
print(anchor["cid"])
```

Anchor a **hash** rather than the data itself: nobody can guarantee that something is deleted from IPFS (anyone with the CID may have kept a copy), so raw personal data could outlive any erasure request.

### Signed receipts: prove who declared it

The CID proves the fact was not altered. Add `agent` and it also proves which key declared it: your agent signs `nirium-audit-v1:<sha256>` with its own Stellar key, locally. Only the signature and the public key are sent; an invalid signature is rejected with `400` and nothing is anchored.

```python
import base64, hashlib, os
from stellar_sdk import Keypair

kp = Keypair.from_secret(os.environ["AGENT_SECRET"])
hash = hashlib.sha256(b"...your evidence...").hexdigest()   # 64-hex sha-256
signature = base64.b64encode(kp.sign(f"nirium-audit-v1:{hash}".encode())).decode()

anchor = await agent.anchor_audit_record(
    hash=hash,
    tag="invoice-batch-jul",
    agent={"key": kp.public_key, "signature": signature},
)
print(anchor["cid"], anchor["attestedBy"])
```

### Keep your own copy

The receipt lives on IPFS only while someone pins it. `anchor_audit_record()` returns the exact `document` that was pinned (nodes deployed after 21 Nov 2026); save it, and `receipt_cid()` shows any time that your copy is the original. If IPFS ever loses it, add the same bytes again (`ipfs add --cid-version=0`) and you get the same CID.

```python
import json
from nirium import receipt_cid

anchor = await agent.anchor_audit_record(hash=hash, tag="invoice-batch-jul")
if "document" in anchor:
    data = json.dumps(anchor["document"], separators=(",", ":"), ensure_ascii=False).encode()
    open("receipt.json", "wb").write(data)          # exactly what was pinned
    assert receipt_cid(open("receipt.json", "rb").read()) == anchor["cid"]
```

### Verify any receipt, without trusting Nirium

```bash
npx nirium-cli verify <cid> --hash <64-hex-sha256>
```

`nirium verify` fetches the document from IPFS, recomputes the hash and checks the ed25519 signature against the declared Stellar key. You can also paste a CID at [nirium.xyz/verify](https://nirium.xyz/verify), with no account. More in [docs/verify-audit-cid.md](https://github.com/nirium-protocol/nirium/blob/main/docs/verify-audit-cid.md).

**What a receipt adds over the ledger:** a Stellar payment is already public, so a receipt that only repeats payer, payee and amount proves nothing new; link the transaction instead. Receipts are for what the ledger doesn't hold: policy decisions (including refused payments that were never signed), what a payment was for, off-chain records, and who declared them. More in the [design FAQ](https://github.com/nirium-protocol/nirium/blob/main/docs/DESIGN-FAQ.md).

## Real-Time Signals (Resilient WebSocket)

The Python SDK includes a hardened, self-healing WebSocket signals client with exponential backoff, randomized jitter, configurable retry caps, automatic deduplication, and typed status/error channels.

> The hosted stream (`wss://nirium-agent.fly.dev/ws/signals`) did not accept connections when checked on 21 Nov 2026. Point the client at an agent you run yourself to use it.

```python
from nirium import Agent, WebSocketMaxRetriesExceeded, WebSocketStatus

agent = Agent(api_url="https://nirium-agent.fly.dev", api_key="sk_inst_...", token="eyJhbG...")

# 1. Listen for market signals
@agent.on("signal")
async def on_signal(data):
    print(f"Signal received: {data['signal_type']} - {data['data']['details']}")

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
            jitter=0.2,            # Random jitter factor (+/-20%)
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

### x402 - Pay-Per-Request
```python
agent.init_x402(
    secret_key="S...",          # Stellar secret key
    network="stellar:testnet"
)

response = await agent.x402_fetch("https://nirium-agent.fly.dev/api/v1/premium/signals")
```

**Spending limits (0.12.0).** `x402_fetch()` pays only what the 402 offers on the network you configured; it never falls back to another network (`X402NetworkMismatchError`). It pays USDC up to **$1** per request by default, like the TypeScript SDK. Anything above the cap, or in another asset, is refused before signing (`X402SpendCapError`) unless you raise the cap or decide case by case:

```python
agent.init_x402(secret_key="S...", network="stellar:pubnet", max_amount_per_payment="$5")

def approve(req):  # sync or async; receives url, network, asset, payTo, amount, reason
    return req["payTo"] in MY_TRUSTED_SELLERS

agent.init_x402(secret_key="S...", network="stellar:pubnet", approve=approve)
```

Why the default stays low: an agent pays whatever a server's 402 asks for, so a low cap limits the damage from a mispriced or malicious endpoint. `NiriumX402Tool` accepts the same `max_amount_per_payment` and `approve` options.

#### Pre-sign policy hook

Pass `policy` to `init_x402()` and every `x402_fetch()` asks your policy before anything is signed. The question is asked before signing, so the policy sees exactly what would be signed: amount, destination, asset, resource URL, and network.

The policy can be a simple callable (sync or async) or an object implementing `evaluate(ctx)`:

```python
from nirium import Agent, X402PolicyError

async def policy(ctx):
    # ctx provides amount, asset, payee, resource, network, contextHash, etc.
    if int(ctx.amount) <= 1_000_000:  # 0.1 USDC
        return {
            "decision": "ALLOW",
            "contextHash": ctx.contextHash,
            "policyVersion": "v1",
            "expiresAt": (time.time() + 2) * 1000,
        }
    return {"decision": "DENY", "reason": "over limit"}

agent = Agent()
agent.init_x402(
    secret_key="S...",
    network="stellar:pubnet",
    policy=policy,
    current_version=lambda ctx: "v1",  # optional: source of current policy version
)

try:
    res = await agent.x402_fetch(url)
except X402PolicyError as e:
    print(e.outcome)  # 'DENY', 'WAIT', 'STALE', 'EXPIRED', 'TIMEOUT', 'ENGINE_ERROR', ...
```

Only an `ALLOW` reaches the signer. Everything else signs nothing: `DENY`, `WAIT`, an unhandled exception (fails closed), no answer before the deadline (`policy_timeout_ms`, default 5000 ms, never more than half the payment's `maxTimeoutSeconds`), a malformed answer, or an `ALLOW` past its `expiresAt`. Without `policy`, `x402_fetch()` behaves exactly as before.

**Stale ALLOW.** With `current_version` set, it is read after the `ALLOW` and right before signing, and the `ALLOW` signs only if its `policyVersion` matches. A rejected, empty or late read signs nothing. This check narrows the window to the step between the read and the signer call.

**What this does not do.** It is a check on the agent side, not account-level enforcement: code in the same process that holds the raw secret key can still sign directly, and nothing on-chain enforces the policy. It does not solve pending-capacity reservation (concurrent requests that observe the same remaining capacity): two calls evaluated at the same time can each fit a limit that together they exceed, and an aggregate cap must be held by your policy store.

### LangChain tool - pay x402 from any agent

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

### MPP Charge: does not work in this version

`init_mpp()` and `mpp_fetch()` in nirium 0.11.0 and later (this version included) cannot pay an MPP Charge server. `mpp_fetch()` raises `ValueError: This is not a valid account:` before sending anything, because it:

- reads the payment challenge from the JSON body of the `402`, but MPP sends it in the `WWW-Authenticate` header;
- builds a classic Stellar payment, where MPP Charge needs a Soroban SAC transfer;
- sends its proof in an `X-PAYMENT` header, where MPP uses `Authorization: Payment`.

This is not fixed in the version published today. Use x402 (`init_x402()` / `x402_fetch()`) for paid endpoints. The TypeScript package has an MPP Charge client (experimental, see its README): Nirium's hosted testnet `/api/v1/mpp/*` endpoint accepted its payments on 15 October 2026, in `pull` and `push` mode (mainnet not tested). That does not change this Python version, which still cannot pay.

### Endpoint Access Model

| Access | Endpoints |
|---|---|
| **Public** (no key) | `health`, `loop/status`, `execute-demo`, `signals/recent`, `skills` list |
| **Protected** (API key) | `execute`, `market`, `loop/start\|stop\|scan`, `subscriptions`, `skills/install`, `webhooks` |
| **WebSocket** (JWT) | `/ws/signals` - signal stream. The hosted endpoint did not accept connections when checked on 21 Nov 2026; run your own agent to use it. |
| **x402 Premium** | `/api/v1/premium/signals` ($0.02 USDC), `/api/v1/premium/market` ($0.05 USDC) |
| **MPP Charge** | `/api/v1/mpp/signals`, `/api/v1/mpp/market` (testnet verified with the TypeScript client on 15 Oct 2026, mainnet untested; `mpp_fetch()` does not work in this version) |

## Payouts

Batch disbursement, non-custodial: the node builds an **unsigned** transaction, you sign it with your own wallet and broadcast it. Nirium never holds funds and never sees your keys.

```python
run = await agent.create_payout_run(
    recipients=[{"wallet": "GABC...", "amount": "250.00"}],
    acknowledge_terms=True,   # required on every network - 403 without it
)

signed_xdr = sign_with_your_wallet(run["xdr"])
settled = await agent.submit_payout(run["runId"], signed_xdr)
print(settled["txHash"], settled["cid"])   # on-chain hash + IPFS receipt
```

Licensed for **independent service payments only** - contractors, freelancers, B2B. Not for subordinate-employee salary. Read `get_payout_terms()` before integrating; classifying recipients and meeting tax and labor obligations is the client's responsibility.

Mainnet is invite-only during early access and additionally requires `client_info`.

## Treasury Rebalance

Two ways to rebalance a DeFindex vault between idle cash and an invested strategy. Neither is a swap. The contract's `rebalance()` accepts four instructions (`Unwind`, `Invest`, `SwapExactIn`, `SwapExactOut`); these methods only send `Unwind` and `Invest`. None of the four accepts a destination address, so withdrawing anywhere but back into the vault itself is not expressible.

### Propose - you review and sign (open on testnet, invite-only on mainnet)

The agent decides what it would do, using the same decision logic as the autonomous signer below, but it never signs. Works for any vault where you're already the on-chain rebalance manager. Open to any key on testnet. On mainnet it needs an invited (institutional) key, like every Treasury call that builds a transaction except withdraw; a free key gets a 403.

```python
proposal = await agent.propose_treasury_rebalance(
    vault="CABC...",
    caller="GABC...",   # must already be this vault's rebalanceManager on-chain
    enter_at=2.5,        # your own mandate - Nirium never supplies a default here
    exit_at=2.0,
)

if proposal["instructions"]:
    signed_xdr = sign_with_your_wallet(proposal["xdr"])
    await agent.submit_treasury_tx(signed_xdr)
else:
    print("Nothing to propose:", proposal["reason"])
```

### Autonomous - Nirium signs, invite-only until a written legal opinion

`execute_treasury_rebalance()` has Nirium sign and submit with its own RebalanceManager key - full autonomy, no per-cycle approval. **This is invite-only while a specific legal question stays open**: whether executing on a client's behalf without taking custody still counts as regulated facilitation under Mexican law. It only runs against vaults explicitly allowlisted server-side; calling it against any other vault returns 403, and Nirium's mainnet infrastructure returns 501 for it entirely, since that box holds no signing key by design. Ask if you want autonomous execution today - otherwise, `propose_treasury_rebalance()` above gives you the same decision-making with you as the one who signs.

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
| MPP Charge (does not work in this version, see above) | `init_mpp()`, `mpp_fetch()` |

## Requirements

- Python >= 3.10
- aiohttp >= 3.9.0
- websockets >= 13.0
- langchain-core >= 0.3.0 (only for `nirium[langchain]`)

## Links

- [Documentation](https://nirium.xyz/docs)
- [Build examples](https://nirium.xyz/build)
- [Verify a receipt](https://nirium.xyz/verify)
- [MCP Server Integration](https://github.com/nirium-protocol/nirium/tree/main/packages/mcp)
- [GitHub](https://github.com/nirium-protocol/nirium)

## License

Apache 2.0 - Nirium Protocol
