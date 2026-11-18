"""Pre-sign policy gate for x402 payments.

Python parity with ``packages/sdk/src/x402-policy.ts``: a decision engine
(``ALLOW`` / ``DENY`` / ``WAIT``) runs **before** the Stellar authorization
entry is signed and can refuse it without ever touching the signer.

The guarantees, in the same order the TypeScript hook applies them:

1. ``DENY`` and ``WAIT`` never reach the signer.
2. An ``ALLOW`` is bound to the exact authorization it approved: the
   decision must echo the ``context_hash`` it was given (``UNBOUND``
   otherwise), so an answer cached for a different payment cannot sign.
3. ``expires_at`` is enforced: a decision that is already expired at
   signing time is refused (``EXPIRED``), and equality counts as expired.
4. Malformed answers (``None``, unknown verdict, non-numeric ``expires_at``,
   missing ``policy_version`` when a version is expected) are refused
   (``MALFORMED``) instead of being coerced.
5. A hard deadline covers ``evaluate`` *and* the freshness check (``TIMEOUT``).
6. The policy version is re-read after the ``ALLOW`` and right before
   signing; a mismatch (``STALE``), a failure to read it
   (``VERSION_UNAVAILABLE``) or an empty value also refuses.

This module is standard library only on purpose: the policy engine must be
importable (and testable) without ``stellar-sdk`` installed.
"""

from __future__ import annotations

import asyncio
import concurrent.futures
import hashlib
import inspect
import time
from dataclasses import dataclass, field
from typing import Any, Callable, Dict, List, Mapping, Optional, Sequence

CONTEXT_VERSION = 1
DEFAULT_TIMEOUT_MS = 5000

VERDICTS = ("ALLOW", "DENY", "WAIT")

ALLOWED = "ALLOWED"
SIGNED = "SIGNED"
SIGNER_ERROR = "SIGNER_ERROR"
DENY = "DENY"
WAIT = "WAIT"
TIMEOUT = "TIMEOUT"
EXPIRED = "EXPIRED"
UNBOUND = "UNBOUND"
MALFORMED = "MALFORMED"
STALE = "STALE"
VERSION_UNAVAILABLE = "VERSION_UNAVAILABLE"

OUTCOMES = (
    ALLOWED,
    SIGNED,
    SIGNER_ERROR,
    DENY,
    WAIT,
    TIMEOUT,
    EXPIRED,
    UNBOUND,
    MALFORMED,
    STALE,
    VERSION_UNAVAILABLE,
)


class X402PolicyError(RuntimeError):
    """Raised when the policy refuses to sign.

    ``outcome`` is one of :data:`OUTCOMES` and is stable enough to assert on.
    """

    def __init__(self, outcome: str, message: str = "", records: Optional[Sequence[str]] = None):
        super().__init__(message or f"x402 policy refused the authorization: {outcome}")
        self.outcome = outcome
        self.records = list(records or [])


def context_hash(url: str, method: str, payload_hash: str) -> str:
    """Hash an authorization context the same way the TypeScript hook does."""

    raw = "{}|{}|{}".format(url, (method or "GET").upper(), payload_hash)
    return hashlib.sha256(raw.encode("utf-8")).hexdigest()


@dataclass(frozen=True)
class PolicyContext:
    """What the policy is asked to approve. Mirrors ``X402PolicyContext``."""

    url: str
    method: str
    requirements: Mapping[str, Any]
    authorization: Mapping[str, Any]
    signer: str
    context_hash: str
    context_version: int = CONTEXT_VERSION

    @property
    def amount(self) -> Any:
        return self.requirements.get("amount")

    @property
    def asset(self) -> Any:
        return self.requirements.get("asset")

    @property
    def payee(self) -> Any:
        return self.requirements.get("payTo")

    @property
    def network(self) -> Any:
        return self.requirements.get("network")

    @property
    def resource(self) -> str:
        return self.url

    def as_dict(self) -> Dict[str, Any]:
        """Plain mapping, for callables that prefer dictionaries."""

        return {
            "contextVersion": self.context_version,
            "url": self.url,
            "method": self.method,
            "requirements": dict(self.requirements),
            "authorization": dict(self.authorization),
            "signer": self.signer,
            "contextHash": self.context_hash,
            "amount": self.amount,
            "asset": self.asset,
            "payee": self.payee,
            "network": self.network,
        }


