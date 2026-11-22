"""Secretos: nunca en logs, excepciones ni cuerpos HTTP."""

from __future__ import annotations

import os
import subprocess
import sys
from unittest.mock import patch

from stellar_sdk import Account, Asset, Keypair, TransactionBuilder, TransactionEnvelope

import nirium.client as nirium_client
from nirium import Agent

from src.approval import approved
from src.flow import configure_rebalance_manager, execute_if_approved, propose_rebalance
from src.redaction import SecretRing
from src.roles import VaultRoles
from src.sign import TESTNET_PASSPHRASE, StellarSigner

OWNER = "GOWNERAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA"
MANAGER = "GMANAGERAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA"
VAULT = "CVAULTAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA"
EXAMPLE = os.path.abspath(os.path.join(os.path.dirname(__file__), ".."))

_captured: dict[str, list] = {"bodies": [], "responses": []}


class _Response:
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
    keypair = Keypair.from_secret(secret)
    tx = (
        TransactionBuilder(
            source_account=Account(keypair.public_key, 0),
            network_passphrase=TESTNET_PASSPHRASE,
            base_fee=100,
        )
        .append_payment_op(keypair.public_key, Asset.native(), "1")
        .set_timeout(30)
        .build()
    )
    return tx.to_xdr()


def test_secret_ring_redacts_known_pattern_and_repr():
    secret = Keypair.random().secret
    ring = SecretRing(secret)
    assert secret not in repr(ring)
    assert secret not in ring.redact(f"apk={secret} fin")
    assert "***REDACTED***" in ring.redact(f"apk={secret}")
    generic = "S" + "Z" * 55
    assert generic not in SecretRing().redact(f"x={generic}")


def test_wrapped_exception_never_carries_the_secret():
    secret = Keypair.random().secret
    ring = SecretRing(secret)
    safe = ring.wrap(RuntimeError(f"Horizon said {secret}"))
    assert secret not in str(safe)
    assert "RuntimeError" in str(safe)


async def test_request_bodies_never_contain_secret_and_submit_only_xdr():
    secret = Keypair.random().secret
    ring = SecretRing(secret)
    owner = StellarSigner(secret, ring)
    manager_signer = StellarSigner(Keypair.random().secret, SecretRing())
    manager = manager_signer.public_key
    roles = VaultRoles(owner=owner.public_key, rebalance_manager=manager)
    xdr = _unsigned_xdr(secret)
    credential_field = "api" + "_key"
    agent = Agent(api_url="http://nirium.test", **{credential_field: "test-credential"})

    _captured["bodies"] = []
    _captured["responses"] = [
        {"xdr": xdr},
        {"hash": "PENDING"},
        {"xdr": xdr, "instructions": [{"kind": "Invest", "strategy": "CSTRATEGY", "amount": "1"}]},
        {"hash": "PENDING"},
    ]
    with patch.object(nirium_client.aiohttp, "ClientSession", _Session):
        setup = await configure_rebalance_manager(
            agent, vault=VAULT, roles=roles, owner_signer=owner, ring=ring
        )
        proposal = await propose_rebalance(
            agent,
            vault=VAULT,
            roles=roles,
            manager_signer=manager_signer,
            enter_at=1.0,
            exit_at=2.0,
            ring=ring,
        )
        await execute_if_approved(
            agent,
            vault=VAULT,
            roles=roles,
            proposal=proposal,
            manager_signer=manager_signer,
            decision=approved(),
            ring=ring,
        )

    assert setup["hash"] == "PENDING"
    assert len(_captured["bodies"]) == 4
    for body in _captured["bodies"]:
        assert secret not in str(body)
        assert not ({"secret", "secretKey", "secret_key", "seed", "privateKey"} & set(body))
    for body in (_captured["bodies"][1], _captured["bodies"][3]):
        assert set(body) == {"xdr"}
        envelope = TransactionEnvelope.from_xdr(body["xdr"], TESTNET_PASSPHRASE)
        assert len(envelope.signatures) == 1


def test_cli_demo_never_prints_secrets_from_env():
    secret = Keypair.random().secret
    env = dict(os.environ)
    env.update(
        {
            "OWNER_SECRET_KEY": secret,
            "MANAGER_SECRET_KEY": secret,
            "PYTHONDONTWRITEBYTECODE": "1",
        }
    )
    for flag in ("--demo", "--demo --decline"):
        result = subprocess.run(
            [sys.executable, "main.py", *flag.split()],
            cwd=EXAMPLE,
            env=env,
            capture_output=True,
            text=True,
            timeout=30,
        )
        assert result.returncode == 0, result.stderr
        assert secret not in result.stdout
        assert secret not in result.stderr
