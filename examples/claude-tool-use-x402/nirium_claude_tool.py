
"""Claude tool wrapper for Nirium x402 payments."""

from __future__ import annotations

import json
import os
from typing import Any, Optional

from nirium import Agent, X402SpendCapError, X402NetworkMismatchError

_nirium_agent: Optional[Agent] = None
_max_amount = "$1"


def initialize_nirium_x402(
    secret_key: str,
    network: str = "stellar:testnet",
    max_amount_per_payment: str = "$1",
) -> None:
    """Initialize the local payer. The secret is never exposed to Claude."""
    global _nirium_agent, _max_amount

    if network != "stellar:testnet":
        raise ValueError("This example supports stellar:testnet only.")

    _nirium_agent = Agent(
    api_url=os.getenv("NIRIUM_API_URL", "https://nirium-agent.fly.dev")
)
    _nirium_agent.init_x402(
        secret_key,
        network=network,
        max_amount_per_payment=max_amount_per_payment,
    )
    _max_amount = max_amount_per_payment


async def nirium_x402_fetch(url: str, method: str = "GET") -> str:
    """Execute a paid request and return a safe result for Claude."""

    if _nirium_agent is None:
        return json.dumps({
            "status": "error",
            "message": "Nirium x402 client is not initialized.",
        })

    try:
        response = await _nirium_agent.x402_fetch(url, method=method)

        settlement = getattr(_nirium_agent, "last_x402_settlement", None)
        tx_hash = _extract_tx(settlement)

        return json.dumps({
            "status": "success",
            "response": response,
            "transaction_hash": tx_hash,
            "network": "stellar:testnet",
        }, default=str)

    except X402SpendCapError as exc:
        return json.dumps({
            "status": "refused",
            "error": "X402SpendCapError",
            "signed": False,
            "message": (
                f"Payment refused before signing. Requested amount: "
                f"{exc.amount} stroops; cap: {_max_amount}. "
                "Nothing was signed or sent."
            ),
        })

    except X402NetworkMismatchError:
        return json.dumps({
            "status": "refused",
            "error": "X402NetworkMismatchError",
            "signed": False,
            "message": "The payment network does not match stellar:testnet.",
        })

    except Exception as exc:
        return json.dumps({
            "status": "error",
            "error": type(exc).__name__,
            "message": "The payment request failed. No success is reported.",
        })


def _extract_tx(value: Any) -> Optional[str]:
    if not isinstance(value, dict):
        return None

    for key in ("transaction", "txHash", "tx_hash", "hash", "transactionHash"):
        item = value.get(key)
        if isinstance(item, str):
            return item
        if isinstance(item, dict):
            found = _extract_tx(item)
            if found:
                return found

    for key in ("settleResponse", "settlement", "receipt", "payload"):
        found = _extract_tx(value.get(key))
        if found:
            return found

    return None
