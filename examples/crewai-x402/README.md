# CrewAI x402 Tool Example

A **CrewAI** (Python) tool that pays x402 endpoints through the Nirium Python SDK, with a per-payment spend cap, used by a two-agent crew on `stellar:testnet`.

- **`NiriumX402Tool`** is a CrewAI `BaseTool` that wraps `nirium.Agent.x402_fetch()` with `init_x402(max_amount_per_payment="$1")`.
- **Data scout** (no tools) reads the catalog of paid routes and picks the one that answers the request.
- **Payer** (has the tool) pays that route on your own `x402Serve` server.
- A request above the cap is refused by the SDK **before signing** (`X402SpendCapError`). The tool returns it as `{"status": "refused", "signed": false, ...}`, so the crew finishes normally and explains the refusal instead of crashing.

Testnet only: no real funds, no mainnet, no custody. Every key stays with whoever owns it.

## Package Versions Tested

Python 3.12, from `requirements.txt`:

```
nirium==0.12.7
crewai==1.15.44
python-dotenv==1.2.2
pytest==8.3.0
pytest-asyncio==0.24.0
```

`server/` (Node): `nirium@0.19.6`, `@x402/*@2.32.0`, `express@5.3.0` (locked in `server/package-lock.json`).

## Files

- **`nirium_crewai_tool.py`**: the CrewAI `BaseTool` (`NiriumX402Tool`)
- **`agent.py`**: the two-agent crew (Data scout + Payer) with the two test runs
- **`test_crewai_tool.py`**: offline tests of the tool (real Nirium SDK, faked HTTP, spy signer)
- **`test_crew_offline.py`**: offline end-to-end tests of the crew with a scripted LLM
- **`requirements.txt`**, **`pytest.ini`**, **`.env.example`**, **`.gitignore`**
- **`server/`**: your own `x402Serve` route on testnet: `/paid/market-summary` at `X402_PRICE` (default $0.02, below the cap) and `/paid/full-report` at $2 (above the cap)

## Setup

```bash
cd examples/crewai-x402
python3 -m venv .venv && source .venv/bin/activate
pip install -r requirements.txt
cp .env.example .env   # then fill it in; never commit it
```

In `.env`:

- `STELLAR_SECRET_KEY`: your **own** testnet payer key (Friendbot), with a USDC trustline and testnet USDC. The facilitator sponsors fees, so the payer needs no XLM for the payment itself.
- `OPENAI_API_KEY`: for the live crew run (`gpt-4o-mini` by default; override with `CREWAI_MODEL`).
- `SELLER_PUBLIC_KEY`: a second testnet account you own (G...) that **receives** the payments. It needs a USDC trustline.
- `FACILITATOR_API_KEY`: a free testnet key from https://channels.openzeppelin.com/testnet/gen

## Run

Terminal 1, your own `x402Serve` route (reads `../.env`):

```bash
cd examples/crewai-x402/server
npm install
npm start        # x402Serve on http://localhost:3402 (stellar:testnet)
```

Terminal 2, the crew:

```bash
cd examples/crewai-x402
source .venv/bin/activate
python agent.py
```

- **Test 1** asks for a short market summary. The scout picks `/paid/market-summary`, the payer pays $0.02 and the tool returns the settlement `tx_hash` with its Stellar Expert link.
- **Test 2** asks for the full report. The scout picks `/paid/full-report` ($2), the SDK refuses it before signing because $2 > $1, and the crew reports the refusal.

At the end, `agent.py` prints the tool's own call log (status, URL, tx hash), which comes from `NiriumX402Tool`, not from the LLM.

## Tests

No network, no LLM, no real funds:

```bash
pytest -v
```

`test_crewai_tool.py` runs the real Nirium SDK against a fake `aiohttp` session and a spy in place of the signer:

