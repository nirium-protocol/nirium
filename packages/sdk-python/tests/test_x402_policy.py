"""Conformance tests for the Python pre-sign policy hook.

Mirrors ``packages/sdk/src/x402-policy-conformance.ts``: every case asserts
that the signer is **not** called when the policy refuses, which is the whole
point of the gate.
"""

from __future__ import annotations

import time

import pytest

from nirium.x402_policy import (
    ALLOWED,
    DENY,
    EXPIRED,
    MALFORMED,
    SIGNED,
    SIGNER_ERROR,
    STALE,
    TIMEOUT,
    UNBOUND,
    VERSION_UNAVAILABLE,
    WAIT,
    PolicyDecision,
    X402PolicyError,
    build_context,
    run_policy_gate,
)

URL = "https://api.example.com/paid/quote"
METHOD = "POST"
PAYLOAD = "0f" * 32
SIGNER_KEY = "G" + "A" * 55


def context(**overrides):
    authorization = {
        "payloadHash": PAYLOAD,
        "from": SIGNER_KEY,
        "to": "G" + "B" * 55,
        "amount": 250,
        "nonce": 7,
    }
    authorization.update(overrides)
    return build_context(
        url=URL,
        method=METHOD,
        requirements={
            "scheme": "exact",
            "network": "stellar:testnet",
            "asset": "C" + "C" * 55,
            "payTo": "G" + "B" * 55,
            "amount": 250,
            "maxTimeoutSeconds": 300,
        },
        authorization=authorization,
        signer=SIGNER_KEY,
    )


class Signer:
    """Mock signer: counts calls and fails loudly if it should not run."""

    def __init__(self, result="signed-xdr", boom=None):
        self.calls = 0
        self.result = result
        self.boom = boom

    def __call__(self):
        self.calls += 1
        if self.boom:
            raise self.boom
        return self.result


class Allow:
    """Policy object shaped like the TypeScript ``X402PolicyHook``."""

    def __init__(self, echo=True, verdict="ALLOW", version=None, expires_in_ms=60_000, timeout_ms=None):
        self.echo = echo
        self.verdict = verdict
        self.version = version
        self.expires_in_ms = expires_in_ms
        self.timeout_ms = timeout_ms
        self.seen = []

    def evaluate(self, ctx):
        self.seen.append(ctx)
        return PolicyDecision(
            decision=self.verdict,
            context_hash=ctx.context_hash if self.echo else "0" * 64,
            policy_version=self.version,
            expires_at=(
                None
                if self.expires_in_ms is None
                else int(time.time() * 1000) + self.expires_in_ms
            ),
        )


def expect_refused(outcome, fn, signer):
    with pytest.raises(X402PolicyError) as excinfo:
        fn()
    assert excinfo.value.outcome == outcome, (excinfo.value.outcome, str(excinfo.value))
    assert signer.calls == 0, "the signer must never run on a refusal"
    return excinfo.value


def test_allow_with_the_exact_context_hash_signs_exactly_once():
    signer = Signer()
    policy = Allow()
    result = run_policy_gate(policy, context(), signer)
    assert signer.calls == 1
    assert result.value == "signed-xdr"
    assert result.records == [ALLOWED, SIGNED]
    assert policy.seen[0].resource == URL
    assert policy.seen[0].amount == 250


def test_context_hash_changes_with_the_payload():
    a = context()
    b = context(payloadHash="ff" * 32)
    assert a.context_hash != b.context_hash


def test_deny_signs_nothing():
    signer = Signer()
    expect_refused(DENY, lambda: run_policy_gate(Allow(verdict="DENY"), context(), signer), signer)


def test_wait_signs_nothing():
    signer = Signer()
    expect_refused(WAIT, lambda: run_policy_gate(Allow(verdict="WAIT"), context(), signer), signer)


def test_allow_with_a_wrong_context_hash_signs_nothing():
    signer = Signer()
    expect_refused(UNBOUND, lambda: run_policy_gate(Allow(echo=False), context(), signer), signer)


def test_allow_with_an_expired_expires_at_signs_nothing():
    signer = Signer()
    now = int(time.time() * 1000)

    def expired(ctx):
        return {
            "decision": "ALLOW",
            "contextHash": ctx.context_hash,
            "expiresAt": now - 1,
        }

    expect_refused(EXPIRED, lambda: run_policy_gate(expired, context(), signer, now_ms=now), signer)


