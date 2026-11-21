"""TDD @999@: balances must come from Horizon's account endpoint, not load_account().

`Server.load_account()` returns an `Account` object whose only useful attribute is
`sequence`; it has NO `.balances`. Real balances live in
`server.accounts().account_id(...).call()["balances"]`.
"""

import pytest
from unittest.mock import MagicMock

from src.usdc import BLEND_USDC_ISSUER, ensure_usdc_trustline, preflight_xlm, usdc_balance

PUB = "GARCTB67MVN4WTRPUPE7Q4QFDF6MB5X6SMK6AGFVKJUEGHGZQPL7XQS2"


def _server_with_balances(balances):
    """load_account() -> Account WITHOUT .balances (stellar_sdk 15.x)."""
    server = MagicMock()
    server.load_account.return_value = MagicMock(spec=["sequence"])
    server.accounts.return_value.account_id.return_value.call.return_value = {
        "balances": balances
    }
    return server


@pytest.mark.asyncio
async def test_usdc_balance_lee_horizon_accounts_call(monkeypatch):
    server = _server_with_balances([
        {"asset_type": "native", "balance": "10000.0000000"},
        {"asset_type": "credit_alphanum4", "asset_code": "USDC",
         "asset_issuer": BLEND_USDC_ISSUER, "balance": "1000.0000000"},
    ])
    monkeypatch.setattr("src.usdc._horizon_server", lambda: server)
    got = await usdc_balance(PUB)
    assert got == 1000 * 10_000_000
    server.accounts.return_value.account_id.assert_called_once_with(PUB)


@pytest.mark.asyncio
async def test_preflight_xlm_lee_horizon_accounts_call(monkeypatch):
    server = _server_with_balances([
        {"asset_type": "native", "balance": "10000.0000000"},
    ])
    monkeypatch.setattr("src.usdc._horizon_server", lambda: server)
    await preflight_xlm(PUB)  # no debe lanzar


@pytest.mark.asyncio
async def test_ensure_usdc_trustline_detecta_trustline_existente(monkeypatch):
    server = _server_with_balances([
        {"asset_type": "native", "balance": "10000.0000000"},
        {"asset_type": "credit_alphanum4", "asset_code": "USDC",
         "asset_issuer": BLEND_USDC_ISSUER, "balance": "1000.0000000"},
    ])
    monkeypatch.setattr("src.usdc._horizon_server", lambda: server)
    result = await ensure_usdc_trustline("S-" + "x" * 56, PUB)
    assert result is None  # ya tiene trustline -> no envia tx