- the tool is a CrewAI `BaseTool` and its schema exposes only `url` and `method` (no secret, no cap)
- the cap and network are passed to `init_x402`, and an unknown network is rejected
- below the cap: signed once, paid retry with `PAYMENT-SIGNATURE`, `tx_hash` and Stellar Expert link returned
- above the cap: `X402SpendCapError`, **signer never called**, no paid retry, structured `refused` result
- network mismatch (pubnet offer to a testnet client): refused, signer never called
- sync `_run` inside a running event loop, and async `arun`
- errors are returned (not raised) with secrets and payment headers redacted
- a server error without payment (e.g. a bad facilitator key) is reported as `error`, not as a success

`test_crew_offline.py` runs the crew from `agent.py` with a scripted LLM: two agents, only the payer holds the tool, the cheap route is paid, and the $2 route is refused while the crew still completes.

## Testnet Evidence

**Run against my own `x402Serve` route (`server/`, stellar:testnet, Nov 21 2026):**

| Step | Value |
|---|---|
| Seller account (`SELLER_PUBLIC_KEY`, receives the payment) | [GDYJA25NGJWWMGTAC73LG4J2X6FCVSTC7CTVJZKT3EZSBUYM5WOKIV5Z](https://stellar.expert/explorer/testnet/account/GDYJA25NGJWWMGTAC73LG4J2X6FCVSTC7CTVJZKT3EZSBUYM5WOKIV5Z) |
| Payer account (`STELLAR_SECRET_KEY`'s public key) | [GBTBTAO3MGBSBQ6ARGHSRRJLPJ7UBI7HCGHP47DO77TJZYWPN7KSRIY5](https://stellar.expert/explorer/testnet/account/GBTBTAO3MGBSBQ6ARGHSRRJLPJ7UBI7HCGHP47DO77TJZYWPN7KSRIY5) |
| Paid call `/paid/market-summary` through the crew's Payer | [632ebebcd63c2c202fe2c7e3ef60c27b6ab99f31f663e3b71730017d58293d8d](https://stellar.expert/explorer/testnet/tx/632ebebcd63c2c202fe2c7e3ef60c27b6ab99f31f663e3b71730017d58293d8d): 0.02 USDC from the payer to the seller above |
| Refused call `/paid/full-report` ($2 > $1 cap) | Refused before signing with `X402SpendCapError`, no transaction. Crew answer: "The payment was refused before signing because it exceeds the $1 cap." Tool message: "Payment refused before signing: the price is above the per-payment cap of $1. Nothing was signed or sent." |

## How the Spend Cap Works

1. The server answers `402` with its payment options in the `payment-required` header.
2. The SDK picks the option on the configured network and compares its USDC amount with `max_amount_per_payment`.
3. If it is above the cap, it raises `X402SpendCapError` **before** building or signing anything.
4. The tool returns:

```json
{
  "status": "refused",
  "error": "X402SpendCapError",
  "url": "http://localhost:3402/paid/full-report",
  "cap": "$1",
  "requested_amount_stroops": "20000000",
  "asset": "CBIELTK6YBZJU5UP2WWQEUCYKLPU6AUNZ2BQ4WWFEIE3USCIHMXQDAMA",
  "network": "stellar:testnet",
  "signed": false,
  "message": "Payment refused before signing: the price is above the per-payment cap of $1. Nothing was signed or sent."
}
```

## Usage

```python
from crewai import Agent, Crew, Task
from nirium_crewai_tool import NiriumX402Tool

tool = NiriumX402Tool(
    secret_key="S...",              # your own testnet key, from .env
    network="stellar:testnet",
    max_amount_per_payment="$1",
)
payer = Agent(role="Payer", goal="Fetch paid x402 data", backstory="...", tools=[tool])
```

## Security Checklist

- Testnet only (no mainnet, no real funds)
- `.env`, `.venv/` and `seller.secret` are in `.gitignore`
- The secret goes only to `init_x402`: not stored on the tool, not in the LLM-visible schema, redacted from errors
- The spend cap is enforced by the SDK before signing
- Own keys only; no custody

## License

Apache-2.0 (same as Nirium Protocol)
