"""Unit tests for the treasury quickstart — no network, no real keys.

Every HTTP call is mocked at the aiohttp layer. Keypairs are generated at
runtime (random) and never printed or written to disk.
"""

from __future__ import annotations

import json

import aiohttp
import pytest
from stellar_sdk import Account, Keypair, Network, TransactionBuilder, TransactionEnvelope

import errors as errs
import quickstart as qs
from signing import (
    TESTNET_PASSPHRASE,
    public_key_from_secret,
    require_testnet_secret,
    resolve_testnet_passphrase,
    sign_unsigned_xdr,
)


def _unsigned_xdr() -> str:
    """Build a real unsigned testnet XDR with a throwaway random keypair."""
    kp = Keypair.random()  # throwaway, generated at runtime, never printed
    account = Account(kp.public_key, 1)
    builder = TransactionBuilder(account, TESTNET_PASSPHRASE, base_fee=100)
    builder.append_manage_data_op("quickstart", "unit-test")
    builder.add_time_bounds(0, 4102444800)  # avoid unbounded-time warnings
    return builder.build().to_xdr()


# ---------------------------------------------------------------- signing ---

def test_sign_unsigned_xdr_adds_signature_without_leaking_secret():
    xdr = _unsigned_xdr()
    kp = Keypair.random()  # test-only secret, generated at runtime
    secret = kp.secret

    signed = sign_unsigned_xdr(xdr, secret, TESTNET_PASSPHRASE)

    assert signed != xdr, "the returned XDR must be the signed one"
    tx = TransactionEnvelope.from_xdr(signed, TESTNET_PASSPHRASE)
    assert len(tx.signatures) == 1
    assert secret not in signed


def test_public_key_from_secret_is_stellar_g_address():
    kp = Keypair.random()
    assert public_key_from_secret(kp.secret).startswith("G")


def test_require_testnet_secret_rejects_missing_public_and_short():
    with pytest.raises(ValueError):
        require_testnet_secret(None)
    with pytest.raises(ValueError):
        require_testnet_secret("G" + "A" * 55)
    with pytest.raises(ValueError):
        require_testnet_secret("Sshort")


def test_resolve_testnet_passphrase_rejects_mainnet():
    with pytest.raises(ValueError):
        resolve_testnet_passphrase(Network.PUBLIC_NETWORK_PASSPHRASE)
    assert resolve_testnet_passphrase(None) == TESTNET_PASSPHRASE


# ------------------------------------------------------------ error paths ---

@pytest.mark.parametrize(
    "message,check",
    [
        ("op_no_trust: trustline entry is missing", errs.is_trustline_error),
        ("Account not found / unfunded: tx_insufficient_balance", errs.is_insufficient_balance),
        ("tx_wrong_network: passphrase mismatch", errs.is_passphrase_mismatch),
        ("tx_bad_auth: invalid signature", errs.is_signature_error),
    ],
)
def test_explain_failure_recognizes_actionable_errors(message, check):
    assert check(message)
    explained = errs.explain_failure(RuntimeError(message))
    assert "Original:" in str(explained)
    assert message in str(explained)


def test_explain_failure_keeps_unknown_messages():
    assert "something odd" in str(errs.explain_failure("something odd"))


# ------------------------------------------------- request body / no secret ---

class _FakeResponse:
    status = 200

    def __init__(self, data):
        self._data = data

    async def __aenter__(self):
        return self

    async def __aexit__(self, *args):
        return False

    def raise_for_status(self):
        return None

    async def json(self):
        return self._data


class _FakeSession:
    def __init__(self, captured):
        self.captured = captured

    async def __aenter__(self):
        return self

    async def __aexit__(self, *args):
        return False

    def post(self, url, json=None, **kwargs):
        self.captured.append({"url": url, "json": json})
        return _FakeResponse({"hash": "s:submit_hash", "contract": "CVTESTVAULT"})


@pytest.mark.asyncio
async def test_submit_body_contains_only_signed_xdr_never_secret(monkeypatch):
    """The only payload sent to submit_treasury_tx is the signed XDR."""
    from nirium import Agent

    captured = []

    def fake_client_session(*args, **kwargs):
        return _FakeSession(captured)

    monkeypatch.setattr(aiohttp, "ClientSession", fake_client_session)

    kp = Keypair.random()  # test-only secret, never printed
    secret = kp.secret
    agent = Agent(api_url="https://example.invalid", api_key="nrm_test")

    result = await qs.sign_and_submit(agent, _unsigned_xdr(), secret, TESTNET_PASSPHRASE)

    assert len(captured) == 1
    body = captured[0]["json"]
    assert set(body.keys()) == {"xdr"}, "submit body must contain only the XDR"
    assert secret not in json.dumps(body), "the secret must never be in the request body"
    assert secret not in body["xdr"]
    tx = TransactionEnvelope.from_xdr(body["xdr"], TESTNET_PASSPHRASE)
    assert len(tx.signatures) == 1
    assert result["hash"] == "s:submit_hash"


# ------------------------------------------------------------- full flow ---

class _MockAgent:
    """In-memory Agent stand-in: no network, records every call."""

    def __init__(self):
        self.calls = []

    async def get_treasury_info(self):
        self.calls.append(("get_treasury_info",))
        return {"network": "testnet", "signing": "client-signs-every-tx"}

    async def deploy_treasury_vault(self, **kwargs):
        self.calls.append(("deploy_treasury_vault", kwargs))
        return {"xdr": _unsigned_xdr()}

    async def deposit_to_treasury_vault(self, **kwargs):
        self.calls.append(("deposit_to_treasury_vault", kwargs))
        return {"xdr": _unsigned_xdr()}

    async def withdraw_from_treasury_vault(self, **kwargs):
        self.calls.append(("withdraw_from_treasury_vault", kwargs))
        return {"xdr": _unsigned_xdr()}

    async def get_treasury_vault(self, vault_id, holder=None):
        self.calls.append(("get_treasury_vault", vault_id, holder))
        return {"vault": vault_id, "totalManagedFunds": []}

    async def submit_treasury_tx(self, xdr):
        n = len([c for c in self.calls if c[0] == "submit_treasury_tx"]) + 1
        self.calls.append(("submit_treasury_tx", xdr))
        return {"hash": f"s:hash_{n}", "contract": "CVTESTVAULT"}


@pytest.mark.asyncio
async def test_full_flow_deploys_deposits_reads_and_withdraws():
    agent = _MockAgent()
    kp = Keypair.random()  # test-only secret

    result = await qs.run(
        agent,
        kp.secret,
        asset_id="CUSDC",
        strategy_id="CSTRAT",
        deposit_amount="10000000",
    )

    names = [c[0] for c in agent.calls]
    assert names == [
        "get_treasury_info",
        "deploy_treasury_vault",
        "submit_treasury_tx",
        "deposit_to_treasury_vault",
        "submit_treasury_tx",
        "get_treasury_vault",
        "withdraw_from_treasury_vault",
        "submit_treasury_tx",
    ]
    assert set(result["tx_hashes"]) == {"deploy", "deposit", "withdraw"}
    assert all(link.startswith("https://stellar.expert/explorer/testnet/tx/")
               for link in result["explorers"].values())

    # Every submitted XDR is signed; none is an unchanged unsigned XDR.
    submitted = [c[1] for c in agent.calls if c[0] == "submit_treasury_tx"]
    assert len(submitted) == 3
    for xdr in submitted:
        assert kp.secret not in xdr
        assert len(TransactionEnvelope.from_xdr(xdr, TESTNET_PASSPHRASE).signatures) == 1
