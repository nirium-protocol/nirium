"""LangChain tool that wraps the existing Nirium x402 client.

The Stellar secret is used only to initialize ``Agent.init_x402``. It is never
stored on the tool, never included in the schema the model sees, and is stripped
from any error or return value that could reach the LLM.
"""

from __future__ import annotations

import json
import os
import re
from typing import Any, Optional, Type
from urllib.parse import urlparse

from pydantic import BaseModel, Field, PrivateAttr

from .client import Agent

try:
    from langchain_core.callbacks import (
        AsyncCallbackManagerForToolRun,
        CallbackManagerForToolRun,
    )
    from langchain_core.tools import BaseTool, ToolException
except ImportError as exc:  # pragma: no cover - exercised by an explicit test
    raise ImportError(
        "NiriumX402Tool requires the optional LangChain extra. "
        "Install with: pip install 'nirium[langchain]'"
    ) from exc


DEFAULT_TOOL_NAME = "nirium_x402_fetch"
DEFAULT_TOOL_DESCRIPTION = (
    "Call an HTTP endpoint protected by Nirium x402 on Stellar. "
    "The tool completes the HTTP 402 payment flow and returns the response body. "
    "Provide the absolute URL, an optional HTTP method, and an optional JSON body. "
    "Use this when the user asks for a paid Nirium or x402-protected resource."
)

_ENV_SECRET_KEYS = (
    "STELLAR_SECRET_KEY",
    "STELLAR_TESTNET_SECRET_KEY",
    "NIRIUM_STELLAR_SECRET",
)
_ENV_NETWORK_KEYS = ("NIRIUM_X402_NETWORK", "STELLAR_NETWORK")
_ALLOWED_METHODS = {"GET", "POST", "PUT", "PATCH", "DELETE", "HEAD"}

# Stellar secret seeds are 56-character base32 strings starting with S.
_STELLAR_SECRET_RE = re.compile(r"\bS[A-Z2-7]{55}\b")
_ASSIGNED_SECRET_RE = re.compile(
    r"(?i)\b(secret(?:[_-]?key)?|seed|private[_-]?key)\s*[:=]\s*\S+"
)


def redact_secrets(value: Any) -> str:
    """Strip secret material from anything that might be shown to a model."""
    text = value if isinstance(value, str) else str(value)
    text = _STELLAR_SECRET_RE.sub("[REDACTED]", text)
    text = re.sub(
        r"(?i)\b(PAYMENT-SIGNATURE|X-PAYMENT)\s*[:=]\s*\S+",
        r"\1=[REDACTED]",
        text,
    )
    text = _ASSIGNED_SECRET_RE.sub(r"\1=[REDACTED]", text)
    return text


def _safe_tool_error(error: Exception) -> str:
    return f"x402 request failed: {redact_secrets(error)}"


def extract_settlement_tx(settlement: Optional[dict[str, Any]]) -> Optional[str]:
    """Return a public transaction hash from an x402 settlement payload."""
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


def normalize_network(network: Optional[str]) -> str:
    raw = (network or "stellar:testnet").strip()
    aliases = {
        "testnet": "stellar:testnet",
        "stellar:testnet": "stellar:testnet",
        "mainnet": "stellar:pubnet",
        "pubnet": "stellar:pubnet",
        "public": "stellar:pubnet",
        "stellar:pubnet": "stellar:pubnet",
        "stellar:public": "stellar:pubnet",
        "stellar:mainnet": "stellar:pubnet",
    }
    return aliases.get(raw.lower(), raw)


def _first_env(*names: str) -> Optional[str]:
    for name in names:
        value = os.environ.get(name)
        if value:
            return value
    return None


def _require_http_url(url: str) -> str:
    parsed = urlparse(url)
    if parsed.scheme not in {"http", "https"} or not parsed.netloc:
        raise ValueError("url must be an absolute http(s) URL")
    return url


def _parse_body(body: Optional[str]) -> Optional[Any]:
    if body is None:
        return None
    stripped = body.strip()
    if not stripped:
        return None
    try:
        return json.loads(stripped)
    except json.JSONDecodeError:
        return body


class NiriumX402Input(BaseModel):
    """Arguments exposed to LangChain agent executors."""

    url: str = Field(description="Absolute HTTP URL of the x402-protected resource.")
    method: str = Field(
        default="GET",
        description="HTTP method to use (GET, POST, PUT, PATCH, DELETE, HEAD).",
    )
    body: Optional[str] = Field(
        default=None,
        description="Optional request body as a JSON string for methods that send a payload.",
    )


