"""Pay the FastAPI route with the Nirium Python SDK on stellar:testnet.

    python pay.py              # pays once, prints the data and the settlement tx
    python pay.py --unpaid     # plain GET: shows the 402 and its requirements
    python pay.py --underpaid  # offers less than the price: 402, no data, nothing signed
    python pay.py --short-transfer
        # signs a transfer of half the price but claims the full price:
        # the facilitator's /verify rejects it, 402, nothing settled
"""

from __future__ import annotations

import argparse
import asyncio
import base64
import json
import os
import sys

import httpx
from dotenv import load_dotenv
from nirium import Agent

EXPERT_TX = "https://stellar.expert/explorer/testnet/tx/"


def show_402(resp: httpx.Response) -> None:
    print(f"HTTP {resp.status_code}")
    raw = resp.headers.get("payment-required")
    if raw:
        print(json.dumps(json.loads(base64.b64decode(raw)), indent=2))
    print("body:", resp.text)


def unpaid(url: str) -> None:
    show_402(httpx.get(url))


def underpaid(url: str) -> None:
    challenge = json.loads(base64.b64decode(httpx.get(url).headers["payment-required"]))
    offer = dict(challenge["accepts"][0])
    offer["amount"] = str(int(offer["amount"]) // 2)
    payment = {"x402Version": 2, "accepted": offer, "payload": {"transaction": "unsigned"}}
    header = base64.b64encode(json.dumps(payment).encode()).decode()
    print(f"offering {offer['amount']} atomic USDC for a {challenge['accepts'][0]['amount']} route")
    show_402(httpx.get(url, headers={"PAYMENT-SIGNATURE": header}))


def payer() -> Agent:
    secret = os.getenv("STELLAR_SECRET_KEY")
    if not secret:
        sys.exit("Set STELLAR_SECRET_KEY (your own testnet payer key) in .env")
    agent = Agent()
    agent.init_x402(secret, network="stellar:testnet", max_amount_per_payment="$0.10")
    return agent


async def short_transfer(url: str) -> None:
    challenge = json.loads(base64.b64decode(httpx.get(url).headers["payment-required"]))
    full = challenge["accepts"][0]
    short = {**full, "amount": str(int(full["amount"]) // 2)}
    # SDK internal: builds and signs the Soroban transfer for `short` without sending it.
    xdr = await payer()._x402_build_transaction(short)
    payment = {"x402Version": 2, "accepted": full, "payload": {"transaction": xdr}}
    header = base64.b64encode(json.dumps(payment).encode()).decode()
    print(f"signed a transfer of {short['amount']}, claiming {full['amount']}")
    show_402(httpx.get(url, headers={"PAYMENT-SIGNATURE": header}, timeout=60))


async def pay(url: str) -> None:
    agent = payer()
    data = await agent.x402_fetch(url)
    print(json.dumps(data, indent=2))
    tx = (agent.last_x402_settlement or {}).get("transaction")
    if tx:
        print(f"\nsettled: {EXPERT_TX}{tx}")


def main() -> None:
    load_dotenv()
    parser = argparse.ArgumentParser()
    parser.add_argument("--url", default=os.getenv("SELLER_URL", "http://127.0.0.1:8402/paid/forecast"))
    mode = parser.add_mutually_exclusive_group()
    mode.add_argument("--unpaid", action="store_true")
    mode.add_argument("--underpaid", action="store_true")
    mode.add_argument("--short-transfer", action="store_true")
    args = parser.parse_args()
    if args.unpaid:
        unpaid(args.url)
    elif args.underpaid:
        underpaid(args.url)
    elif args.short_transfer:
        asyncio.run(short_transfer(args.url))
    else:
        asyncio.run(pay(args.url))


if __name__ == "__main__":
    main()
