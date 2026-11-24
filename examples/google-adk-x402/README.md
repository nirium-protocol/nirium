# Google ADK x402 Tool Example

A `FunctionTool` for **Google Agent Development Kit (ADK)** (Python, with a Gemini model) that lets an agent pay x402 endpoints through the Nirium Python SDK with a per-payment spend cap.

## Features

- ✅ Uses Google ADK `FunctionTool`
- ✅ Wraps `Agent.x402_fetch()` with `max_amount_per_payment` cap
- ✅ Refuses payments above the cap **before signing** (raises `X402SpendCapError`)
- ✅ Returns clear error messages the agent can explain
- ✅ Includes transaction hashes in responses for audit trails
- ✅ Testnet only (no real funds)

## Package Versions Tested

```
nirium==0.12.9
google-adk==2.15.0
python-dotenv==1.0.0
pytest==8.3.0
pytest-asyncio==0.24.0
```

Gemini model: `gemini-3.6-flash`. Google ADK version: `2.15.0`.

## Files

- **`nirium_tool.py`** — Google ADK `FunctionTool` wrapper
- **`agent.py`** — Example agent that uses the tool
- **`test_google_adk_tool.py`** — 8 offline tests (no network)
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

Copy `.env.example` to `.env` and add your Stellar testnet secret key and a Google AI API key:

```bash
cp .env.example .env
```

Generate a testnet key at: https://laboratory.stellar.org/#account-creator?network=test

Fund it using Friendbot (automatic in Stellar Laboratory). Then give it testnet USDC: add a trustline to testnet USDC (`GBBD47IF6LWK7P7MDEVSCWR7DPUWV3NY3DTQEVFL4NAT4AQH3ZLLFLA5`) and buy a small amount on the testnet DEX.

Get a free Google AI API key at: https://aistudio.google.com/apikey

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
pytest test_google_adk_tool.py -v
```

All 8 tests pass:

```
test_google_adk_tool.py::test_initialize_sets_cap PASSED
test_google_adk_tool.py::test_successful_payment_below_cap PASSED
test_google_adk_tool.py::test_payment_above_cap_refused PASSED
test_google_adk_tool.py::test_network_mismatch_error PASSED
test_google_adk_tool.py::test_uninitialized_agent PASSED
test_google_adk_tool.py::test_extract_settlement_tx_from_various_formats PASSED
test_google_adk_tool.py::test_tool_returns_string_result PASSED
test_google_adk_tool.py::test_function_tool_wrapper PASSED

============================== 8 passed ===============================
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
8. **FunctionTool wrapper** — Verifies the ADK `FunctionTool` is applied with the right name and description

### Testnet Evidence

**Run against my own `x402Serve` route (`server/`, stellar:testnet, Nov 23 2026):**

| Step | Value |
|---|---|
| Payer account (pays, signs with its own key) | [GDA3X6ZKT3FX5DTQOVLOSSGH5RUXQB5EIJE4Q6SSW22WMVYU24RW6Q6N](https://stellar.expert/explorer/testnet/account/GDA3X6ZKT3FX5DTQOVLOSSGH5RUXQB5EIJE4Q6SSW22WMVYU24RW6Q6N) |
| Seller account (`SELLER_PUBLIC_KEY`, receives the payment) | [GBWBQ5JJ7ZPAVNO4CN2KKUEKGR3XLQ7S5AAPBVOUASOCU2TVA65KJVUD](https://stellar.expert/explorer/testnet/account/GBWBQ5JJ7ZPAVNO4CN2KKUEKGR3XLQ7S5AAPBVOUASOCU2TVA65KJVUD) |
| Paid call `/paid/market-summary` through `FunctionTool` | [f91273688e3c73722935d7a6c5bd6c74d8eb4c4e21b9db37ea271ddde2cc69ff](https://stellar.expert/explorer/testnet/tx/f91273688e3c73722935d7a6c5bd6c74d8eb4c4e21b9db37ea271ddde2cc69ff): 0.02 USDC from payer GDA3X6ZK…RW6Q6N to the seller above |
| Demo video payment `/paid/market-summary` through `FunctionTool` | [549f81e8e08158b0aed851e860ea44b1b50720d57f83f1b66d86bc9f0b987005](https://stellar.expert/explorer/testnet/tx/549f81e8e08158b0aed851e860ea44b1b50720d57f83f1b66d86bc9f0b987005): 0.02 USDC from payer GDA3X6ZK…RW6Q6N to the seller above |
| Refused call `/paid/full-report` ($2 > $1 cap) | Refused before signing with `X402SpendCapError`, no transaction. Agent: "The payment to fetch the full report was refused because it exceeds the configured per-payment spend cap. Requested amount: 20,000,000 stroops (~$2.00). Configured cap: $1.00. Status: Refused before signing; no transaction was sent." |

Funding, so anyone can check the setup:

1. **Funding TX (payer):** [35eedbd870beae6fb9fdecbf37f73a456d0ac9ae3d98ca093984cd7ed2b7ad35](https://stellar.expert/explorer/testnet/tx/35eedbd870beae6fb9fdecbf37f73a456d0ac9ae3d98ca093984cd7ed2b7ad35) — 10,000 XLM from Friendbot
2. **Funding TX (seller):** [660dad721a1fccc7edd3da3442863093891e04f7cc67fe11d97b7275175e60cb](https://stellar.expert/explorer/testnet/tx/660dad721a1fccc7edd3da3442863093891e04f7cc67fe11d97b7275175e60cb) — 10,000 XLM from Friendbot
3. **USDC trustline TX (payer):** [088a65d88a1d90856e291eca78fe30cd547d544934672373aed6a17c1f5c6cae](https://stellar.expert/explorer/testnet/tx/088a65d88a1d90856e291eca78fe30cd547d544934672373aed6a17c1f5c6cae) — trustline to testnet USDC (`GBBD47IF6LWK7P7MDEVSCWR7DPUWV3NY3DTQEVFL4NAT4AQH3ZLLFLA5`)
4. **USDC trustline TX (seller):** [0c4c37b6a509e63b77047a28cd7a2c51ff23393d73e80a919d1d2c997fa6483e](https://stellar.expert/explorer/testnet/tx/0c4c37b6a509e63b77047a28cd7a2c51ff23393d73e80a919d1d2c997fa6483e) — trustline to testnet USDC
5. **USDC buy TX (payer):** [777d584034cc0810f324d8e760c059099bc9671d73e8db651c38a604e5ad9eeb](https://stellar.expert/explorer/testnet/tx/777d584034cc0810f324d8e760c059099bc9671d73e8db651c38a604e5ad9eeb) — 10 XLM path payment for 6.5851251 USDC on the testnet DEX

Gemini model used: `gemini-3.6-flash`. Google ADK version: `2.15.0`.
