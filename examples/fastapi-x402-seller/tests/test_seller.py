"""Offline tests: the facilitator is an httpx.MockTransport, nothing leaves the machine."""

from __future__ import annotations

import base64
import json
from typing import Any, Dict, List, Optional

import httpx
import pytest
from fastapi.testclient import TestClient

from app import PAID_ROUTE, create_app
from x402_seller import USDC_SAC, X402Seller, FacilitatorClient, b64json_encode, usd_to_atomic

PAY_TO = "GDYJA25NGJWWMGTAC73LG4J2X6FCVSTC7CTVJZKT3EZSBUYM5WOKIV5Z"
PAYER = "GBTBTAO3MGBSBQ6ARGHSRRJLPJ7UBI7HCGHP47DO77TJZYWPN7KSRIY5"
TX_HASH = "ab" * 32
PRICE = "$0.01"
PRICE_ATOMIC = "100000"


class FakeFacilitator:
    """Stands in for OpenZeppelin Channels: records calls, returns scripted answers."""

    def __init__(
        self,
        verify: Optional[Dict[str, Any]] = None,
        settle: Optional[Dict[str, Any]] = None,
        fail_with: Optional[int] = None,
        down: bool = False,
    ) -> None:
        self.verify_answer = verify or {"isValid": True, "payer": PAYER}
        self.settle_answer = settle or {
            "success": True, "transaction": TX_HASH, "network": "stellar:testnet", "payer": PAYER,
        }
        self.fail_with = fail_with
        self.down = down
        self.calls: List[Dict[str, Any]] = []

    def paths(self) -> List[str]:
        return [c["path"] for c in self.calls]

    def handler(self, request: httpx.Request) -> httpx.Response:
        path = request.url.path.rsplit("/", 1)[-1]
        body = json.loads(request.content) if request.content else None
        self.calls.append({"path": path, "body": body, "auth": request.headers.get("authorization")})
        if self.down:
            raise httpx.ConnectError("facilitator unreachable", request=request)
        if path == "supported":
            return httpx.Response(200, json={"kinds": [
                {"x402Version": 2, "scheme": "exact", "network": "stellar:pubnet",
                 "extra": {"areFeesSponsored": True}},
                {"x402Version": 2, "scheme": "exact", "network": "stellar:testnet",
                 "extra": {"areFeesSponsored": True}},
            ]})
        if self.fail_with:
            return httpx.Response(self.fail_with, text="boom")
        if path == "verify":
            return httpx.Response(200 if self.verify_answer.get("isValid") else 400, json=self.verify_answer)
        if path == "settle":
            return httpx.Response(200 if self.settle_answer.get("success") else 400, json=self.settle_answer)
        return httpx.Response(404)


def make_client(fac: FakeFacilitator) -> TestClient:
    app = create_app(
        pay_to=PAY_TO,
        price=PRICE,
        network="stellar:testnet",
        facilitator_url="https://facilitator.test/x402/testnet",
        facilitator_api_key="test-facilitator-key",
        facilitator_transport=httpx.MockTransport(fac.handler),
    )
    return TestClient(app)


def decode(raw: str) -> Dict[str, Any]:
    return json.loads(base64.b64decode(raw))


def challenge(client: TestClient) -> Dict[str, Any]:
    resp = client.get(PAID_ROUTE)
    assert resp.status_code == 402
    return decode(resp.headers["payment-required"])


def payment_header(accepted: Dict[str, Any], **overrides: Any) -> str:
    payment = {"x402Version": 2, "accepted": accepted, "payload": {"transaction": "AAAAAgAAAAB-fake-xdr"}}
    payment.update(overrides)
    return b64json_encode(payment)


def assert_no_data(resp: httpx.Response) -> None:
    assert "forecast" not in resp.text
    assert "payment-response" not in resp.headers


# ─── 402 challenge ──────────────────────────────────────────────────────────


def test_health_is_free() -> None:
    fac = FakeFacilitator()
    resp = make_client(fac).get("/health")
    assert resp.status_code == 200
    assert resp.json()["payTo"] == PAY_TO
    assert fac.calls == []


