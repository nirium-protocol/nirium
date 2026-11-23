"""x402 v2 seller for FastAPI on Stellar: challenge, verify, settle.

The server only knows the seller's public address (``payTo``). The payer signs
the transfer and the facilitator submits it, so no seller secret key is needed
here.
"""

from __future__ import annotations

import base64
import binascii
import json
import re
from dataclasses import dataclass, field
from decimal import Decimal, InvalidOperation
from typing import Any, Callable, Dict, List, Optional

import httpx
from fastapi import HTTPException, Request, Response

X402_VERSION = 2
USDC_DECIMALS = 7
USDC_SAC = {
    "stellar:testnet": "CBIELTK6YBZJU5UP2WWQEUCYKLPU6AUNZ2BQ4WWFEIE3USCIHMXQDAMA",
    "stellar:pubnet": "CCW67TSZV3SSS2HXMBQ5JFGCKJNXKZM7UQUWUZPUTHXSTZLEO7SJMI75",
}
FACILITATORS = {
    "stellar:testnet": "https://channels.openzeppelin.com/x402/testnet",
    "stellar:pubnet": "https://channels.openzeppelin.com/x402",
}
_PUBLIC_KEY = re.compile(r"^G[A-Z2-7]{55}$")
# A Soroban transfer envelope is a few KB; anything far bigger is not a payment.
_MAX_PAYMENT_HEADER = 32 * 1024
# Fields the payer must echo back unchanged in `accepted`.
_MATCHED_FIELDS = ("scheme", "network", "asset", "payTo", "amount")


def usd_to_atomic(price: str) -> str:
    """'$0.01' or '0.01' -> '100000' (USDC has 7 decimals on Stellar)."""
    try:
        value = Decimal(str(price).strip().lstrip("$"))
    except InvalidOperation:
        raise ValueError(f"price must be a USD amount like '$0.01', got {price!r}") from None
    if not value.is_finite() or value <= 0:
        raise ValueError(f"price must be a positive USD amount, got {price!r}")
    atomic = value * (10 ** USDC_DECIMALS)
    if atomic != atomic.to_integral_value():
        raise ValueError(f"price must be positive with at most 7 decimals, got {price!r}")
    return str(int(atomic))


def b64json_encode(obj: Any) -> str:
    return base64.b64encode(json.dumps(obj, separators=(",", ":")).encode()).decode("ascii")


def b64json_decode(raw: str) -> Any:
    return json.loads(base64.b64decode(raw, validate=True).decode("utf-8"))


class FacilitatorError(RuntimeError):
    """The facilitator could not be reached or answered with something unusable."""


@dataclass
class FacilitatorClient:
    """Minimal client for an x402 facilitator (`/supported`, `/verify`, `/settle`)."""

    url: str
    api_key: Optional[str] = None
    timeout: float = 30.0
    transport: Optional[httpx.AsyncBaseTransport] = None

    def _client(self) -> httpx.AsyncClient:
        headers = {"Authorization": f"Bearer {self.api_key}"} if self.api_key else {}
        return httpx.AsyncClient(
            base_url=self.url.rstrip("/"),
            headers=headers,
            timeout=self.timeout,
            transport=self.transport,
        )

    async def _call(self, method: str, path: str, body: Optional[dict] = None) -> Dict[str, Any]:
        try:
            async with self._client() as client:
                resp = await client.request(method, path, json=body)
        except httpx.HTTPError as exc:
            raise FacilitatorError(f"{path}: {type(exc).__name__}") from exc
        try:
            data = resp.json()
        except ValueError:
            data = None
        # /verify and /settle answer 4xx with a normal body when a payment is invalid.
        if resp.status_code >= 500 or resp.status_code in (401, 403, 429) or not isinstance(data, dict):
            raise FacilitatorError(f"{path}: HTTP {resp.status_code}")
        return data

    async def supported(self) -> Dict[str, Any]:
        return await self._call("GET", "/supported")

    async def verify(self, payload: dict, requirements: dict) -> Dict[str, Any]:
        return await self._call("POST", "/verify", {
            "x402Version": X402_VERSION,
            "paymentPayload": payload,
            "paymentRequirements": requirements,
        })

    async def settle(self, payload: dict, requirements: dict) -> Dict[str, Any]:
        return await self._call("POST", "/settle", {
            "x402Version": X402_VERSION,
            "paymentPayload": payload,
            "paymentRequirements": requirements,
        })


