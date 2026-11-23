# FastAPI x402 Seller (Python, testnet)

A **FastAPI** app that sells one route with **x402 v2** on `stellar:testnet`, paid end to end by the **Nirium Python SDK**.

- `GET /paid/forecast` answers **402** with the payment requirements in the `PAYMENT-REQUIRED` header.
- When the payer retries with `PAYMENT-SIGNATURE`, the server checks the offer against its own price, then **verifies and settles** it through the testnet facilitator (OpenZeppelin Channels). Only then does the route body run.
- The settlement goes back in the `PAYMENT-RESPONSE` header, which the Nirium SDK reads into `agent.last_x402_settlement`.
- `payTo` is a public address. **There is no seller secret key on the server**: the payer signs the USDC transfer and the facilitator submits it and pays the fee.

Testnet only: no real funds, no mainnet, no custody. Every key stays with whoever owns it.

## Package Versions Tested

Python 3.11+ (FastAPI 0.165 needs 3.11). Tested on 3.11, 3.12 and 3.13, from `requirements.txt`:

```
fastapi==0.165.0
uvicorn==0.54.0
httpx==0.28.1
python-dotenv==1.2.4
nirium==0.12.9
stellar-sdk==15.0.0
pytest==9.2.0
```

## Files

- **`x402_seller.py`**: the reusable part. `X402Seller.paid(price)` is a FastAPI dependency that issues the 402 challenge, matches the offer, and calls the facilitator's `/verify` and `/settle`. `FacilitatorClient` is a small `httpx` client for `/supported`, `/verify` and `/settle`.
- **`app.py`**: the app: `/health` (free) and `/paid/forecast` (paid, `$0.01` by default).
- **`pay.py`**: the payer, using the Nirium Python SDK (`Agent.init_x402` + `x402_fetch`). `--unpaid`, `--underpaid`, `--short-transfer` and `--replay` show the 402 cases (the last two use the SDK's internal `_x402_build_transaction` to sign by hand: a smaller transfer, or one payment sent twice).
- **`setup_testnet.py`**: one-time setup of your own payer and seller testnet accounts.
- **`tests/`**: offline tests (mocked facilitator, no network).
- **`requirements.txt`**, **`pytest.ini`**, **`.env.example`**, **`.gitignore`**

## Setup

```bash
cd examples/fastapi-x402-seller
python3 -m venv .venv && source .venv/bin/activate
pip install -r requirements.txt
python setup_testnet.py   # or fill .env by hand from .env.example
```

`setup_testnet.py` creates **your own** payer and seller accounts with Friendbot, adds a USDC trustline to both, buys 5 testnet USDC for the payer on the testnet DEX, and writes `.env`. It prints the seller secret once for you to keep; it is not written to `.env` because the server never needs it.

Then add a free testnet facilitator key from https://channels.openzeppelin.com/testnet/gen to `.env` as `FACILITATOR_API_KEY`.

| Variable | Used by | Purpose |
|---|---|---|
| `SELLER_PUBLIC_KEY` | `app.py` | Testnet account (G...) that receives the payments. Needs a USDC trustline. |
| `FACILITATOR_API_KEY` | `app.py` | OpenZeppelin Channels **testnet** key (a mainnet key returns 401). |
| `X402_PRICE` | `app.py` | Price of `/paid/forecast` in USD, default `$0.01` (= `100000` atomic USDC). |
| `FACILITATOR_URL` | `app.py` | Optional; default `https://channels.openzeppelin.com/x402/testnet`. |
| `STELLAR_SECRET_KEY` | `pay.py` | Your own testnet payer secret, with a USDC trustline and testnet USDC. |

## Run

Terminal 1, the seller:

```bash
python app.py              # http://127.0.0.1:8402
```

Terminal 2, the payer:

```bash
python pay.py --unpaid     # 402 + payment requirements, no data
python pay.py --underpaid  # offers half the price: 402, no data, facilitator not called
python pay.py --short-transfer  # signs half the price, claims the full price: /verify rejects it, 402
python pay.py --replay     # sends one signed payment twice: 200, then 402 (nonce already used)
python pay.py              # Nirium SDK pays $0.01, prints the data and the settlement tx
```

## Tests

No network, no keys, no funds:

```bash
pytest -v
```

`tests/test_seller.py` drives the app with FastAPI's `TestClient` and a fake facilitator (`httpx.MockTransport`):

- unpaid request: 402, `PAYMENT-REQUIRED` decodes to x402 v2 (`exact`, `stellar:testnet`, testnet USDC, `payTo`, atomic `amount`, `extra.areFeesSponsored` from `/supported`), no data, no verify/settle
- paid request: `/verify` then `/settle` with `Authorization: Bearer <key>`, then 200 with the data and `PAYMENT-RESPONSE`
- the facilitator always gets the **server's** requirements, never the ones the payer echoed
- underpaid offer (`accepted.amount` below the price): 402, facilitator never called
- underpaid transfer that echoes the right amount: `/verify` rejects it, 402, never settled
- different `payTo`, network, asset or scheme: 402
- failed settlement: 402, no data
- the same payment sent again: the facilitator rejects the used nonce, 402, served once
- malformed headers (not base64, not JSON, x402 v1, v1 `X-PAYMENT`, oversized): 402
- facilitator down or answering 401/429/5xx: 503/502, no data
- a secret key (`S...`) as `payTo` is refused at startup; the example refuses any network but testnet

`tests/test_nirium_sdk_offline.py` runs the app under uvicorn on `127.0.0.1` and pays it with the **real Nirium SDK** (`Agent.x402_fetch`). Only the SDK's Soroban signing step is replaced, because it needs a testnet RPC. It checks that the SDK pays the route and reads the settlement, and that a `$2` route is refused by the SDK's default `$1` cap before anything is signed.

The suite also passes inside a network namespace with no interfaces except loopback (`unshare -rn`).

## How It Works

```
payer (Nirium SDK)            FastAPI app                       facilitator (OZ Channels, testnet)
  GET /paid/forecast  ───────▶  402  PAYMENT-REQUIRED  ◀── extra from /supported (once)
  sign USDC transfer
  GET + PAYMENT-SIGNATURE ───▶  offer == our requirements?  (no → 402)
                                POST /verify  ───────────────────▶ isValid?   (no → 402)
                                POST /settle  ───────────────────▶ submits the tx, pays the fee
                                route body runs
  200 + PAYMENT-RESPONSE  ◀───  data + settlement (tx hash)
```

1. The 402 lists one option: `exact` scheme, `stellar:testnet`, the testnet USDC contract `CBIELTK6YBZJU5UP2WWQEUCYKLPU6AUNZ2BQ4WWFEIE3USCIHMXQDAMA`, the price in atomic units (7 decimals), your `payTo`, and the facilitator's `extra` (`areFeesSponsored: true`, which the Nirium client requires before it signs).
2. The SDK checks the price against its spend cap, signs a Soroban auth entry for `transfer(payer, payTo, amount)`, and retries with `PAYMENT-SIGNATURE` = base64 JSON `{x402Version, accepted, payload: {transaction}}`.
3. The server compares `scheme`, `network`, `asset`, `payTo` and `amount` with its own requirements. Any difference, including a lower amount, is a 402 before the facilitator is called.
4. `/verify` checks the signed transaction itself against the server's requirements, so a payer cannot claim the right amount and sign a smaller transfer. `/settle` submits it.
5. Only after a successful settlement does the route body run.

## Testnet Evidence

Run on `stellar:testnet`, Nov 23 2026, with my own keys (Friendbot), against the OpenZeppelin Channels testnet facilitator. Price `$0.01` = `100000` atomic USDC.

| | Account |
|---|---|
| Seller (`payTo`, receives; its secret is not on the server) | [GB3F6IFZ4PANQY6MWIO6LQSWFQM5COGWTOL2LWN7FYAZONN5RTDIBBUX](https://stellar.expert/explorer/testnet/account/GB3F6IFZ4PANQY6MWIO6LQSWFQM5COGWTOL2LWN7FYAZONN5RTDIBBUX) |
| Payer (`STELLAR_SECRET_KEY`, signs the USDC transfer) | [GBZULA3CFVA6MG2ZP47XAIUHNC67TTPUPHPHV7OJ2M2P5CDV2U6CRK4D](https://stellar.expert/explorer/testnet/account/GBZULA3CFVA6MG2ZP47XAIUHNC67TTPUPHPHV7OJ2M2P5CDV2U6CRK4D) |

| Step | Result | Transaction |
|---|---|---|
| Friendbot: payer / seller | funded | [`61ba29d2…423e8e`](https://stellar.expert/explorer/testnet/tx/61ba29d2d54404cf7a1aa437499860ebb60d25beab896b6a6aa13f6da3423e8e) / [`31b77fcf…7105b0`](https://stellar.expert/explorer/testnet/tx/31b77fcf77908524abbcdf8e1da378b506023f269d330dd3259bb3b0527105b0) |
| USDC trustline: payer / seller | added | [`c799cee5…a3505a`](https://stellar.expert/explorer/testnet/tx/c799cee5a57cc86fb2b4c9dc77411ba77f66928047a60c2214191df098a3505a) / [`cf708050…a20861`](https://stellar.expert/explorer/testnet/tx/cf708050262cb4edf484564ec88a9f7e624074320318abc98aa528cd85a20861) |
| Payer buys 5 testnet USDC (DEX) | 5 USDC | [`0322d7a8…b6f363`](https://stellar.expert/explorer/testnet/tx/0322d7a80da833786d9e54bff8934f01278fef50624ae10b4175d293b5b6f363) |
| `python pay.py --unpaid` | **402**, requirements in `PAYMENT-REQUIRED`, no data | none |
| `python pay.py --underpaid` (offers `50000`) | **402** `amount_mismatch`, facilitator not called | none |
| `python pay.py --short-transfer` (signs `50000`, claims `100000`) | **402** `verify_failed: invalid_exact_stellar_payload_wrong_amount` | none (not settled) |
| `python pay.py --replay`, first send / replay | **200** and settled, then **402** `verify_failed: invalid_exact_stellar_payload_simulation_failed` | [`6a0d80be…c5ee08`](https://stellar.expert/explorer/testnet/tx/6a0d80be541e853216111008a807517874533360def8cfbb9a399c70a5c5ee08) (once) |
| `python pay.py`, paid call 1 | **200** + data, 0.01 USDC payer → seller | [`163d65d8…cdb1d8`](https://stellar.expert/explorer/testnet/tx/163d65d8c365a69d91c314c1c70bd95bbecfe034a3d1f28b4cc93e346dcdb1d8) |
| `python pay.py`, paid call 2 | **200** + data, 0.01 USDC payer → seller | [`6bf1c790…f78dc5`](https://stellar.expert/explorer/testnet/tx/6bf1c790840df219b3d6dd76d223eab8fab9608b8557e2e8d0fdafd71ef78dc5) |
| Demo video run: `--replay` first send, then `python pay.py` | **200** + data each, 0.01 USDC payer → seller | [`28bc7281…f82fb7`](https://stellar.expert/explorer/testnet/tx/28bc7281a18bd9f284156b4194eda27afd1487ea13fbdd006649707173f82fb7), [`d9ab4c61…952de2`](https://stellar.expert/explorer/testnet/tx/d9ab4c61c2d86890e9a202f92a909772a2ccf0cf57d9bc227982493c04952de2) |

In every paid call the payer's key signs the Soroban authorization for `transfer(payer, seller, 100000)` on the USDC contract. The facilitator submits the transaction and pays the network fee, so the payer spent no XLM and the seller signed nothing. Horizon's effects for each paid transaction show `account_debited` 0.0100000 USDC on the payer and `account_credited` 0.0100000 USDC on the seller.

Also checked from a fresh clone of this branch with plain `pip install -r requirements.txt`: the tests pass, `setup_testnet.py` creates and funds two new accounts, and a paid call settles ([`235aa165…268400`](https://stellar.expert/explorer/testnet/tx/235aa1659ebbfc20a3b3a8e666febf5f85f41847dc281aee6246228d14268400)).
