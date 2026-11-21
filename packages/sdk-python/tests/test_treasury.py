"""Unit tests for the Python SDK Treasury methods.

Issue: nirium-protocol/nirium#359 — every Treasury method must be covered
(HTTP verb, path and body) with the HTTP layer mocked: no network, no keys.

Every method of `Agent` is exercised against an `AsyncMock`-ed `_get`/`_post`,
so a regression in a route, a query string or a body key fails here instead of
in production. `Agent.__new__` avoids running `__init__` (which would need a
real API URL/session); only `api_url` and `headers` are set, like `__init__` does.
"""

from __future__ import annotations

from typing import Any
from unittest.mock import AsyncMock

import pytest

from nirium import Agent

VAULT = "CAVVAULTAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA"
MANAGER = "GMANAGERAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA"
CALLER = "GCALLERAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA"
HOLDER = "GHOLDERAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA"
STRATEGY = "CSTRATEGYAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA"
ASSET = "CASSETAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA"
XDR = "AAAAAgAAAABzdellar-xdr-envelope"


def make_agent() -> Agent:
    agent = Agent.__new__(Agent)
    agent.api_url = "https://api.test"
    agent.headers = {"content-type": "application/json"}
    agent._get = AsyncMock(return_value={"ok": True})
    agent._post = AsyncMock(return_value={"ok": True})
    return agent


# ─── Reads (GET) ────────────────────────────────────────────────────────────


async def test_get_treasury_info_calls_info_route():
    agent = make_agent()

    result = await agent.get_treasury_info()

    assert result == {"ok": True}
    agent._get.assert_awaited_once_with("/api/treasury/info")
    agent._post.assert_not_awaited()


async def test_get_treasury_vault_uses_path_and_holder_query():
    agent = make_agent()

    await agent.get_treasury_vault("vault-1", holder=HOLDER)

    agent._get.assert_awaited_once_with(
        "/api/treasury/vault/vault-1", params={"holder": HOLDER}
    )
    agent._post.assert_not_awaited()


async def test_get_treasury_vault_without_holder_sends_none():
    """`_get` drops None params, so the helper receives None and omits it."""
    agent = make_agent()

    await agent.get_treasury_vault("vault-1")

    agent._get.assert_awaited_once_with(
        "/api/treasury/vault/vault-1", params={"holder": None}
    )


async def test_get_treasury_vaults_uses_manager_query():
    agent = make_agent()

    await agent.get_treasury_vaults(manager=MANAGER)

    agent._get.assert_awaited_once_with("/api/treasury/vaults", params={"manager": MANAGER})


async def test_get_treasury_vaults_without_manager_sends_none():
    agent = make_agent()

    await agent.get_treasury_vaults()

    agent._get.assert_awaited_once_with("/api/treasury/vaults", params={"manager": None})


async def test_get_treasury_strategy_asset_uses_strategy_path():
    agent = make_agent()

    await agent.get_treasury_strategy_asset(STRATEGY)

    agent._get.assert_awaited_once_with(f"/api/treasury/strategy/{STRATEGY}")


# ─── Writes (POST) ──────────────────────────────────────────────────────────


async def test_deploy_treasury_vault_builds_minimal_payload():
    agent = make_agent()
    assets = [{"address": ASSET, "strategies": [{"address": STRATEGY, "name": "Blend"}]}]

    await agent.deploy_treasury_vault(MANAGER, CALLER, assets, "Nirium Vault", "NVLT")

    agent._post.assert_awaited_once_with(
        "/api/treasury/deploy",
        {
            "manager": MANAGER,
            "caller": CALLER,
            "assets": assets,
            "name": "Nirium Vault",
            "symbol": "NVLT",
        },
    )
    agent._get.assert_not_awaited()


async def test_deploy_treasury_vault_adds_optional_roles_in_camel_case():
    agent = make_agent()
    assets: list[dict[str, Any]] = []

    await agent.deploy_treasury_vault(
        MANAGER,
        CALLER,
        assets,
        "Nirium Vault",
        "NVLT",
        emergency_manager="GEMERGENCY",
        fee_receiver="GFEE",
        rebalance_manager="GREBALANCE",
    )

    payload = agent._post.await_args.args[1]
    assert payload["emergencyManager"] == "GEMERGENCY"
    assert payload["feeReceiver"] == "GFEE"
    assert payload["rebalanceManager"] == "GREBALANCE"
    assert "emergency_manager" not in payload


async def test_deploy_treasury_vault_omits_none_optional_roles():
    agent = make_agent()

    await agent.deploy_treasury_vault(MANAGER, CALLER, [], "N", "S")

    payload = agent._post.await_args.args[1]
    assert set(payload) == {"manager", "caller", "assets", "name", "symbol"}


async def test_deposit_to_treasury_vault_stringifies_amounts():
    agent = make_agent()

    await agent.deposit_to_treasury_vault(VAULT, HOLDER, [1, "2500000"])

    agent._post.assert_awaited_once_with(
        "/api/treasury/deposit",
        {"vault": VAULT, "from": HOLDER, "amounts": ["1", "2500000"]},
    )


