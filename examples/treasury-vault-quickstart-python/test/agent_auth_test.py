"""TDD @999@: JWT demo credentials must be sent as Bearer token, not x-api-key."""

from unittest.mock import MagicMock

from src.auth import make_agent


def test_make_agent_usApiKeyParaApiKeyNrm(monkeypatch):
    captured = {}

    class FakeAgent:
        def __init__(self, **kwargs):
            captured.update(kwargs)

    monkeypatch.setattr("nirium.Agent", FakeAgent)
    make_agent("https://nirium-agent.fly.dev", "nrm_abc123")
    assert captured.get("api_key") == "nrm_abc123"
    assert "token" not in captured


def test_make_agent_usTokenBearerParaJwt(monkeypatch):
    captured = {}

    class FakeAgent:
        def __init__(self, **kwargs):
            captured.update(kwargs)

    monkeypatch.setattr("nirium.Agent", FakeAgent)
    make_agent("https://nirium-agent.fly.dev", "eyJhbGciOi.signature.parts")
    assert captured.get("token") == "eyJhbGciOi.signature.parts"
    assert "api_key" not in captured