def test_expires_at_equal_to_the_clock_counts_as_expired():
    signer = Signer()
    now = int(time.time() * 1000)

    def boundary(ctx):
        return {"decision": "ALLOW", "contextHash": ctx.context_hash, "expiresAt": now}

    expect_refused(EXPIRED, lambda: run_policy_gate(boundary, context(), signer, now_ms=now), signer)


@pytest.mark.parametrize(
    "answer",
    [
        None,
        "allow",  # lowercase is not a verdict
        {"decision": "ALLOW", "contextHash": "x" * 64, "expiresAt": "soon"},
        {"verdict": 3},
    ],
)
def test_malformed_answers_sign_nothing(answer):
    signer = Signer()
    expect_refused(MALFORMED, lambda: run_policy_gate(lambda ctx: answer, context(), signer), signer)


def test_an_answer_after_the_timeout_signs_nothing():
    signer = Signer()

    def slow(ctx):
        time.sleep(0.3)
        return {"decision": "ALLOW", "contextHash": ctx.context_hash}

    started = time.monotonic()
    expect_refused(
        TIMEOUT,
        lambda: run_policy_gate(slow, context(), signer, default_timeout_ms=50),
        signer,
    )
    assert time.monotonic() - started < 3


def test_stale_policy_version_signs_nothing():
    signer = Signer()

    class Stale(Allow):
        def current_version(self, ctx):
            return "v2"

    expect_refused(STALE, lambda: run_policy_gate(Stale(version="v1"), context(), signer), signer)


def test_unreadable_policy_version_signs_nothing():
    signer = Signer()

    class Broken(Allow):
        def current_version(self, ctx):
            raise RuntimeError("version store offline")

    expect_refused(
        VERSION_UNAVAILABLE,
        lambda: run_policy_gate(Broken(version="v1"), context(), signer),
        signer,
    )


def test_allow_without_policy_version_signs_nothing_when_a_version_is_expected():
    signer = Signer()

    class Versioned(Allow):
        def current_version(self, ctx):
            return "v1"

    expect_refused(
        MALFORMED,
        lambda: run_policy_gate(Versioned(version=None), context(), signer),
        signer,
    )


def test_matching_policy_version_signs():
    signer = Signer()

    class Versioned(Allow):
        def current_version(self, ctx):
            return "v1"

    result = run_policy_gate(Versioned(version="v1"), context(), signer)
    assert signer.calls == 1
    assert result.records == [ALLOWED, SIGNED]


def test_allow_without_expires_at_is_refused_when_required():
    signer = Signer()
    expect_refused(
        MALFORMED,
        lambda: run_policy_gate(Allow(expires_in_ms=None), context(), signer, require_expires_at=True),
        signer,
    )


def test_plain_callable_policy_is_supported():
    signer = Signer()
    seen = []

    def policy(ctx):
        seen.append(ctx.as_dict())
        return "ALLOW"

    result = run_policy_gate(policy, context(), signer)
    assert signer.calls == 1
    assert result.records == [ALLOWED, SIGNED]
    assert seen[0]["payee"] == "G" + "B" * 55
    assert seen[0]["network"] == "stellar:testnet"


def test_observer_sees_the_allowance_before_the_version_check():
    order = []

    class Observed(Allow):
        def on_decision(self, decision, records):
            order.append(("decision", decision.decision, tuple(records)))

        def current_version(self, ctx):
            order.append(("version",))
            return "v1"

    signer = Signer()
    run_policy_gate(Observed(version="v1"), context(), signer)
    assert order == [("decision", "ALLOW", (ALLOWED,)), ("version",)]


def test_observer_errors_never_block_a_valid_allow():
    class Noisy(Allow):
        def on_decision(self, decision, records):
            raise RuntimeError("telemetry down")

    signer = Signer()
    assert run_policy_gate(Noisy(), context(), signer).records == [ALLOWED, SIGNED]


def test_signer_failure_is_reported_as_signer_error():
    signer = Signer(boom=RuntimeError("HSM locked"))
    with pytest.raises(X402PolicyError) as excinfo:
        run_policy_gate(Allow(), context(), signer)
    assert excinfo.value.outcome == SIGNER_ERROR
    assert signer.calls == 1
    assert excinfo.value.records == [ALLOWED, SIGNER_ERROR]
