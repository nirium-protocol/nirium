"""CrewAI tool that pays x402 endpoints through the Nirium Python SDK.

Wraps ``nirium.Agent.x402_fetch()`` with ``max_amount_per_payment`` (a per-payment
spend cap). The Stellar secret is used only to call ``Agent.init_x402``: it is
never stored on the tool, never part of the schema the LLM sees, and is redacted
from anything the tool returns.

A payment above the cap is refused by the SDK *before signing*
(``X402SpendCapError``). The tool turns that into a structured result instead of
raising, so the crew keeps running and the agent can explain the refusal.
"""

from __future__ import annotations

import asyncio
import concurrent.futures
import json
import re
from typing import Any, Optional, Type
from urllib.parse import urlparse

from crewai.tools import BaseTool
from pydantic import BaseModel, Field, PrivateAttr

from nirium import Agent, X402NetworkMismatchError, X402SpendCapError

DEFAULT_API_URL = "https://nirium-agent.fly.dev"
_ALLOWED_METHODS = {"GET", "POST", "PUT", "PATCH", "DELETE", "HEAD"}
_STELLAR_SECRET_RE = re.compile(r"\bS[A-Z2-7]{55}\b")
_PAYMENT_HEADER_RE = re.compile(r"(?i)\b(PAYMENT-SIGNATURE|X-PAYMENT)\s*[:=]\s*\S+")


def redact_secrets(value: Any) -> str:
    """Strip Stellar secret seeds and payment headers from text shown to the LLM."""
    text = value if isinstance(value, str) else str(value)
    text = _STELLAR_SECRET_RE.sub("[REDACTED]", text)
    return _PAYMENT_HEADER_RE.sub(r"\1=[REDACTED]", text)


def extract_settlement_tx(settlement: Optional[dict[str, Any]]) -> Optional[str]:
    """Return the public transaction hash from an x402 settlement payload."""
    if not settlement:
        return None
    for key in ("transaction", "txHash", "tx_hash", "hash", "transactionHash"):
        value = settlement.get(key)
        if isinstance(value, str) and value:
            return value
        if isinstance(value, dict):
            nested = extract_settlement_tx(value)
            if nested:
                return nested
    for key in ("settleResponse", "settlement", "receipt", "payload"):
        nested = settlement.get(key)
        if isinstance(nested, dict):
            found = extract_settlement_tx(nested)
            if found:
                return found
    return None


def stellar_expert_tx_url(tx_hash: str, network: str = "stellar:testnet") -> str:
    net = "testnet" if network == "stellar:testnet" else "public"
    return f"https://stellar.expert/explorer/{net}/tx/{tx_hash}"


def _run_coro(coro: Any) -> Any:
    """Run a coroutine from sync code, even if an event loop is already running."""
    try:
        asyncio.get_running_loop()
    except RuntimeError:
        return asyncio.run(coro)
    with concurrent.futures.ThreadPoolExecutor(max_workers=1) as pool:
        return pool.submit(asyncio.run, coro).result()


class NiriumX402Input(BaseModel):
    """Arguments the LLM can fill in. No secret, no cap: those stay in code."""

    url: str = Field(description="Absolute http(s) URL of the x402-protected resource.")
    method: str = Field(default="GET", description="HTTP method (GET, POST, PUT, PATCH, DELETE, HEAD).")


class NiriumX402Tool(BaseTool):
    """CrewAI ``BaseTool`` around ``nirium.Agent.x402_fetch`` with a spend cap."""

    name: str = "nirium_x402_fetch"
    description: str = (
        "Fetch an HTTP resource protected by x402 and pay for it in testnet USDC on "
        "Stellar through Nirium. Returns JSON. If the price is above the per-payment "
        "cap the payment is refused before signing and the JSON has "
        "status='refused' with the reason: report it, do not retry."
    )
    args_schema: Type[BaseModel] = NiriumX402Input

    network: str = "stellar:testnet"
    max_amount_per_payment: str = "$1"

    _client: Any = PrivateAttr(default=None)
    _history: list = PrivateAttr(default_factory=list)

    def __init__(
        self,
        secret_key: str,
        *,
        network: str = "stellar:testnet",
        max_amount_per_payment: str = "$1",
        api_url: str = DEFAULT_API_URL,
        client: Any = None,
        **kwargs: Any,
    ) -> None:
        super().__init__(network=network, max_amount_per_payment=max_amount_per_payment, **kwargs)
        nirium_client = client if client is not None else Agent(api_url=api_url)
        # The secret goes straight to the SDK and is not kept on the tool.
        nirium_client.init_x402(
            secret_key,
            network=network,
            max_amount_per_payment=max_amount_per_payment,
        )
        self._client = nirium_client

    @property
    def history(self) -> list[dict[str, Any]]:
        """Every call this tool made: url, status and tx hash (for evidence)."""
        return list(self._history)

    def _record(self, entry: dict[str, Any]) -> str:
        self._history.append(entry)
        return json.dumps(entry, default=str)

    async def _afetch(self, url: str, method: str = "GET") -> str:
        method = (method or "GET").upper()
        parsed = urlparse(url)
        if parsed.scheme not in {"http", "https"} or not parsed.netloc:
            return self._record({"status": "error", "url": url, "error": "url must be an absolute http(s) URL"})
        if method not in _ALLOWED_METHODS:
            return self._record({"status": "error", "url": url, "error": f"unsupported method {method}"})

        try:
            data = await self._client.x402_fetch(url, method=method)
        except X402SpendCapError as e:
            return self._record({
                "status": "refused",
                "error": "X402SpendCapError",
                "url": url,
                "cap": e.cap,
                "requested_amount_stroops": e.amount,
                "asset": e.asset,
                "network": e.network,
                "signed": False,
                "message": redact_secrets(
                    f"Payment refused before signing: the price is above the per-payment cap of "
                    f"{e.cap}. Nothing was signed or sent."
                ),
            })
        except X402NetworkMismatchError as e:
            return self._record({
                "status": "refused",
                "error": "X402NetworkMismatchError",
                "url": url,
                "network": e.network,
                "offered": e.offered,
                "signed": False,
                "message": redact_secrets(str(e)),
            })
        except Exception as e:  # network errors, rejected payment, etc.
            return self._record({
                "status": "error",
                "error": type(e).__name__,
                "url": url,
                "message": redact_secrets(e),
            })

        tx_hash = extract_settlement_tx(getattr(self._client, "last_x402_settlement", None))
        if not tx_hash and isinstance(data, dict) and "error" in data:
            # The SDK returns non-402 responses as-is (e.g. a 503 from the server).
            return self._record({
                "status": "error",
                "error": "ServerError",
                "url": url,
                "signed": False,
                "message": redact_secrets(json.dumps(data, default=str)[:500]),
            })
        # "paid" when a settlement came back; "free" when the route did not ask for payment.
        entry: dict[str, Any] = {"status": "paid" if tx_hash else "free", "url": url, "data": data}
        if tx_hash:
            entry["tx_hash"] = tx_hash
            entry["stellar_expert"] = stellar_expert_tx_url(tx_hash, self.network)
        return self._record(entry)

    def _run(self, url: str, method: str = "GET") -> str:
        return _run_coro(self._afetch(url, method))

    async def _arun(self, url: str, method: str = "GET") -> str:
        return await self._afetch(url, method)
