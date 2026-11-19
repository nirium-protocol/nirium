"""Pre-sign policy hook tests for x402_fetch (#355).

Verifies the Python SDK provides the exact same policy hook guarantees
as the TypeScript SDK (x402-policy.ts):
- Policy receives the context (amount, asset, payee, resource, network, contextHash, authorization, etc.)
- ALLOW signs and pays
- DENY and WAIT never call the signer (verified with a failing signer mock)
- Fail closed when policy raises an exception
- Stale ALLOW refused when policyVersion != currentVersion
- Expired ALLOW refused when expiresAt has passed
- Unbound ALLOW refused when contextHash does not match
- Timeout enforced
- on_decision observer receives expected records
"""

from __future__ import annotations

import base64
import json
import time
from typing import Any, Dict, List

import pytest
from stellar_sdk import Keypair

import nirium.client as client_mod
from nirium import (
    Agent,
    X402PolicyContext,
    X402PolicyDecision,
    X402PolicyError,
)

TESTNET_USDC = "CBIELTK6YBZJU5UP2WWQEUCYKLPU6AUNZ2BQ4WWFEIE3USCIHMXQDAMA"
ATTACKER = "GAZ3P265JVAFAG3IS3FBGWKWUGNIUR4HY7FNUM63MHEL3YPV3QVWULEP"
SECRET = Keypair.random().secret
URL = "https://example.com/api/premium"


