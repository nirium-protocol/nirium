"""FastAPI x402 seller on Stellar testnet: one paid route.

Run:  python app.py   (or: uvicorn app:create_app --factory --port 8402)
"""

from __future__ import annotations

import os
from datetime import datetime, timezone
from typing import Any, Dict, Optional

import httpx
from dotenv import load_dotenv
from fastapi import Depends, FastAPI

from x402_seller import FACILITATORS, FacilitatorClient, X402Seller

PAID_ROUTE = "/paid/forecast"


def create_app(
    pay_to: Optional[str] = None,
    price: Optional[str] = None,
    network: Optional[str] = None,
    facilitator_url: Optional[str] = None,
    facilitator_api_key: Optional[str] = None,
    facilitator_transport: Optional[httpx.AsyncBaseTransport] = None,
) -> FastAPI:
    """Build the app. Arguments override the environment (tests pass them directly)."""
    load_dotenv()
    network = network or os.getenv("X402_NETWORK", "stellar:testnet")
    if network != "stellar:testnet":
        raise ValueError("this example runs on stellar:testnet only")
    price = price or os.getenv("X402_PRICE", "$0.01")
    pay_to = pay_to or os.getenv("SELLER_PUBLIC_KEY", "")
    facilitator = FacilitatorClient(
        url=facilitator_url or os.getenv("FACILITATOR_URL") or FACILITATORS[network],
        api_key=facilitator_api_key or os.getenv("FACILITATOR_API_KEY") or None,
        transport=facilitator_transport,
    )
    seller = X402Seller(pay_to=pay_to, facilitator=facilitator, network=network)

    app = FastAPI(title="Nirium FastAPI x402 seller (testnet)")

    @app.get("/health")
    async def health() -> Dict[str, Any]:
        return {"ok": True, "network": network, "payTo": pay_to, "paidRoute": PAID_ROUTE, "price": price}

    @app.get(PAID_ROUTE)
    async def forecast(
        settlement: Dict[str, Any] = Depends(
            seller.paid(price, description="Testnet demo forecast, paid per request with x402")
        ),
    ) -> Dict[str, Any]:
        return {
            "forecast": {"pair": "XLM/USDC", "horizon": "1h", "direction": "up", "confidence": 0.62},
            "note": "Demo data. Payment settled before this body was produced.",
            "paidWith": {"network": network, "transaction": settlement.get("transaction")},
            "servedAt": datetime.now(timezone.utc).isoformat(timespec="seconds"),
        }

    return app


if __name__ == "__main__":
    import uvicorn

    uvicorn.run(create_app(), host="127.0.0.1", port=int(os.getenv("PORT", "8402")))