@dataclass
class PolicyDecision:
    """What the policy answered. Mirrors ``X402PolicyDecision``."""

    decision: str
    context_hash: Optional[str] = None
    reason: str = ""
    policy_version: Optional[str] = None
    expires_at: Optional[int] = None
    decision_id: Optional[str] = None

    @classmethod
    def from_raw(cls, raw: Any) -> "PolicyDecision":
        if isinstance(raw, cls):
            return raw
        if isinstance(raw, str):
            return cls(decision=raw)
        if not isinstance(raw, Mapping):
            raise X402PolicyError(MALFORMED, f"policy answered {type(raw).__name__}, expected a decision")
        verdict = raw.get("decision", raw.get("verdict"))
        if not isinstance(verdict, str):
            raise X402PolicyError(MALFORMED, "policy decision has no string `decision`")
        expires_at = raw.get("expiresAt", raw.get("expires_at"))
        if expires_at is not None and not isinstance(expires_at, (int, float)):
            raise X402PolicyError(MALFORMED, "policy decision has a non-numeric `expiresAt`")
        version = raw.get("policyVersion", raw.get("policy_version"))
        return cls(
            decision=verdict,
            context_hash=raw.get("contextHash", raw.get("context_hash")),
            reason=str(raw.get("reason") or ""),
            policy_version=None if version is None else str(version),
            expires_at=None if expires_at is None else int(expires_at),
            decision_id=raw.get("decisionId", raw.get("decision_id")),
        )


@dataclass
class PolicyResult:
    """Successful gate: the signed artifact plus the audit trail."""

    value: Any
    records: List[str] = field(default_factory=list)
    decision: Optional[PolicyDecision] = None


def build_context(
    *,
    url: str,
    method: str,
    requirements: Mapping[str, Any],
    authorization: Mapping[str, Any],
    signer: str,
) -> PolicyContext:
    """Build a context whose hash binds url + method + the signed payload."""

    payload_hash = str(authorization.get("payloadHash") or authorization.get("payload_hash") or "")
    if not payload_hash:
        raise X402PolicyError(MALFORMED, "authorization without payloadHash cannot be bound")
    return PolicyContext(
        url=url or "",
        method=(method or "GET").upper(),
        requirements=dict(requirements),
        authorization=dict(authorization),
        signer=signer or "",
        context_hash=context_hash(url or "", method or "GET", payload_hash),
    )


def _supports(policy: Any, name: str) -> bool:
    if isinstance(policy, Mapping):
        return name in policy
    return callable(getattr(policy, name, None))


def _member(policy: Any, name: str) -> Any:
    if isinstance(policy, Mapping):
        return policy.get(name)
    return getattr(policy, name, None)


def _resolve(value: Any) -> Any:
    """Run an awaitable to completion so sync callers see a plain value."""

    if inspect.isawaitable(value):
        return asyncio.run(value)
    return value


def _call_with_deadline(fn: Callable[[], Any], deadline: float) -> Any:
    remaining = deadline - time.monotonic()
    if remaining <= 0:
        raise X402PolicyError(TIMEOUT, "policy deadline expired before the answer arrived")
    pool = concurrent.futures.ThreadPoolExecutor(max_workers=1)
    try:
        future = pool.submit(fn)
        try:
            return future.result(timeout=remaining)
        except concurrent.futures.TimeoutError:
            raise X402PolicyError(TIMEOUT, "policy answer arrived after the deadline") from None
    finally:
        # Never block the gate on a policy that is still sleeping: the answer is
        # already useless once the deadline passed.
        pool.shutdown(wait=False)


def timeout_ms_of(policy: Any, default: Optional[int] = None) -> int:
    """Hook timeout, in milliseconds (``timeout`` on the TS side)."""

    for name in ("timeout_ms", "timeoutMs", "timeout"):
        value = _member(policy, name)
        if isinstance(value, (int, float)) and value > 0:
            return int(value)
    return int(default or DEFAULT_TIMEOUT_MS)