def test_unpaid_request_gets_402_with_v2_requirements_and_no_data() -> None:
    fac = FakeFacilitator()
    resp = make_client(fac).get(PAID_ROUTE)

    assert resp.status_code == 402
    assert_no_data(resp)
    body = decode(resp.headers["payment-required"])
    assert body["x402Version"] == 2
    assert body["resource"]["url"].endswith(PAID_ROUTE)
    assert body["accepts"] == [{
        "scheme": "exact",
        "network": "stellar:testnet",
        "amount": PRICE_ATOMIC,
        "asset": USDC_SAC["stellar:testnet"],
        "payTo": PAY_TO,
        "maxTimeoutSeconds": 300,
        "extra": {"areFeesSponsored": True},
    }]
    assert fac.paths() == ["supported"]
    assert fac.calls[0]["auth"] == "Bearer test-facilitator-key"


def test_supported_is_fetched_once() -> None:
    fac = FakeFacilitator()
    client = make_client(fac)
    client.get(PAID_ROUTE)
    client.get(PAID_ROUTE)
    assert fac.paths() == ["supported"]


# ─── Paid path ──────────────────────────────────────────────────────────────


def test_paid_request_is_verified_settled_then_served() -> None:
    fac = FakeFacilitator()
    client = make_client(fac)
    accepted = challenge(client)["accepts"][0]

    resp = client.get(PAID_ROUTE, headers={"PAYMENT-SIGNATURE": payment_header(accepted)})

    assert resp.status_code == 200
    assert resp.json()["forecast"]["pair"] == "XLM/USDC"
    assert resp.json()["paidWith"]["transaction"] == TX_HASH
    receipt = decode(resp.headers["payment-response"])
    assert receipt["success"] is True and receipt["transaction"] == TX_HASH

    assert fac.paths() == ["supported", "verify", "settle"]
    for call in fac.calls[1:]:
        assert call["auth"] == "Bearer test-facilitator-key"
        assert call["body"]["x402Version"] == 2
        assert call["body"]["paymentRequirements"] == accepted
        assert call["body"]["paymentPayload"]["payload"]["transaction"] == "AAAAAgAAAAB-fake-xdr"


def test_server_sends_its_own_requirements_to_the_facilitator() -> None:
    """A payer cannot widen `extra` or the timeout and have the facilitator check those instead."""
    fac = FakeFacilitator()
    client = make_client(fac)
    required = challenge(client)["accepts"][0]
    tampered = {**required, "maxTimeoutSeconds": 999999, "extra": {"areFeesSponsored": False}}

    resp = client.get(PAID_ROUTE, headers={"PAYMENT-SIGNATURE": payment_header(tampered)})

    assert resp.status_code == 200
    assert fac.calls[1]["body"]["paymentRequirements"] == required


# ─── Underpaid / mismatched ─────────────────────────────────────────────────


def test_underpaid_amount_gets_402_and_facilitator_is_not_called() -> None:
    fac = FakeFacilitator()
    client = make_client(fac)
    accepted = {**challenge(client)["accepts"][0], "amount": "99999"}

    resp = client.get(PAID_ROUTE, headers={"PAYMENT-SIGNATURE": payment_header(accepted)})

    assert resp.status_code == 402
    assert_no_data(resp)
    assert decode(resp.headers["payment-required"])["error"].startswith("amount_mismatch")
    assert fac.paths() == ["supported"]


def test_underpaid_transfer_rejected_by_verify_gets_402_and_is_not_settled() -> None:
    """The payer echoes the right amount but signed a smaller transfer: verify catches it."""
    fac = FakeFacilitator(verify={"isValid": False, "invalidReason": "invalid_exact_stellar_payload_amount"})
    client = make_client(fac)
    accepted = challenge(client)["accepts"][0]

    resp = client.get(PAID_ROUTE, headers={"PAYMENT-SIGNATURE": payment_header(accepted)})

    assert resp.status_code == 402
    assert_no_data(resp)
    assert "invalid_exact_stellar_payload_amount" in decode(resp.headers["payment-required"])["error"]
    assert fac.paths() == ["supported", "verify"]


