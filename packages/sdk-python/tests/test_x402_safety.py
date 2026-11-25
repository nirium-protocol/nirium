"""x402_fetch must not sign a payment on another network, above the cap, or in
an asset the cap cannot price, unless the integrator says so.

Covers the two cases from a responsible-disclosure report (8 Nov 2026): a 402
that only offers mainnet to a testnet client used to fall back to accepts[0],
and any amount the server chose was signed with no per-payment cap.
"""

from __future__ import annotations

import base64
import json
from typing import Any, Dict, List

import pytest
from stellar_sdk import Keypair

import nirium.client as client_mod
from nirium import Agent, X402NetworkMismatchError, X402SpendCapError

TESTNET_USDC = "CBIELTK6YBZJU5UP2WWQEUCYKLPU6AUNZ2BQ4WWFEIE3USCIHMXQDAMA"
MAINNET_USDC = "CCW67TSZV3SSS2HXMBQ5JFGCKJNXKZM7UQUWUZPUTHXSTZLEO7SJMI75"
ATTACKER = "GAZ3P265JVAFAG3IS3FBGWKWUGNIUR4HY7FNUM63MHEL3YPV3QVWULEP"
SECRET = Keypair.random().secret  # throwaway key, never funded
URL = "https://evil.example/api"


def option(network: str, asset: str, amount: str, scheme: str = "exact") -> Dict[str, Any]:
    return {
        "scheme": scheme,
        "network": network,
        "asset": asset,
        "payTo": ATTACKER,
        "amount": amount,
        "maxTimeoutSeconds": 60,
        "extra": {"areFeesSponsored": True},
    }


class FakeResponse:
    def __init__(self, status: int, headers: Dict[str, str], body: Any = None):
        self.status = status
        self.headers = headers
        self._body = body or {}

    async def __aenter__(self):
        return self

    async def __aexit__(self, *exc):
        return False

    async def json(self, *a, **k):
        return self._body

    async def text(self):
        return json.dumps(self._body)


class FakeSession:
    """First request returns the 402 challenge, the paid retry returns 200."""

    def __init__(self, accepts: List[Dict[str, Any]]):
        challenge = base64.b64encode(
            json.dumps({"x402Version": 2, "accepts": accepts}).encode()
        ).decode()
        self.responses = [
            FakeResponse(402, {"payment-required": challenge}),
            FakeResponse(200, {"content-type": "application/json"}, {"ok": True}),
        ]
        self.requests: List[Dict[str, Any]] = []

    async def __aenter__(self):
        return self

    async def __aexit__(self, *exc):
        return False

    def request(self, method, url, **kwargs):
        self.requests.append({"method": method, "url": url, **kwargs})
        return self.responses.pop(0)


@pytest.fixture
def make_agent(monkeypatch):
    def _make(accepts, **init_kwargs):
        session = FakeSession(accepts)
        monkeypatch.setattr(client_mod.aiohttp, "ClientSession", lambda *a, **k: session)
        agent = Agent(api_url="http://localhost:3002")
        agent.init_x402(SECRET, network=init_kwargs.pop("network", "stellar:testnet"), **init_kwargs)
        signed: List[Dict[str, Any]] = []

        async def fake_build(accepted, **_):
            signed.append(accepted)
            return "SIGNED_XDR"

        monkeypatch.setattr(agent, "_x402_build_transaction", fake_build)

        async def fake_read(resp):
            return resp._body

        monkeypatch.setattr(agent, "_x402_read_payload", fake_read)
        monkeypatch.setattr(agent, "_x402_store_settlement", lambda h: None)
        return agent, session, signed

    return _make


async def test_wrong_network_is_refused_not_signed(make_agent):
    # The report's case: testnet client, server only offers mainnet USDC.
    agent, session, signed = make_agent([option("stellar:pubnet", MAINNET_USDC, "500000000")])
    with pytest.raises(X402NetworkMismatchError) as e:
        await agent.x402_fetch(URL)
    assert signed == []
    assert len(session.requests) == 1  # no paid retry
    assert e.value.offered == ["stellar:pubnet"]
    assert e.value.signer_called is False


