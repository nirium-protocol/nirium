
# Claude Tool Use x402 Payments

A Claude Messages API tool that pays x402-protected endpoints using the Nirium Python SDK on Stellar testnet.

## Features

- Claude tool use with Anthropic Messages API.
- Nirium SDK x402 payment integration.
- $1 per-payment cap.
- Over-cap requests refused before signing.
- Structured success, refusal and error results.
- Secret key remains in the local Python process.
- Offline tests without network access.

## Requirements

Python 3.10+ and your own Stellar testnet accounts.

Install dependencies:

```bash
pip install -r requirements.txt
```

## Configuration

Copy `.env.example` to `.env`.

Set your own:
- STELLAR_SECRET_KEY: payer's testnet secret.
- ANTHROPIC_API_KEY: your Anthropic API key.
- SELLER_PUBLIC_KEY: your own receiving testnet account.
- FACILITATOR_API_KEY: testnet facilitator key.

Never commit `.env`.

## Run the server

The server directory contains the local x402Serve example.

```bash
cd server
npm install
npm start
```

The server should expose:

- `/paid/market-summary`: below the $1 cap.
- `/paid/full-report`: $2, above the $1 cap.

Verify that the routes use your own seller account.

## Run Claude

From the example directory:

```bash
python agent.py
```

Claude will attempt the paid market summary and the over-cap full report.

## Offline tests

```bash
pytest -v
```

Tests cover successful tool results, uninitialized clients and over-cap refusal.

## Testnet Evidence

Add your own verified Stellar testnet transaction hashes after running the paid example.

| Evidence | Result |
|---|---|
| Payer account | Add your account |
| Seller account | Add your account |
| Paid transaction | Add your transaction hash |
| Over-cap request | Refused before signing |
| Demo video | Add PR recording |

Do not reuse another contributor's transaction hashes.

## Security

- Testnet only.
- No mainnet payments.
- Private keys never enter Claude's tool schema.
- Private keys are never returned in tool results.
- Per-payment cap enforced by the Nirium SDK.
- No custody.

## License

Apache-2.0.