async def test_deposit_to_treasury_vault_includes_optional_flags():
    agent = make_agent()

    await agent.deposit_to_treasury_vault(
        VAULT, HOLDER, [7], invest=True, max_slippage_bps=50
    )

    payload = agent._post.await_args.args[1]
    assert payload["invest"] is True
    assert payload["maxSlippageBps"] == 50


async def test_deposit_to_treasury_vault_omits_optional_when_none():
    agent = make_agent()

    await agent.deposit_to_treasury_vault(VAULT, HOLDER, [7])

    payload = agent._post.await_args.args[1]
    assert "invest" not in payload
    assert "maxSlippageBps" not in payload


async def test_withdraw_from_treasury_vault_stringifies_shares():
    agent = make_agent()

    await agent.withdraw_from_treasury_vault(VAULT, HOLDER, shares=9000000, max_slippage_bps=25)

    agent._post.assert_awaited_once_with(
        "/api/treasury/withdraw",
        {"vault": VAULT, "from": HOLDER, "shares": "9000000", "maxSlippageBps": 25},
    )


async def test_withdraw_from_treasury_vault_without_shares_means_all():
    agent = make_agent()

    await agent.withdraw_from_treasury_vault(VAULT, HOLDER)

    payload = agent._post.await_args.args[1]
    assert payload == {"vault": VAULT, "from": HOLDER}
    assert "shares" not in payload


async def test_set_treasury_rebalance_manager_payload():
    agent = make_agent()

    await agent.set_treasury_rebalance_manager(VAULT, MANAGER, "GNEWMANAGER")

    agent._post.assert_awaited_once_with(
        "/api/treasury/set-rebalance-manager",
        {"vault": VAULT, "manager": MANAGER, "rebalanceManager": "GNEWMANAGER"},
    )


INSTRUCTIONS = [{"kind": "Invest", "strategy": STRATEGY, "amount": "1000000"}]


async def test_build_treasury_rebalance_payload():
    agent = make_agent()

    await agent.build_treasury_rebalance(VAULT, INSTRUCTIONS)

    agent._post.assert_awaited_once_with(
        "/api/treasury/rebalance", {"vault": VAULT, "instructions": INSTRUCTIONS}
    )


async def test_build_treasury_rebalance_includes_caller_when_given():
    agent = make_agent()

    await agent.build_treasury_rebalance(VAULT, INSTRUCTIONS, caller=CALLER)

    payload = agent._post.await_args.args[1]
    assert payload["caller"] == CALLER
    assert payload["instructions"] == INSTRUCTIONS


async def test_propose_treasury_rebalance_payload_and_min_idle():
    agent = make_agent()

    await agent.propose_treasury_rebalance(VAULT, CALLER, enter_at=1000.0, exit_at=2000.0, min_idle=500)

    agent._post.assert_awaited_once_with(
        "/api/treasury/rebalance/propose",
        {
            "vault": VAULT,
            "caller": CALLER,
            "enterAt": 1000.0,
            "exitAt": 2000.0,
            "minIdle": "500",
        },
    )


async def test_propose_treasury_rebalance_omits_min_idle_when_none():
    agent = make_agent()

    await agent.propose_treasury_rebalance(VAULT, CALLER, enter_at=1.0, exit_at=2.0)

    payload = agent._post.await_args.args[1]
    assert "minIdle" not in payload
    assert payload["enterAt"] == 1.0
    assert payload["exitAt"] == 2.0


async def test_execute_treasury_rebalance_payload():
    agent = make_agent()

    await agent.execute_treasury_rebalance(VAULT, INSTRUCTIONS, caller=CALLER)

    agent._post.assert_awaited_once_with(
        "/api/treasury/rebalance/execute",
        {"vault": VAULT, "instructions": INSTRUCTIONS, "caller": CALLER},
    )


async def test_execute_treasury_rebalance_omits_caller_when_none():
    agent = make_agent()

    await agent.execute_treasury_rebalance(VAULT, INSTRUCTIONS)

    payload = agent._post.await_args.args[1]
    assert payload == {"vault": VAULT, "instructions": INSTRUCTIONS}


async def test_submit_treasury_tx_posts_the_unsigned_xdr():
    agent = make_agent()

    await agent.submit_treasury_tx(XDR)

    agent._post.assert_awaited_once_with("/api/treasury/submit", {"xdr": XDR})


# ─── Error propagation (no swallowing) ──────────────────────────────────────


async def test_treasury_reads_propagate_http_errors():
    agent = make_agent()
    agent._get.side_effect = RuntimeError("HTTP 503 from /api/treasury/info")

    with pytest.raises(RuntimeError, match="HTTP 503"):
        await agent.get_treasury_info()


async def test_treasury_writes_propagate_http_errors():
    agent = make_agent()
    agent._post.side_effect = RuntimeError("HTTP 400 from /api/treasury/submit")

    with pytest.raises(RuntimeError, match="HTTP 400"):
        await agent.submit_treasury_tx(XDR)


async def test_treasury_methods_return_the_http_payload_untouched():
    """The SDK must not reshape responses: callers rely on the raw JSON."""
    agent = make_agent()
    payload = {"vault": {"id": VAULT, "assets": [ASSET]}, "xdr": XDR}
    agent._get.return_value = payload
    agent._post.return_value = payload

    assert await agent.get_treasury_vaults() is payload
    assert await agent.build_treasury_rebalance(VAULT, []) is payload
