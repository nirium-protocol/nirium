"""Nirium — autonomous treasury and agentic-payments infrastructure for Stellar, x402 (MPP experimental), Python client."""

from typing import TYPE_CHECKING

from .client import (  # type: ignore
    Agent,
    WebSocketMaxRetriesExceeded,
    WebSocketStatus,
    X402NetworkMismatchError,
    X402SpendCapError,
)
from .x402_policy import (  # type: ignore
    PolicyContext,
    PolicyDecision,
    PolicyResult,
    X402PolicyError,
    run_policy_gate,
)

if TYPE_CHECKING:
    from .langchain_tools import NiriumX402Tool, create_nirium_x402_tool

__version__ = "0.12.6"
__all__ = [
    "Agent",
    "WebSocketMaxRetriesExceeded",
    "WebSocketStatus",
    "X402NetworkMismatchError",
    "X402SpendCapError",
    "X402PolicyError",
    "PolicyContext",
    "PolicyDecision",
    "PolicyResult",
    "run_policy_gate",
    "NiriumX402Tool",
    "create_nirium_x402_tool",
]


def __getattr__(name: str):
    if name in {"NiriumX402Tool", "create_nirium_x402_tool"}:
        from .langchain_tools import NiriumX402Tool, create_nirium_x402_tool

        return {
            "NiriumX402Tool": NiriumX402Tool,
            "create_nirium_x402_tool": create_nirium_x402_tool,
        }[name]
    raise AttributeError(f"module {__name__!r} has no attribute {name!r}")
