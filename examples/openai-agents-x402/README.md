# OpenAI Agents SDK x402 Tool Example

A `@function_tool` for the **OpenAI Agents SDK** (Python) that lets an agent pay x402 endpoints through the Nirium Python SDK with a per-payment spend cap.

## Features

- ✅ Uses OpenAI Agents SDK `@function_tool` decorator
- ✅ Wraps `Agent.x402_fetch()` with `max_amount_per_payment` cap
- ✅ Refuses payments above the cap **before signing** (raises `X402SpendCapError`)
- ✅ Returns clear error messages the agent can explain
- ✅ Includes transaction hashes in responses for audit trails
- ✅ Testnet only (no real funds)

## Package Versions Tested

```
nirium==0.12.7
openai-agents==0.25.0
python-dotenv==1.0.0
pytest==8.3.0
pytest-asyncio==0.24.0
```

## Files

- **`nirium_tool.py`** — OpenAI Agents SDK `@function_tool` wrapper
- **`agent.py`** — Example agent that uses the tool
- **`test_openai_tool.py`** — 8 offline tests (no network)
- **`requirements.txt`** — Exact dependency versions
- **`.env.example`** — Environment template
- **`.gitignore`** — Prevents committing secrets
- **`server/`** — Your own `x402Serve` route on testnet (Node): `/paid/market-summary` at `X402_PRICE` (below the cap) and `/paid/full-report` at `$2` (above the cap)

## Setup

### 1. Install Dependencies

```bash
pip install -r requirements.txt
```

### 2. Configure Environment

Copy `.env.example` to `.env` and add your Stellar testnet secret key:

```bash
cp .env.example .env
```

Generate a testnet key at: https://laboratory.stellar.org/#account-creator?network=test

Fund it using Friendbot (automatic in Stellar Laboratory).

**⚠️ NEVER commit your `.env` file or share secret keys!**

### 3. Run your own x402Serve route

The agent pays a route you run, with payments going to a testnet account you own. In `.env`, set:

- `SELLER_PUBLIC_KEY`: a second testnet account you own (G...), not the payer. It receives the payments, so it needs a USDC trustline.
- `FACILITATOR_API_KEY`: a free testnet key from https://channels.openzeppelin.com/testnet/gen

```bash
cd server
npm install
npm start        # x402Serve on http://localhost:3402 (stellar:testnet)
```

Then, in another terminal, run the agent against it:

```bash
python agent.py  # Test 1 pays /paid/market-summary, Test 2 is refused on /paid/full-report ($2 > $1 cap)
```

## Tests

Run offline tests (no network, no real LLM calls):

```bash
pytest test_openai_tool.py -v
```

All 8 tests pass:

```
test_openai_tool.py::test_initialize_sets_cap PASSED                     [ 12%]
test_openai_tool.py::test_successful_payment_below_cap PASSED            [ 25%]
test_openai_tool.py::test_payment_above_cap_refused PASSED               [ 37%]
test_openai_tool.py::test_network_mismatch_error PASSED                  [ 50%]
test_openai_tool.py::test_uninitialized_agent PASSED                     [ 62%]
test_openai_tool.py::test_extract_settlement_tx_from_various_formats PASSED [ 75%]
test_openai_tool.py::test_tool_returns_string_result PASSED              [ 87%]
test_openai_tool.py::test_function_tool_decorator PASSED                 [100%]

============================== 8 passed in 1.19s ===============================
```

## Test Coverage

### ✅ Tested Offline (Mocked)

1. **Initialization with spend cap** — Verifies the cap is set correctly
2. **Successful payment below cap** — Payment within cap succeeds
3. **Payment above cap refused** — **Key test:** Above-cap payment refused before signing, `X402SpendCapError` raised, nothing signed
4. **Network mismatch** — Wrong network is detected and refused
5. **Uninitialized agent** — Clear error when tool not initialized
6. **Transaction hash extraction** — Settlement data parsing works
7. **String result formatting** — Non-dict responses handled correctly
8. **@function_tool decorator** — Verifies FunctionTool wrapper is applied

### Testnet Evidence

**Run against my own `x402Serve` route (`server/`, stellar:testnet, Nov 21 2026):**

