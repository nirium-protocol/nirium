
import asyncio
import json

import nirium_claude_tool as tool


class FakeAgent:
    async def x402_fetch(self, url, method="GET"):
        return {"message": "Paid content received"}


def test_successful_payment(monkeypatch):
    monkeypatch.setattr(tool, "_nirium_agent", FakeAgent())

    result = json.loads(asyncio.run(
        tool.nirium_x402_fetch("http://localhost/test")
    ))

    assert result["status"] == "success"
    assert result["response"]["message"] == "Paid content received"


def test_uninitialized_agent(monkeypatch):
    monkeypatch.setattr(tool, "_nirium_agent", None)

    result = json.loads(asyncio.run(
        tool.nirium_x402_fetch("http://localhost/test")
    ))

    assert result["status"] == "error"


def test_over_cap_refused(monkeypatch):
    class FakeCapError(Exception):
        amount = "20000000"
        asset = "USDC"
        url = "http://localhost/test"
        network = "stellar:testnet"
        cap = "$1"

    class RefusingAgent:
        async def x402_fetch(self, url, method="GET"):
            raise FakeCapError("Over cap")

    monkeypatch.setattr(tool, "X402SpendCapError", FakeCapError)
    monkeypatch.setattr(tool, "_nirium_agent", RefusingAgent())

    result = json.loads(asyncio.run(
        tool.nirium_x402_fetch("http://localhost/test")
    ))

    assert result["status"] == "refused"
    assert result["signed"] is False
    assert "before signing" in result["message"]