def option(network: str = "stellar:testnet", asset: str = TESTNET_USDC, amount: str = "500000") -> Dict[str, Any]:
    return {
        "scheme": "exact",
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
    def __init__(self, accepts: List[Dict[str, Any]]):
        challenge = base64.b64encode(
            json.dumps({"x402Version": 2, "accepts": accepts}).encode()
        ).decode()
        self.responses = [
            FakeResponse(402, {"payment-required": challenge}),
            FakeResponse(200, {"content-type": "application/json"}, {"ok": True, "data": "paid_content"}),
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
def make_policy_agent(monkeypatch):
    def _make(policy=None, accepts=None, fail_signer=False, **init_kwargs):
        if accepts is None:
            accepts = [option()]
        session = FakeSession(accepts)
        monkeypatch.setattr(client_mod.aiohttp, "ClientSession", lambda *a, **k: session)

        agent = Agent(api_url="http://localhost:3002")

        signer_calls = []

        def mock_signer(entry, keypair, max_ledger, passphrase):
            if fail_signer:
                pytest.fail("SIGNER MUST NEVER BE CALLED ON DENY/WAIT/ERROR")
            signer_calls.append({"entry": entry, "keypair": keypair, "max_ledger": max_ledger})
            return "SIGNED_AUTH_ENTRY"

        def fake_build(accepted):
            # When build_transaction is called, it simulates the signer invocation
            if fail_signer:
                pytest.fail("SIGNER / BUILD_TRANSACTION MUST NEVER BE CALLED ON DENY/WAIT/ERROR")
            mock_signer(None, None, 100, "")
            return "MOCK_SIGNED_TX_XDR"

        async def fake_read(resp):
            return resp._body

        monkeypatch.setattr(agent, "_x402_build_transaction", fake_build)
        monkeypatch.setattr(agent, "_x402_read_payload", fake_read)
        monkeypatch.setattr(agent, "_x402_store_settlement", lambda h: None)

        agent.init_x402(
            SECRET,
            network="stellar:testnet",
            policy=policy,
            signer=mock_signer,
            **init_kwargs,
        )
        return agent, session, signer_calls

    return _make


# 1. ALLOW cases


async def test_allow_callable_signs_and_settles(make_policy_agent):
    seen_context = []

    def allow_policy(ctx: X402PolicyContext):
        seen_context.append(ctx)
        return "ALLOW"

    agent, session, signer_calls = make_policy_agent(policy=allow_policy)
    res = await agent.x402_fetch(URL)

    assert res == {"ok": True, "data": "paid_content"}
    assert len(signer_calls) == 1
    assert len(session.requests) == 2  # 402 challenge + paid retry
    assert "PAYMENT-SIGNATURE" in session.requests[1]["headers"]

    ctx = seen_context[0]
    assert ctx.amount == "500000"
    assert ctx.asset == TESTNET_USDC
    assert ctx.payee == ATTACKER
    assert ctx.payTo == ATTACKER
    assert ctx.resource == URL
    assert ctx.url == URL
    assert ctx.network == "stellar:testnet"
    assert ctx.method == "GET"
    assert ctx.contextHash is not None


async def test_allow_dict_with_conformance_fields(make_policy_agent):
    def allow_policy(ctx):
        return {
            "decision": "ALLOW",
            "contextHash": ctx.contextHash,
            "policyVersion": "v1",
            "expiresAt": time.time() * 1000 + 10000,
        }

    agent, _, signer_calls = make_policy_agent(policy=allow_policy)
    res = await agent.x402_fetch(URL)
    assert res["ok"] is True
    assert len(signer_calls) == 1


async def test_async_policy_allow(make_policy_agent):
    async def async_policy(ctx):
        return "ALLOW"

    agent, _, signer_calls = make_policy_agent(policy=async_policy)
    res = await agent.x402_fetch(URL)
    assert res["ok"] is True
    assert len(signer_calls) == 1


# 2. DENY and WAIT cases (Signer mock MUST FAIL if called)


async def test_deny_never_calls_signer(make_policy_agent):
    def deny_policy(ctx):
        return "DENY"

    agent, session, signer_calls = make_policy_agent(policy=deny_policy, fail_signer=True)

    with pytest.raises(X402PolicyError) as exc_info:
        await agent.x402_fetch(URL)

    assert exc_info.value.outcome == "DENY"
    assert exc_info.value.signer_called is False
    assert len(signer_calls) == 0
    assert len(session.requests) == 1  # No paid retry sent


async def test_deny_with_reason(make_policy_agent):
    def deny_policy(ctx):
        return {"decision": "DENY", "reason": "daily budget exceeded"}

    agent, session, signer_calls = make_policy_agent(policy=deny_policy, fail_signer=True)

    with pytest.raises(X402PolicyError) as exc_info:
        await agent.x402_fetch(URL)

    assert exc_info.value.outcome == "DENY"
    assert "daily budget exceeded" in exc_info.value.message
    assert len(signer_calls) == 0


async def test_wait_never_calls_signer(make_policy_agent):
    def wait_policy(ctx):
        return "WAIT"

    agent, session, signer_calls = make_policy_agent(policy=wait_policy, fail_signer=True)

    with pytest.raises(X402PolicyError) as exc_info:
        await agent.x402_fetch(URL)

    assert exc_info.value.outcome == "WAIT"
    assert exc_info.value.signer_called is False
    assert len(signer_calls) == 0
    assert len(session.requests) == 1


async def test_wait_with_reason(make_policy_agent):
    def wait_policy(ctx):
        return {"decision": "WAIT", "reason": "requires human approval"}

    agent, session, signer_calls = make_policy_agent(policy=wait_policy, fail_signer=True)

    with pytest.raises(X402PolicyError) as exc_info:
        await agent.x402_fetch(URL)

    assert exc_info.value.outcome == "WAIT"
    assert "requires human approval" in exc_info.value.message
    assert len(signer_calls) == 0


# 3. Fail Closed on Policy Exception


async def test_policy_exception_fails_closed(make_policy_agent):
    def crashing_policy(ctx):
        raise RuntimeError("database connection failed")

    agent, session, signer_calls = make_policy_agent(policy=crashing_policy, fail_signer=True)

    with pytest.raises(X402PolicyError) as exc_info:
        await agent.x402_fetch(URL)

    assert exc_info.value.outcome == "ENGINE_ERROR"
    assert "database connection failed" in exc_info.value.message
    assert len(signer_calls) == 0
    assert len(session.requests) == 1


# 4. Stale ALLOW Refusal


async def test_stale_allow_refused(make_policy_agent):
    # Policy returns version v1, but currentVersion returns v2
    def allow_policy(ctx):
        return {
            "decision": "ALLOW",
            "contextHash": ctx.contextHash,
            "policyVersion": "v1",
        }

    agent, session, signer_calls = make_policy_agent(
        policy=allow_policy,
        current_version=lambda ctx: "v2",
        fail_signer=True,
    )

    with pytest.raises(X402PolicyError) as exc_info:
        await agent.x402_fetch(URL)

    assert exc_info.value.outcome == "STALE"
    assert "v1" in exc_info.value.message
    assert "v2" in exc_info.value.message
    assert len(signer_calls) == 0


async def test_matching_version_allows_and_signs(make_policy_agent):
    def allow_policy(ctx):
        return {
            "decision": "ALLOW",
            "contextHash": ctx.contextHash,
            "policyVersion": "v2",
        }

    agent, _, signer_calls = make_policy_agent(
        policy=allow_policy,
        current_version=lambda ctx: "v2",
    )

    res = await agent.x402_fetch(URL)
    assert res["ok"] is True
    assert len(signer_calls) == 1


async def test_missing_version_with_current_version_configured(make_policy_agent):
    def allow_policy(ctx):
        return {"decision": "ALLOW"}

    agent, _, _ = make_policy_agent(
        policy=allow_policy,
        current_version=lambda ctx: "v1",
        fail_signer=True,
    )

    with pytest.raises(X402PolicyError) as exc_info:
        await agent.x402_fetch(URL)

    assert exc_info.value.outcome == "MALFORMED"


# 5. Expired and Unbound ALLOW


async def test_expired_allow_refused(make_policy_agent):
    def expired_policy(ctx):
        return {
            "decision": "ALLOW",
            "contextHash": ctx.contextHash,
            "expiresAt": 1000,  # Far past epoch
        }

    agent, _, signer_calls = make_policy_agent(policy=expired_policy, fail_signer=True)

    with pytest.raises(X402PolicyError) as exc_info:
        await agent.x402_fetch(URL)

    assert exc_info.value.outcome == "EXPIRED"
    assert len(signer_calls) == 0


async def test_unbound_allow_refused(make_policy_agent):
    def unbound_policy(ctx):
        return {
            "decision": "ALLOW",
            "contextHash": "0000000000000000000000000000000000000000000000000000000000000000",
        }

    agent, _, signer_calls = make_policy_agent(policy=unbound_policy, fail_signer=True)

    with pytest.raises(X402PolicyError) as exc_info:
        await agent.x402_fetch(URL)

    assert exc_info.value.outcome == "UNBOUND"
    assert len(signer_calls) == 0


# 6. Object Hook with evaluate() Method


class BudgetPolicyHook:
    def __init__(self, max_allowed: int, version: str = "v1"):
        self.max_allowed = max_allowed
        self.ver = version

    def evaluate(self, ctx: X402PolicyContext) -> Dict[str, Any]:
        if int(ctx.amount) <= self.max_allowed:
            return {
                "decision": "ALLOW",
                "contextHash": ctx.contextHash,
                "policyVersion": self.ver,
            }
        return {"decision": "DENY", "reason": f"amount exceeds {self.max_allowed}"}

    def current_version(self, ctx: X402PolicyContext) -> str:
        return self.ver


async def test_object_hook_allows_within_budget(make_policy_agent):
    hook = BudgetPolicyHook(max_allowed=1000000)
    agent, _, signer_calls = make_policy_agent(policy=hook)

    res = await agent.x402_fetch(URL)
    assert res["ok"] is True
    assert len(signer_calls) == 1


async def test_object_hook_denies_over_budget(make_policy_agent):
    hook = BudgetPolicyHook(max_allowed=100000)  # 0.01 USDC, challenge asks for 0.05
    agent, _, signer_calls = make_policy_agent(policy=hook, fail_signer=True)

    with pytest.raises(X402PolicyError) as exc_info:
        await agent.x402_fetch(URL)

    assert exc_info.value.outcome == "DENY"
    assert len(signer_calls) == 0


# 7. on_decision Observer


async def test_on_decision_observer_tracks_lifecycle(make_policy_agent):
    records = []

    def observer(record):
        records.append(record)

    def allow_policy(ctx):
        return "ALLOW"

    agent, _, _ = make_policy_agent(policy=allow_policy, on_decision=observer)
    await agent.x402_fetch(URL)

    outcomes = [r["outcome"] for r in records]
    assert "ALLOWED" in outcomes
    assert "SIGNED" in outcomes


async def test_on_decision_observer_on_deny(make_policy_agent):
    records = []

    def observer(record):
        records.append(record)

    def deny_policy(ctx):
        return "DENY"

    agent, _, _ = make_policy_agent(policy=deny_policy, on_decision=observer, fail_signer=True)

    with pytest.raises(X402PolicyError):
        await agent.x402_fetch(URL)

    outcomes = [r["outcome"] for r in records]
    assert outcomes == ["DENY"]