| Step | Value |
|---|---|
| Seller account (`SELLER_PUBLIC_KEY`, receives the payment) | [GDYJA25NGJWWMGTAC73LG4J2X6FCVSTC7CTVJZKT3EZSBUYM5WOKIV5Z](https://stellar.expert/explorer/testnet/account/GDYJA25NGJWWMGTAC73LG4J2X6FCVSTC7CTVJZKT3EZSBUYM5WOKIV5Z) |
| Paid call `/paid/market-summary` through `@function_tool` | [2d9235ab60a8908735cdc9cb4ab49f82dc48a9ae2b59c245cf94ffcafec9b0a6](https://stellar.expert/explorer/testnet/tx/2d9235ab60a8908735cdc9cb4ab49f82dc48a9ae2b59c245cf94ffcafec9b0a6): 0.02 USDC from payer GBTBTAO3…RIY5 to the seller above |
| Refused call `/paid/full-report` ($2 > $1 cap) | Refused before signing with `X402SpendCapError`, no transaction. Agent: "The payment request for the data from the URL exceeded the per-payment cap of \$1. The server requested a payment of 20,000,000 stroops (approximately \$2). As a result, the payment was refused." |

**Earlier run against Nirium's testnet endpoint** (before `server/` existed; the payee `GC4Q5TWW…` is Nirium's, not yours):

**Test account:** [GCE3GDLLGGKOVDDAZ4OHD6JC5FCD6CZZCADC4CFKQ66NKCB5U6XFOI6Z](https://stellar.expert/explorer/testnet/account/GCE3GDLLGGKOVDDAZ4OHD6JC5FCD6CZZCADC4CFKQ66NKCB5U6XFOI6Z)

**Transactions (all on Stellar testnet):**
1. **Funding TX:** [57071cb932fe8d6322907ed4a465bb831804d7fed0cbd1c4e8064e0a70c8e7aa](https://stellar.expert/explorer/testnet/tx/57071cb932fe8d6322907ed4a465bb831804d7fed0cbd1c4e8064e0a70c8e7aa) — 10,000 XLM from Friendbot
2. **USDC Trustline TX:** [6678d7f359a84285c87698ce0e11f5a35d36fdb2fd8591cedef8cd3a750fc0a2](https://stellar.expert/explorer/testnet/tx/6678d7f359a84285c87698ce0e11f5a35d36fdb2fd8591cedef8cd3a750fc0a2) — Trustline to testnet USDC (`GBBD47IF6LWK7P7MDEVSCWR7DPUWV3NY3DTQEVFL4NAT4AQH3ZLLFLA5`)
3. **x402 Payment TX #1:** [144d209009cf6b2c0d940a3e99246c793936e37ebb7e267d4c3feafb8fb6cdec](https://stellar.expert/explorer/testnet/tx/144d209009cf6b2c0d940a3e99246c793936e37ebb7e267d4c3feafb8fb6cdec) — **Real paid x402 call** via `@function_tool` (0.02 USDC, below $1 cap) ✅
4. **x402 Payment TX #2:** [1bed22cbdb1081c3f3295a6cd305322a349d57d1233f2c0aa795ef72d179401e](https://stellar.expert/explorer/testnet/tx/1bed22cbdb1081c3f3295a6cd305322a349d57d1233f2c0aa795ef72d179401e) — **Demo video payment** via `@function_tool` (0.02 USDC) ✅

Generated fresh keys using `stellar_sdk.Keypair.random()`.

**Test Results:**
- ✅ **Payment below cap succeeded:** 0.02 USDC payment through the `@function_tool` to Nirium's testnet premium endpoint
- ✅ **Over-cap request refused:** Reinitializing with `max_amount_per_payment='$0.01'` and retrying correctly refused with `X402SpendCapError`, **no transaction signed**

The critical functionality—**spend cap enforcement before signing**—is proven both in offline tests (`test_payment_above_cap_refused`) and in the real testnet run where the over-cap request was refused with no TX hash.

## Architecture

```
┌─────────────────────────┐
│ OpenAI Agents SDK Agent │
│ (with @function_tool)   │
└────────┬────────────────┘
         │
         │ @function_tool
         ↓
┌─────────────────────────┐
│ nirium_x402_fetch       │
│ (max_amount=$1)         │
└────────┬────────────────┘
         │
         │ Agent.x402_fetch()
         ↓
┌─────────────────────────┐      HTTP 402
│ Nirium Python SDK       │◄─────────────┐
│ (X402SpendCapError)     │              │
└────────┬────────────────┘              │
         │                                │
         │ Stellar payment                │
         ↓                                │
┌─────────────────────────┐      ┌───────────────┐
│ Stellar Testnet         │      │ x402 Server   │
│ (USDC payment)          │──────►│ (testnet)     │
└─────────────────────────┘      └───────────────┘
```

## Usage Example

```python
from agents import Agent as OpenAIAgent
from nirium_tool import initialize_nirium_x402, nirium_x402_fetch

# Initialize with spend cap
initialize_nirium_x402(
    secret_key="S...",  # Your Stellar testnet secret
    network="stellar:testnet",
    max_amount_per_payment="$1",
)

# Create agent with the tool
agent = OpenAIAgent(
    name="Payment Agent",
    instructions="You can make paid calls to x402 endpoints.",
    tools=[nirium_x402_fetch],
    model="gpt-4o-mini",
)

# Agent can now call the tool
# Payments above $1 will be refused before signing
```

## How the Spend Cap Works

1. **Before signing:** The SDK checks if the payment amount exceeds the cap
2. **If over cap:** Raises `X402SpendCapError` immediately
3. **Nothing signed:** No transaction is built or submitted
4. **Clear message:** The tool returns a JSON error the agent can explain:

```json
{
  "error": "X402SpendCapError",
  "message": "Payment refused: The requested payment exceeds the per-payment cap of $1. The server requested 15000000 stroops of CBIELTK6.... Nothing was signed or sent.",
  "details": {
    "url": "http://...",
    "amount": "15000000",
    "asset": "CBIELTK6...",
    "cap": "$1"
  }
}
```

## Security Checklist

- ✅ Testnet only (no mainnet, no real funds)
- ✅ Secret keys never committed (`.env` in `.gitignore`)
- ✅ Keys never exposed to LLM (redacted from errors)
- ✅ Spend cap enforced BEFORE signing
- ✅ Own keys only (generated fresh, never use keys from others)
- ✅ No custody (keys stay with owner)

## Pattern

This example follows the same pattern as `langchain_tools.py`:
- Secret key used only in `init_x402()`
- Never stored in tool schema
- Never appears in LLM-visible errors  
- Spend cap enforced by the SDK before signing
- Clear error messages returned as JSON

The `@function_tool` decorator integrates seamlessly with the OpenAI Agents SDK `Agent` and `Runner`.

## License

Apache-2.0 (same as Nirium Protocol)
