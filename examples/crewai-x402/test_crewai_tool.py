"""Offline tests for the CrewAI x402 tool. No network, no LLM, no real funds.

The Nirium SDK runs for real; only aiohttp (the HTTP layer) and the signer are
replaced, so the spend-cap check is the SDK's own code.
"""

from __future__ import annotations

import base64
import json
from typing import Any
from unittest.mock import MagicMock, patch

import pytest
from crewai.tools import BaseTool
from stellar_sdk import Keypair

import nirium.client as nirium_client
from nirium import Agent as NiriumAgent
from nirium_crewai_tool import (
    NiriumX402Tool,
    extract_settlement_tx,
    redact_secrets,
    stellar_expert_tx_url,
)

TESTNET_USDC = "CBIELTK6YBZJU5UP2WWQEUCYKLPU6AUNZ2BQ4WWFEIE3USCIHMXQDAMA"
PAY_TO = Keypair.random().public_key
TEST_SECRET = Keypair.random().secret  # never funded, never leaves this process
CHEAP_URL = "http://localhost:3402/paid/market-summary"
EXPENSIVE_URL = "http://localhost:3402/paid/full-report"
TX_HASH = "ab" * 32


class FakeResponse:
    def __init__(self, status: int, headers: dict[str, str] | None = None, body: Any = None):
        self.status = status
        self.headers = headers or {}
        self._body = body

    async def __aenter__(self):
        return self

    async def __aexit__(self, *exc):
        return False

    async def text(self):
        return "" if self._body is None else json.dumps(self._body)


class FakeSession:
    """Replays a 402 challenge, then (if the client pays) a 200 with a settlement."""

    def __init__(self, amount: str, network: str = "stellar:testnet"):
        accepts = [{
            "scheme": "exact",
            "network": network,
            "asset": TESTNET_USDC,
            "payTo": PAY_TO,
            "amount": amount,
            "maxTimeoutSeconds": 60,
            "extra": {"areFeesSponsored": True},
        }]
        challenge = base64.b64encode(json.dumps({"x402Version": 2, "accepts": accepts}).encode()).decode()
        settlement = base64.b64encode(json.dumps({"success": True, "transaction": TX_HASH}).encode()).decode()
        self.responses = [
            FakeResponse(402, {"payment-required": challenge}),
            FakeResponse(200, {"PAYMENT-RESPONSE": settlement}, {"ok": True, "route": "market-summary"}),
        ]
        self.requests: list[dict[str, Any]] = []

    async def __aenter__(self):
        return self

    async def __aexit__(self, *exc):
        return False

    def request(self, method, url, **kwargs):
        self.requests.append({"method": method, "url": url, **kwargs})
        return self.responses.pop(0)


def _tool_with(session: FakeSession, cap: str = "$1"):
    """Real nirium Agent + real tool, fake HTTP, spy signer."""
    signer = MagicMock(return_value="signed-auth-entry-xdr")
    patches = [
        patch.object(nirium_client.aiohttp, "ClientSession", return_value=session),
        patch.object(NiriumAgent, "_x402_build_transaction", signer),
    ]
    for p in patches:
        p.start()
    tool = NiriumX402Tool(TEST_SECRET, network="stellar:testnet", max_amount_per_payment=cap)
    return tool, signer, patches


@pytest.fixture
def stop_patches():
    started: list = []
    yield started
    for p in started:
        p.stop()


def test_is_crewai_base_tool_and_schema_has_no_secret():
    tool = NiriumX402Tool(TEST_SECRET)
    assert isinstance(tool, BaseTool)
    assert tool.name == "nirium_x402_fetch"
    props = tool.args_schema.model_json_schema()["properties"]
    assert set(props) == {"url", "method"}  # no secret, no cap exposed to the LLM
    dumped = json.dumps(tool.model_dump(mode="json"), default=str)
    assert TEST_SECRET not in dumped and TEST_SECRET not in repr(tool)


def test_init_passes_cap_and_network_to_sdk():
    client = MagicMock()
    NiriumX402Tool(TEST_SECRET, max_amount_per_payment="$0.50", client=client)
    client.init_x402.assert_called_once_with(TEST_SECRET, network="stellar:testnet", max_amount_per_payment="$0.50")