def run_policy_gate(
    policy: Any,
    ctx: PolicyContext,
    sign: Callable[[], Any],
    *,
    default_timeout_ms: Optional[int] = None,
    require_expires_at: Optional[bool] = None,
    now_ms: Optional[int] = None,
) -> PolicyResult:
    """Run the policy and sign **only** with a valid, fresh ``ALLOW``.

    ``policy`` may be an object with ``evaluate(ctx)`` (plus the optional
    ``current_version`` / ``on_decision`` / ``timeout_ms`` /
    ``require_expires_at`` members, as in the TypeScript SDK) or a plain
    callable that receives the context and returns ``ALLOW``, ``DENY`` or
    ``WAIT``.
    """

    if policy is None:
        raise X402PolicyError(MALFORMED, "run_policy_gate called without a policy")
    structured = _supports(policy, "evaluate")
    evaluate = _member(policy, "evaluate") if structured else policy
    if not callable(evaluate):
        raise X402PolicyError(MALFORMED, "policy has no callable evaluate")

    records: List[str] = []
    deadline = time.monotonic() + timeout_ms_of(policy, default_timeout_ms) / 1000.0
    require_exp = (
        bool(require_expires_at)
        if require_expires_at is not None
        else bool(_member(policy, "require_expires_at") or _member(policy, "requireExpiresAt"))
    )

    raw = _call_with_deadline(lambda: _resolve(evaluate(ctx)), deadline)
    decision = PolicyDecision.from_raw(raw)
    verdict = decision.decision.strip()
    if verdict not in VERDICTS:
        raise X402PolicyError(MALFORMED, f"unknown policy verdict {decision.decision!r}", records)

    if verdict == DENY:
        raise X402PolicyError(DENY, decision.reason or "policy denied the payment", records)
    if verdict == WAIT:
        raise X402PolicyError(WAIT, decision.reason or "policy asked to wait", records)

    records.append(ALLOWED)

    observer = _member(policy, "on_decision") or _member(policy, "onDecision")
    if callable(observer):
        try:
            observer(decision, list(records))
        except Exception:  # an observer must never break the gate
            pass

    # A structured hook must echo the hash it approved. A plain callable was
    # handed the context itself, so its ALLOW is already bound to it.
    if structured and (not decision.context_hash or str(decision.context_hash) != ctx.context_hash):
        raise X402PolicyError(UNBOUND, "ALLOW is not bound to this authorization", records)

    version_reader = _member(policy, "current_version") or _member(policy, "currentVersion")
    if callable(version_reader):
        if not decision.policy_version:
            raise X402PolicyError(
                MALFORMED, "ALLOW must carry policyVersion when a version is expected", records
            )
        try:
            current = _call_with_deadline(lambda: _resolve(version_reader(ctx)), deadline)
        except X402PolicyError:
            raise
        except Exception as exc:
            raise X402PolicyError(
                VERSION_UNAVAILABLE, f"policy version unreadable: {exc}", records
            ) from None
        if current is None or str(current) == "":
            raise X402PolicyError(VERSION_UNAVAILABLE, "policy version is empty", records)
        if str(current) != str(decision.policy_version):
            raise X402PolicyError(STALE, "policy version changed before signing", records)

    now = int(time.time() * 1000) if now_ms is None else int(now_ms)
    if decision.expires_at is not None and decision.expires_at <= now:
        raise X402PolicyError(EXPIRED, "ALLOW expired before signing", records)
    if require_exp and decision.expires_at is None:
        raise X402PolicyError(MALFORMED, "ALLOW without expiresAt is not signable", records)

    try:
        value = _call_with_deadline(lambda: _resolve(sign()), deadline)
    except X402PolicyError:
        raise
    except Exception as exc:
        records.append(SIGNER_ERROR)
        raise X402PolicyError(SIGNER_ERROR, f"signer failed: {exc}", records) from exc

    records.append(SIGNED)
    return PolicyResult(value=value, records=records, decision=decision)
