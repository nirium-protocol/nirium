"""Nirium — autonomous treasury and agentic-payments infrastructure for Stellar, x402 (MPP experimental), Python client."""

from typing import TYPE_CHECKING

from .client import (  # type: ignore
    Agent,
    WebSocketMaxRetriesExceeded,
    WebSocketStatus,
    X402NetworkMismatchError,
    X402SpendCapError,
    X402PolicyError,
    X402PolicyContext,
    X402PolicyDecision,
)
from .receipts import receipt_cid

if TYPE_CHECKING:
    from .langchain_tools import NiriumX402Tool, create_nirium_x402_tool

__version__ = "0.12.9"
__all__ = [
    "Agent",
    "WebSocketMaxRetriesExceeded",
    "WebSocketStatus",
    "X402NetworkMismatchError",
    "X402SpendCapError",
    "X402PolicyError",
    "X402PolicyContext",
    "X402PolicyDecision",
    "receipt_cid",
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
