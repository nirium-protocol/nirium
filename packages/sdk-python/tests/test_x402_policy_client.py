"""Client-level wiring of the x402 policy hook.

These tests never touch the network: they exercise
``Agent._x402_authorize_entries`` with fake authorization entries and a
monkeypatched ``authorize_entry``, which is the exact step that signs.
"""

from __future__ import annotations

import time

import pytest

pytest.importorskip("stellar_sdk")

import nirium.client as client_mod  # noqa: E402
from nirium.x402_policy import X402PolicyError  # noqa: E402

ACCEPTED = {
    "scheme": "exact",
    "network": "stellar:testnet",
    "asset": "C" + "C" * 55,
    "payTo": "G" + "B" * 55,
    "amount": "250",
    "maxTimeoutSeconds": 300,
}


class FakeEntry:
    def __init__(self, name: str):
        self.name = name

    def to_xdr(self) -> bytes:
        return ("entry:" + self.name).encode()


class FakeKeypair:
    public_key = "G" + "A" * 55


def make_agent(policy=None):
    agent = client_mod.Agent.__new__(client_mod.Agent)
    agent._x402_keypair = FakeKeypair()
    agent._x402_passphrase = "Test SDF Network ; September 2015"
    agent._x402_policy = policy
    agent._x402_policy_require_expires = getattr(policy, "require_expires_at", None)
    agent._x402_pending_url = "https://api.example.com/paid/quote"
    return agent


class SignerSpy:
    def __init__(self):
        self.seen = []

    def __call__(self, entry, keypair, max_ledger, passphrase):
        self.seen.append(entry.name)
        return "signed:" + entry.name


class AllowAll:
    def __init__(self, verdict="ALLOW"):
        self.verdict = verdict

    def evaluate(self, ctx):
        return {
            "decision": self.verdict,
            "contextHash": ctx.context_hash,
            "expiresAt": int(time.time() * 1000) + 60_000,
        }


def test_without_a_policy_every_entry_is_signed_like_before(monkeypatch):
    spy = SignerSpy()
    monkeypatch.setattr(client_mod, "authorize_entry", spy)
    out = make_agent()._x402_authorize_entries([FakeEntry("a"), FakeEntry("b")], ACCEPTED, 123)
    assert out == ["signed:a", "signed:b"]
    assert spy.seen == ["a", "b"]


def test_allow_policy_signs_each_entry_exactly_once(monkeypatch):
    spy = SignerSpy()
    monkeypatch.setattr(client_mod, "authorize_entry", spy)
    agent = make_agent(AllowAll())
    out = agent._x402_authorize_entries([FakeEntry("a")], ACCEPTED, 123)
    assert out == ["signed:a"]
    assert spy.seen == ["a"]


def test_deny_policy_never_reaches_the_signer(monkeypatch):
    spy = SignerSpy()
    monkeypatch.setattr(client_mod, "authorize_entry", spy)
    agent = make_agent(AllowAll("DENY"))
    with pytest.raises(X402PolicyError) as excinfo:
        agent._x402_authorize_entries([FakeEntry("a")], ACCEPTED, 123)
    assert excinfo.value.outcome == "DENY"
    assert spy.seen == []


def test_policy_context_carries_the_payment_details(monkeypatch):
    seen = []

    class Spy:
        require_expires_at = False

        def evaluate(self, ctx):
            seen.append(ctx)
            return {
                "decision": "ALLOW",
                "contextHash": ctx.context_hash,
                "expiresAt": int(time.time() * 1000) + 60_000,
            }

    monkeypatch.setattr(client_mod, "authorize_entry", SignerSpy())
    make_agent(Spy())._x402_authorize_entries([FakeEntry("a")], ACCEPTED, 123)
    ctx = seen[0]
    assert ctx.payee == ACCEPTED["payTo"]
    assert ctx.amount == ACCEPTED["amount"]
    assert ctx.network == "stellar:testnet"
    assert ctx.resource == "https://api.example.com/paid/quote"
    assert ctx.authorization["payloadType"] == "soroban-authorization-entry"


def test_init_x402_rejects_a_non_callable_policy():
    keypair = client_mod.Keypair.random()
    agent = client_mod.Agent.__new__(client_mod.Agent)
    with pytest.raises(ValueError):
        agent.init_x402(keypair.secret, policy=object())
