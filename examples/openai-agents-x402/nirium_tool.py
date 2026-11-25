"""OpenAI Agents SDK @function_tool wrapper for Nirium x402 payments.

Wraps the Nirium Python SDK's x402_fetch with a per-payment spend cap.
The Stellar secret is used only to initialize Agent.init_x402 and is never
stored in the tool schema or exposed to the LLM.

Uses the OpenAI Agents SDK (@function_tool decorator) to integrate with
the Agents SDK Agent and Runner.
"""

from __future__ import annotations

import json
from typing import Any, Optional

from agents import function_tool

from nirium import Agent, X402SpendCapError, X402NetworkMismatchError


# Global agent instance for the tool
_nirium_agent: Optional[Agent] = None
_max_amount: str = "$1"


def initialize_nirium_x402(
    secret_key: str,
    network: str = "stellar:testnet",
    max_amount_per_payment: str = "$1",
    api_url: str = "https://nirium-agent.fly.dev",
) -> None:
    """Initialize the Nirium x402 client with spending limits.
    
    Args:
        secret_key: Stellar secret key (S...) for signing payments
        network: Stellar network (testnet or pubnet)
        max_amount_per_payment: Maximum USD amount per payment (e.g. "$1")
        api_url: Nirium API URL
    """
    global _nirium_agent, _max_amount
    _nirium_agent = Agent(api_url=api_url)
    _nirium_agent.init_x402(
        secret_key,
        network=network,
        max_amount_per_payment=max_amount_per_payment,
    )
    _max_amount = max_amount_per_payment


@function_tool
async def nirium_x402_fetch(url: str, method: str = "GET") -> str:
    """Call an HTTP endpoint protected by Nirium x402 payment on Stellar testnet.
    
    This tool completes the HTTP 402 payment flow and returns the response body.
    Payments above the configured cap are refused before signing.
    
    Args:
        url: Absolute HTTP URL of the x402-protected resource
        method: HTTP method (GET, POST, etc.)
    
    Returns:
        The protected response body as a string
    """
    if _nirium_agent is None:
        return json.dumps({
            "error": "Nirium x402 client not initialized. Call initialize_nirium_x402 first."
        })
    
    try:
        result = await _nirium_agent.x402_fetch(url, method=method)
        
        # Include settlement transaction hash in the result
        settlement = getattr(_nirium_agent, "last_x402_settlement", None)
        if settlement:
            tx_hash = _extract_settlement_tx(settlement)
            if tx_hash:
                if isinstance(result, dict):
                    result["_x402_settlement_tx"] = tx_hash
                    return json.dumps(result, default=str)
                else:
                    return f"{result}\n\nx402_settlement_tx: {tx_hash}"
        
        return json.dumps(result, default=str) if isinstance(result, dict) else str(result)
    
    except X402SpendCapError as e:
        error_msg = (
            f"Payment refused: The requested payment exceeds the per-payment cap of {_max_amount}. "
            f"The server requested {e.amount} stroops of {e.asset}. "
            f"Nothing was signed or sent. To allow larger payments, raise the cap with "
            f"initialize_nirium_x402(max_amount_per_payment='...')."
        )
        return json.dumps({
            "error": "X402SpendCapError",
            "message": error_msg,
            "details": {
                "url": e.url,
                "amount": e.amount,
                "asset": e.asset,
                "network": e.network,
                "cap": e.cap,
            }
        })
    
    except X402NetworkMismatchError as e:
        return json.dumps({
            "error": "X402NetworkMismatchError",
            "message": f"Network mismatch: configured for {e.network} but server offered {', '.join(e.offered)}",
            "url": e.url,
        })
    
    except Exception as e:
        return json.dumps({
            "error": type(e).__name__,
            "message": str(e),
        })


def _extract_settlement_tx(settlement: Optional[dict[str, Any]]) -> Optional[str]:
    """Extract transaction hash from settlement payload."""
    if not settlement:
        return None
    for key in ("transaction", "txHash", "tx_hash", "hash", "transactionHash"):
        value = settlement.get(key)
        if isinstance(value, str) and value:
            return value
        if isinstance(value, dict):
            nested = _extract_settlement_tx(value)
            if nested:
                return nested
    for key in ("settleResponse", "settlement", "receipt", "payload"):
        nested = settlement.get(key)
        if isinstance(nested, dict):
            found = _extract_settlement_tx(nested)
            if found:
                return found
    return None