@pytest.mark.parametrize("field,value", [
    ("payTo", "GBTBTAO3MGBSBQ6ARGHSRRJLPJ7UBI7HCGHP47DO77TJZYWPN7KSRIY5"),
    ("network", "stellar:pubnet"),
    ("asset", USDC_SAC["stellar:pubnet"]),
    ("scheme", "upto"),
])
def test_mismatched_requirements_get_402(field: str, value: str) -> None:
    fac = FakeFacilitator()
    client = make_client(fac)
    accepted = {**challenge(client)["accepts"][0], field: value}

    resp = client.get(PAID_ROUTE, headers={"PAYMENT-SIGNATURE": payment_header(accepted)})

    assert resp.status_code == 402
    assert_no_data(resp)
    assert decode(resp.headers["payment-required"])["error"] == f"requirements_mismatch: {field}"
    assert fac.paths() == ["supported"]


def test_failed_settlement_gets_402_and_no_data() -> None:
    fac = FakeFacilitator(settle={"success": False, "errorReason": "transaction_failed", "transaction": ""})
    client = make_client(fac)
    accepted = challenge(client)["accepts"][0]

    resp = client.get(PAID_ROUTE, headers={"PAYMENT-SIGNATURE": payment_header(accepted)})

    assert resp.status_code == 402
    assert_no_data(resp)
    assert "transaction_failed" in decode(resp.headers["payment-required"])["error"]
    assert fac.paths() == ["supported", "verify", "settle"]


# ─── Malformed payments ─────────────────────────────────────────────────────


@pytest.mark.parametrize("headers", [
    {"PAYMENT-SIGNATURE": "not base64 !!"},
    {"PAYMENT-SIGNATURE": base64.b64encode(b"not json").decode()},
    {"PAYMENT-SIGNATURE": b64json_encode(["a", "list"])},
    {"PAYMENT-SIGNATURE": b64json_encode({"x402Version": 1, "payload": {}})},
    {"PAYMENT-SIGNATURE": b64json_encode({"x402Version": 2, "payload": {}})},
    {"PAYMENT-SIGNATURE": "A" * 40000},
    {"X-PAYMENT": b64json_encode({"x402Version": 1})},
])
def test_malformed_payment_gets_402_and_no_facilitator_call(headers: Dict[str, str]) -> None:
    fac = FakeFacilitator()
    resp = make_client(fac).get(PAID_ROUTE, headers=headers)
    assert resp.status_code == 402
    assert_no_data(resp)
    assert "payment-required" in resp.headers
    assert fac.paths() == ["supported"]


# ─── Facilitator failures ───────────────────────────────────────────────────


def test_unreachable_facilitator_returns_503_without_data() -> None:
    fac = FakeFacilitator(down=True)
    resp = make_client(fac).get(PAID_ROUTE)
    assert resp.status_code == 503
    assert_no_data(resp)


@pytest.mark.parametrize("status", [401, 500, 503])
def test_facilitator_error_on_verify_returns_502_without_data(status: int) -> None:
    fac = FakeFacilitator(fail_with=status)
    client = make_client(fac)
    accepted = challenge(client)["accepts"][0]

    resp = client.get(PAID_ROUTE, headers={"PAYMENT-SIGNATURE": payment_header(accepted)})

    assert resp.status_code == 502
    assert_no_data(resp)
    assert fac.paths() == ["supported", "verify"]


# ─── Configuration ──────────────────────────────────────────────────────────


def test_server_refuses_a_secret_key_as_pay_to() -> None:
    secret = "S" + "A" * 55
    with pytest.raises(ValueError, match="never put it on the server"):
        X402Seller(pay_to=secret, facilitator=FacilitatorClient(url="https://x.test"))


def test_server_needs_a_public_pay_to() -> None:
    with pytest.raises(ValueError, match="public key"):
        X402Seller(pay_to="", facilitator=FacilitatorClient(url="https://x.test"))


def test_example_is_testnet_only() -> None:
    with pytest.raises(ValueError, match="testnet only"):
        create_app(pay_to=PAY_TO, network="stellar:pubnet")


@pytest.mark.parametrize("price,atomic", [
    ("$0.01", "100000"), ("0.02", "200000"), ("$1", "10000000"), ("$0.0000001", "1"),
])
def test_usd_to_atomic(price: str, atomic: str) -> None:
    assert usd_to_atomic(price) == atomic


@pytest.mark.parametrize("price", ["$0", "-1", "abc", "$0.00000001"])
def test_usd_to_atomic_rejects_bad_prices(price: str) -> None:
    with pytest.raises(ValueError):
        usd_to_atomic(price)
