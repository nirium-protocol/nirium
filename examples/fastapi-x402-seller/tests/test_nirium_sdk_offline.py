"""The real Nirium Python SDK pays this FastAPI app, offline.

The app runs under uvicorn on 127.0.0.1 with a mocked facilitator. Only the
SDK's Soroban step (`_x402_build_transaction`, which needs a testnet RPC) is
replaced, so the 402 parsing, option selection, spend cap, PAYMENT-SIGNATURE
header and PAYMENT-RESPONSE handling are the SDK's own code.
"""

from __future__ import annotations

import asyncio
import socket
import threading
import time
from typing import Any, Dict, Iterator, List

import httpx
import pytest
import uvicorn
from nirium import Agent
from nirium.client import X402SpendCapError
from stellar_sdk import Keypair

from app import PAID_ROUTE, create_app
from tests.test_seller import PAY_TO, TX_HASH, FakeFacilitator

FAKE_XDR = "AAAAAgAAAAB-offline-signed-xdr"


def _free_port() -> int:
    with socket.socket() as s:
        s.bind(("127.0.0.1", 0))
        return s.getsockname()[1]


def _serve(price: str, fac: FakeFacilitator) -> Iterator[str]:
    app = create_app(
        pay_to=PAY_TO,
        price=price,
        network="stellar:testnet",
        facilitator_url="https://facilitator.test/x402/testnet",
        facilitator_api_key="test-facilitator-key",
        facilitator_transport=httpx.MockTransport(fac.handler),
    )
    port = _free_port()
    server = uvicorn.Server(uvicorn.Config(app, host="127.0.0.1", port=port, log_level="warning"))
    thread = threading.Thread(target=server.run, daemon=True)
    thread.start()
    deadline = time.time() + 10
    while not server.started:
        if time.time() > deadline:
            raise RuntimeError("uvicorn did not start")
        time.sleep(0.02)
    try:
        yield f"http://127.0.0.1:{port}{PAID_ROUTE}"
    finally:
        server.should_exit = True
        thread.join(timeout=5)


@pytest.fixture
def facilitator() -> FakeFacilitator:
    return FakeFacilitator()


@pytest.fixture
def paid_url(facilitator: FakeFacilitator) -> Iterator[str]:
    yield from _serve("$0.01", facilitator)


@pytest.fixture
def expensive_url(facilitator: FakeFacilitator) -> Iterator[str]:
    yield from _serve("$2", facilitator)


def _payer(signed: List[Dict[str, Any]]) -> Agent:
    agent = Agent()
    agent.init_x402(Keypair.random().secret, network="stellar:testnet")  # never funded

    async def fake_build(accepted: Dict[str, Any], url: str = "", method: str = "GET") -> str:
        signed.append(accepted)
        return FAKE_XDR

    agent._x402_build_transaction = fake_build  # type: ignore[method-assign]
    return agent


def test_nirium_sdk_pays_the_route(paid_url: str, facilitator: FakeFacilitator) -> None:
    signed: List[Dict[str, Any]] = []
    agent = _payer(signed)

    data = asyncio.run(agent.x402_fetch(paid_url))

    assert data["forecast"]["pair"] == "XLM/USDC"
    assert data["paidWith"]["transaction"] == TX_HASH
    assert agent.last_x402_settlement["transaction"] == TX_HASH
    assert len(signed) == 1
    assert signed[0]["amount"] == "100000"
    assert signed[0]["payTo"] == PAY_TO
    assert signed[0]["extra"] == {"areFeesSponsored": True}
    assert facilitator.paths() == ["supported", "verify", "settle"]
    sent = facilitator.calls[1]["body"]["paymentPayload"]
    assert sent["payload"] == {"transaction": FAKE_XDR}
    assert sent["accepted"] == signed[0]


def test_nirium_sdk_refuses_a_price_above_its_cap(expensive_url: str, facilitator: FakeFacilitator) -> None:
    signed: List[Dict[str, Any]] = []
    agent = _payer(signed)  # default cap is $1, the route costs $2

    with pytest.raises(X402SpendCapError):
        asyncio.run(agent.x402_fetch(expensive_url))

    assert signed == []
    assert facilitator.paths() == ["supported"]