class NiriumX402Tool(BaseTool):
    """LangChain ``BaseTool`` that pays an x402 endpoint via ``Agent.x402_fetch``."""

    name: str = DEFAULT_TOOL_NAME
    description: str = DEFAULT_TOOL_DESCRIPTION
    args_schema: Type[BaseModel] = NiriumX402Input

    _client: Agent = PrivateAttr()
    _network: str = PrivateAttr(default="stellar:testnet")

    def __init__(
        self,
        secret_key: Optional[str] = None,
        network: Optional[str] = None,
        rpc_url: Optional[str] = None,
        agent: Optional[Agent] = None,
        api_url: Optional[str] = None,
        max_amount_per_payment: Optional[Any] = None,
        approve: Optional[Any] = None,
        **kwargs: Any,
    ) -> None:
        kwargs.setdefault("handle_tool_error", True)
        super().__init__(**kwargs)

        resolved_network = normalize_network(
            network or _first_env(*_ENV_NETWORK_KEYS) or "stellar:testnet"
        )
        resolved_rpc = rpc_url or os.environ.get("NIRIUM_X402_RPC_URL") or ""
        self._network = resolved_network

        if agent is not None:
            self._client = agent
            return

        resolved_secret = secret_key or _first_env(*_ENV_SECRET_KEYS)
        if not resolved_secret:
            raise ValueError(
                "A Stellar secret is required to pay x402 endpoints. "
                "Pass secret_key=... or set STELLAR_SECRET_KEY."
            )
        client = Agent(api_url=api_url or "https://nirium-agent.fly.dev")
        # Only forward the spending options that were set: when omitted, init_x402
        # keeps its own default cap ($1 of USDC per payment).
        limits: dict[str, Any] = {}
        if max_amount_per_payment is not None:
            limits["max_amount_per_payment"] = max_amount_per_payment
        if approve is not None:
            limits["approve"] = approve
        client.init_x402(resolved_secret, network=resolved_network, rpc_url=resolved_rpc, **limits)
        self._client = client

    def __repr__(self) -> str:
        return f"NiriumX402Tool(name={self.name!r}, network={self._network!r})"

    @property
    def last_settlement(self) -> Optional[dict[str, Any]]:
        return getattr(self._client, "last_x402_settlement", None)

    def _normalize_method(self, method: str) -> str:
        normalized = (method or "GET").strip().upper()
        if normalized not in _ALLOWED_METHODS:
            raise ValueError(f"Unsupported HTTP method: {normalized}")
        return normalized

    def _format_result(self, payload: Any) -> str:
        if isinstance(payload, str):
            rendered = payload
        else:
            rendered = json.dumps(payload, default=str)
        tx_hash = extract_settlement_tx(self.last_settlement)
        if tx_hash:
            rendered = f"{rendered}\n\nx402_settlement_tx: {tx_hash}"
        return redact_secrets(rendered)

    async def _execute(self, url: str, method: str, body: Optional[str]) -> str:
        payload = await self._client.x402_fetch(
            _require_http_url(url),
            method=self._normalize_method(method),
            body=_parse_body(body),
        )
        return self._format_result(payload)

    def _run(
        self,
        url: str,
        method: str = "GET",
        body: Optional[str] = None,
        run_manager: Optional[CallbackManagerForToolRun] = None,
    ) -> str:
        import asyncio
        import concurrent.futures

        try:
            try:
                asyncio.get_running_loop()
            except RuntimeError:
                return asyncio.run(self._execute(url, method, body))

            with concurrent.futures.ThreadPoolExecutor(max_workers=1) as pool:
                return pool.submit(
                    lambda: asyncio.run(self._execute(url, method, body))
                ).result()
        except ToolException:
            raise
        except Exception as exc:
            raise ToolException(_safe_tool_error(exc)) from None

    async def _arun(
        self,
        url: str,
        method: str = "GET",
        body: Optional[str] = None,
        run_manager: Optional[AsyncCallbackManagerForToolRun] = None,
    ) -> str:
        try:
            return await self._execute(url, method, body)
        except ToolException:
            raise
        except Exception as exc:
            raise ToolException(_safe_tool_error(exc)) from None


def create_nirium_x402_tool(
    secret_key: Optional[str] = None,
    network: Optional[str] = None,
    rpc_url: Optional[str] = None,
    agent: Optional[Agent] = None,
    api_url: Optional[str] = None,
    **kwargs: Any,
) -> NiriumX402Tool:
    """Factory that returns a ready-to-bind ``NiriumX402Tool``."""
    return NiriumX402Tool(
        secret_key=secret_key,
        network=network,
        rpc_url=rpc_url,
        agent=agent,
        api_url=api_url,
        **kwargs,
    )