def test_rejects_mainnet_typo_network():
    with pytest.raises(ValueError):
        NiriumX402Tool(TEST_SECRET, network="stellar:moonnet")


def test_paid_call_below_cap_signs_and_returns_tx(stop_patches):
    session = FakeSession(amount="200000")  # 0.02 USDC (7 decimals)
    tool, signer, patches = _tool_with(session)
    stop_patches.extend(patches)

    result = json.loads(tool.run(url=CHEAP_URL))

    assert result["status"] == "paid"
    assert result["tx_hash"] == TX_HASH
    assert result["stellar_expert"] == f"https://stellar.expert/explorer/testnet/tx/{TX_HASH}"
    assert result["data"]["ok"] is True
    signer.assert_called_once()
    assert len(session.requests) == 2
    assert "PAYMENT-SIGNATURE" in session.requests[1]["headers"]


def test_over_cap_refused_before_signing(stop_patches):
    session = FakeSession(amount="20000000")  # $2, above the $1 cap
    tool, signer, patches = _tool_with(session)
    stop_patches.extend(patches)

    result = json.loads(tool.run(url=EXPENSIVE_URL))  # must not raise

    assert result["status"] == "refused"
    assert result["error"] == "X402SpendCapError"
    assert result["signed"] is False
    assert result["cap"] == "$1"
    assert result["requested_amount_stroops"] == "20000000"
    signer.assert_not_called()
    assert len(session.requests) == 1  # only the challenge; no paid retry
    assert tool.history[-1]["status"] == "refused"


def test_network_mismatch_refused_before_signing(stop_patches):
    session = FakeSession(amount="200000", network="stellar:pubnet")
    tool, signer, patches = _tool_with(session)
    stop_patches.extend(patches)

    result = json.loads(tool.run(url=CHEAP_URL))

    assert result["status"] == "refused"
    assert result["error"] == "X402NetworkMismatchError"
    signer.assert_not_called()


@pytest.mark.asyncio
async def test_async_path_inside_running_loop(stop_patches):
    session = FakeSession(amount="200000")
    tool, _signer, patches = _tool_with(session)
    stop_patches.extend(patches)
    # _run is also safe when an event loop is already running.
    assert json.loads(tool._run(CHEAP_URL))["status"] == "paid"


@pytest.mark.asyncio
async def test_arun(stop_patches):
    session = FakeSession(amount="20000000")
    tool, signer, patches = _tool_with(session)
    stop_patches.extend(patches)
    assert json.loads(await tool.arun(url=EXPENSIVE_URL))["status"] == "refused"
    signer.assert_not_called()


def test_errors_are_returned_and_redacted():
    client = MagicMock()

    async def boom(url, method="GET"):
        raise RuntimeError(f"bad thing with {TEST_SECRET} PAYMENT-SIGNATURE: abc123")

    client.x402_fetch = boom
    tool = NiriumX402Tool(TEST_SECRET, client=client)
    out = tool.run(url=CHEAP_URL)
    assert TEST_SECRET not in out and "abc123" not in out
    assert json.loads(out)["status"] == "error"


def test_server_error_without_payment_is_reported():
    client = MagicMock()
    client.last_x402_settlement = None

    async def unavailable(url, method="GET"):
        return {"error": "x402 payments unavailable", "detail": "facilitator rejected the API key (401)"}

    client.x402_fetch = unavailable
    tool = NiriumX402Tool(TEST_SECRET, client=client)
    out = json.loads(tool.run(url=CHEAP_URL))
    assert out["status"] == "error" and "facilitator" in out["message"]


def test_invalid_url_and_method():
    tool = NiriumX402Tool(TEST_SECRET, client=MagicMock())
    assert json.loads(tool.run(url="not-a-url"))["status"] == "error"
    assert json.loads(tool.run(url=CHEAP_URL, method="TRACE"))["status"] == "error"


def test_helpers():
    assert extract_settlement_tx({"settleResponse": {"txHash": "h1"}}) == "h1"
    assert extract_settlement_tx({"transaction": {"hash": "h2"}}) == "h2"
    assert extract_settlement_tx(None) is None
    assert redact_secrets(f"key {TEST_SECRET}") == "key [REDACTED]"
    assert stellar_expert_tx_url("h").endswith("/testnet/tx/h")