async def test_amount_above_default_cap_is_refused(make_agent):
    agent, session, signed = make_agent([option("stellar:testnet", TESTNET_USDC, "20000000")])  # 2 USDC
    with pytest.raises(X402SpendCapError) as e:
        await agent.x402_fetch(URL)
    assert signed == []
    assert e.value.cap == "$1"
    assert e.value.pay_to == ATTACKER


async def test_amount_within_cap_is_paid(make_agent):
    agent, session, signed = make_agent([option("stellar:testnet", TESTNET_USDC, "500000")])  # 0.05 USDC
    assert await agent.x402_fetch(URL) == {"ok": True}
    assert len(signed) == 1 and signed[0]["amount"] == "500000"
    assert "PAYMENT-SIGNATURE" in session.requests[1]["headers"]


async def test_exactly_the_cap_is_paid(make_agent):
    agent, _, signed = make_agent([option("stellar:testnet", TESTNET_USDC, "10000000")])  # 1 USDC
    await agent.x402_fetch(URL)
    assert len(signed) == 1


async def test_raised_cap_allows_larger_payment(make_agent):
    agent, _, signed = make_agent(
        [option("stellar:testnet", TESTNET_USDC, "20000000")], max_amount_per_payment="$5"
    )
    await agent.x402_fetch(URL)
    assert len(signed) == 1


async def test_unknown_asset_is_refused_without_approval(make_agent):
    other = "CAS3J7GYLGXMF6TDJBBYYSE3HQ6BBSMLNUQ34T6TZMYMW2EVH34XOWMA"
    agent, _, signed = make_agent([option("stellar:testnet", other, "1")])
    with pytest.raises(X402SpendCapError) as e:
        await agent.x402_fetch(URL)
    assert signed == []
    assert "not stellar:testnet USDC" in e.value.reason


async def test_approve_false_refuses(make_agent):
    seen = []
    agent, _, signed = make_agent(
        [option("stellar:testnet", TESTNET_USDC, "20000000")],
        approve=lambda req: seen.append(req) or False,
    )
    with pytest.raises(X402SpendCapError):
        await agent.x402_fetch(URL)
    assert signed == []
    assert seen[0]["payTo"] == ATTACKER and seen[0]["amount"] == "20000000"


async def test_async_approve_true_pays(make_agent):
    async def approve(req):
        return True

    agent, _, signed = make_agent(
        [option("stellar:testnet", TESTNET_USDC, "20000000")], approve=approve
    )
    await agent.x402_fetch(URL)
    assert len(signed) == 1


async def test_truthy_non_bool_approval_does_not_count(make_agent):
    agent, _, signed = make_agent(
        [option("stellar:testnet", TESTNET_USDC, "20000000")], approve=lambda req: "yes"
    )
    with pytest.raises(X402SpendCapError):
        await agent.x402_fetch(URL)
    assert signed == []


async def test_picks_cheapest_option_on_configured_network(make_agent):
    agent, _, signed = make_agent([
        option("stellar:pubnet", MAINNET_USDC, "1"),
        option("stellar:testnet", TESTNET_USDC, "900000"),
        option("stellar:testnet", TESTNET_USDC, "500000"),
    ])
    await agent.x402_fetch(URL)
    assert signed[0]["network"] == "stellar:testnet" and signed[0]["amount"] == "500000"


async def test_invalid_amount_is_refused(make_agent):
    agent, _, signed = make_agent(
        [option("stellar:testnet", TESTNET_USDC, "-5")], approve=lambda req: True
    )
    with pytest.raises(X402SpendCapError):
        await agent.x402_fetch(URL)
    assert signed == []


@pytest.mark.parametrize("bad", [0, "0", "$0", "-1", "abc", True, None, "nan"])
def test_cap_must_be_positive(bad):
    with pytest.raises(ValueError):
        Agent(api_url="http://localhost:3002").init_x402(SECRET, max_amount_per_payment=bad)


def test_unknown_network_is_rejected_at_init():
    with pytest.raises(ValueError):
        Agent(api_url="http://localhost:3002").init_x402(SECRET, network="stellar:futurenet")


@pytest.mark.parametrize("alias,canonical", [("mainnet", "stellar:pubnet"), ("stellar:mainnet", "stellar:pubnet"), ("testnet", "stellar:testnet")])
def test_network_aliases_are_normalized(alias, canonical):
    a = Agent(api_url="http://localhost:3002")
    a.init_x402(SECRET, network=alias)
    assert a._x402_network == canonical
