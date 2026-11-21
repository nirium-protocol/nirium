"""Tests that API request bodies contain only signed XDR, never the secret.

Companion to ``sign_test.py`` for issue #357's "Done when": the secret key never
leaves the machine. The real Nirium ``Agent`` is used as the HTTP client, but
``aiohttp.ClientSession`` is replaced so every request body can be inspected
without any network access.
"""

from __future__ import annotations

import asyncio
import os
import sys
from unittest.mock import patch

HERE = os.path.dirname(__file__)
QUICKSTART = os.path.abspath(os.path.join(HERE, ".."))
REPO_ROOT = os.path.abspath(os.path.join(QUICKSTART, "..", ".."))
# The SDK is consumed as a local package here so the test needs no pip install.
sys.path.insert(0, os.path.join(REPO_ROOT, "packages", "sdk-python", "src"))
sys.path.insert(0, QUICKSTART)

from stellar_sdk import Account, Asset, Keypair, TransactionBuilder, TransactionEnvelope

import nirium.client as nirium_client
from nirium import Agent

from src.flow import build_deploy, build_deposit, build_withdraw, sign_and_submit
from src.sign import TESTNET_PASSPHRASE

_captured: dict = {"bodies": [], "responses": []}


class _Response:
    """Minimal aiohttp response stand-in."""

    def __init__(self, payload: dict) -> None:
        self._payload = payload

    async def __aenter__(self):
        return self

    async def __aexit__(self, *args):
        return False

    def raise_for_status(self) -> None:
        pass

    async def json(self) -> dict:
        return self._payload


class _Session:
    """Minimal aiohttp.ClientSession stand-in that records request bodies."""

    def __init__(self, *args, **kwargs) -> None:
        pass

    async def __aenter__(self):
        return self

    async def __aexit__(self, *args):
        return False

    def post(self, url, json=None, **kwargs):
        _captured["bodies"].append(json)
        return _Response(_captured["responses"].pop(0))

    def get(self, url, **kwargs):
        return _Response(_captured["responses"].pop(0))


def _unsigned_xdr(secret: str) -> str:
    """Build a real, valid unsigned testnet XDR without any network."""
    keypair = Keypair.from_secret(secret)
    tx = (
        TransactionBuilder(
            source_account=Account(keypair.public_key, 0),
            network_passphrase=TESTNET_PASSPHRASE,
            base_fee=100,
        )
        .append_payment_op(
            destination=keypair.public_key,
            asset=Asset.native(),
            amount="1",
        )
        .set_timeout(30)
        .build()
    )
    return tx.to_xdr()


async def _exercise_flow(secret: str):
    """Run deploy/deposit/withdraw build+sign+submit through a mocked HTTP layer."""
    xdr = _unsigned_xdr(secret)
    # Three build responses (unsigned XDR) and three submit responses (hash).
    _captured["responses"] = [
        {"xdr": xdr}, {"hash": "deploy-hash"},
        {"xdr": xdr}, {"hash": "deposit-hash"},
        {"xdr": xdr}, {"hash": "withdraw-hash"},
    ]
    _captured["bodies"] = []

    agent = Agent(api_url="http://nirium.test", api_key="test-public-key")
    with patch.object(nirium_client.aiohttp, "ClientSession", _Session):
        deploy = await build_deploy(
            agent, manager="GMANAGER", caller="GCALLER",
            asset="CASSET", strategy="CSTRATEGY", name="n", symbol="S",
        )
        await sign_and_submit(agent, deploy, secret, TESTNET_PASSPHRASE)

        deposit = await build_deposit(
            agent, vault="VAULT", caller="GCALLER", amounts=["100"], invest=False,
        )
        await sign_and_submit(agent, deposit, secret, TESTNET_PASSPHRASE)

        withdraw = await build_withdraw(agent, vault="VAULT", caller="GCALLER")
        await sign_and_submit(agent, withdraw, secret, TESTNET_PASSPHRASE)

    return _captured["bodies"]


def test_request_bodies_never_contain_secret():
    secret = Keypair.random().secret
    bodies = asyncio.run(_exercise_flow(secret))

    assert len(bodies) == 6, "expected 3 build + 3 submit bodies"

    # 1) The S... secret must not appear anywhere in any request body.
    for body in bodies:
        assert secret not in str(body), "secret leaked into an API request body"

    # 2) A submit body contains ONLY the signed XDR: no secret field, nothing else.
    for body in bodies[1::2]:
        assert set(body.keys()) == {"xdr"}, body
        signed = body["xdr"]
        assert secret not in signed
        envelope = TransactionEnvelope.from_xdr(signed, TESTNET_PASSPHRASE)
        assert len(envelope.signatures) == 1

    # 3) No body carries a field that could hold a secret.
    secret_fields = {"secret", "secretKey", "secret_key", "seed", "privateKey", "private_key"}
    for body in bodies:
        assert not (secret_fields & set(body.keys())), body