@dataclass
class X402Seller:
    """Charges for FastAPI routes with x402 v2 (`exact` scheme, Stellar USDC)."""

    pay_to: str
    facilitator: FacilitatorClient
    network: str = "stellar:testnet"
    max_timeout_seconds: int = 300
    _extra: Optional[Dict[str, Any]] = field(default=None, init=False, repr=False)

    def __post_init__(self) -> None:
        if not _PUBLIC_KEY.match(self.pay_to or ""):
            hint = " That looks like a secret key: never put it on the server." if str(
                self.pay_to).startswith("S") else ""
            raise ValueError(f"pay_to must be a Stellar public key (G...).{hint}")
        if self.network not in USDC_SAC:
            raise ValueError(f"network must be one of {', '.join(USDC_SAC)}, got {self.network!r}")

    async def _scheme_extra(self) -> Dict[str, Any]:
        """`extra` for the exact scheme on this network, taken from the facilitator's /supported.

        It carries `areFeesSponsored`, which the Nirium client requires before it signs.
        """
        if self._extra is None:
            supported = await self.facilitator.supported()
            kind = next((
                k for k in supported.get("kinds") or []
                if isinstance(k, dict)
                and k.get("x402Version") == X402_VERSION
                and k.get("scheme") == "exact"
                and k.get("network") == self.network
            ), None)
            if kind is None:
                raise FacilitatorError(f"facilitator does not support exact on {self.network}")
            self._extra = dict(kind.get("extra") or {})
        return self._extra

    async def requirements(self, price: str) -> Dict[str, Any]:
        return {
            "scheme": "exact",
            "network": self.network,
            "amount": usd_to_atomic(price),
            "asset": USDC_SAC[self.network],
            "payTo": self.pay_to,
            "maxTimeoutSeconds": self.max_timeout_seconds,
            "extra": await self._scheme_extra(),
        }

    @staticmethod
    def _payment_required(error: str, resource: dict, accepts: List[dict]) -> HTTPException:
        body = {"x402Version": X402_VERSION, "error": error, "resource": resource, "accepts": accepts}
        return HTTPException(
            status_code=402,
            detail={"error": error},
            headers={"PAYMENT-REQUIRED": b64json_encode(body)},
        )

    def paid(self, price: str, description: str = "", mime_type: str = "application/json") -> Callable:
        """FastAPI dependency: the route body runs only after the payment is settled.

        Unpaid, malformed, underpaid or rejected payments get 402 and no data.
        The settlement goes back to the payer in the `PAYMENT-RESPONSE` header.
        """
        usd_to_atomic(price)  # fail at startup, not on the first request

        async def dependency(request: Request, response: Response) -> Dict[str, Any]:
            resource = {"url": str(request.url), "description": description, "mimeType": mime_type}
            try:
                required = await self.requirements(price)
            except FacilitatorError:
                raise HTTPException(503, detail={"error": "facilitator_unavailable"}) from None

            def reject(error: str) -> HTTPException:
                return self._payment_required(error, resource, [required])

            raw = request.headers.get("PAYMENT-SIGNATURE")
            if not raw:
                if request.headers.get("X-PAYMENT"):
                    raise reject("x402 v1 X-PAYMENT header is not accepted; send PAYMENT-SIGNATURE (v2)")
                raise reject("payment required")
            if len(raw) > _MAX_PAYMENT_HEADER:
                raise reject("invalid_payment: header too large")
            try:
                payload = b64json_decode(raw)
            except (binascii.Error, ValueError, UnicodeDecodeError):
                raise reject("invalid_payment: PAYMENT-SIGNATURE is not base64 JSON") from None
            if not isinstance(payload, dict) or payload.get("x402Version") != X402_VERSION:
                raise reject("invalid_payment: x402Version must be 2")
            accepted = payload.get("accepted")
            if not isinstance(accepted, dict) or not isinstance(payload.get("payload"), dict):
                raise reject("invalid_payment: missing accepted or payload")

            for name in _MATCHED_FIELDS:
                if accepted.get(name) != required[name]:
                    if name == "amount":
                        raise reject(
                            f"amount_mismatch: route costs {required['amount']} atomic USDC, "
                            f"payment offered {accepted.get('amount')!r}"
                        )
                    raise reject(f"requirements_mismatch: {name}")

            # Verify and settle against OUR requirements, never the ones the payer
            # echoed: the facilitator then checks the signed transfer itself.
            try:
                verified = await self.facilitator.verify(payload, required)
                if verified.get("isValid") is not True:
                    raise reject(f"verify_failed: {verified.get('invalidReason') or 'invalid payment'}")
                settled = await self.facilitator.settle(payload, required)
            except FacilitatorError:
                raise HTTPException(502, detail={"error": "facilitator_error"}) from None
            if settled.get("success") is not True or not settled.get("transaction"):
                raise reject(f"settle_failed: {settled.get('errorReason') or 'not settled'}")

            response.headers["PAYMENT-RESPONSE"] = b64json_encode(settled)
            return settled

        return dependency
