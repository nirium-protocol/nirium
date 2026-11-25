"""Offline end-to-end test of the two-agent crew in agent.py.

A scripted LLM stands in for the model, aiohttp is faked, and the signer is a
spy. The crew, the tool and the Nirium spend cap all run for real.
"""

from __future__ import annotations

import os

os.environ.setdefault("CREWAI_TRACING_ENABLED", "false")
os.environ.setdefault("CREWAI_DISABLE_TELEMETRY", "true")
os.environ.setdefault("OTEL_SDK_DISABLED", "true")

from typing import Any  # noqa: E402

import pytest  # noqa: E402
from crewai.llms.base_llm import BaseLLM  # noqa: E402

import agent as example  # noqa: E402
from test_crewai_tool import CHEAP_URL, EXPENSIVE_URL, TX_HASH, FakeSession, _tool_with  # noqa: E402

SERVER = "http://localhost:3402"


class ScriptedLLM(BaseLLM):
    """Scout answers with a URL; payer calls the tool once, then finishes."""

    def __init__(self, url: str):
        super().__init__(model="scripted-offline")
        self._url = url
        self._payer_turns = 0
        self.prompts: list[str] = []

    def supports_function_calling(self) -> bool:
        return False

    def call(self, messages: Any, tools=None, callbacks=None, available_functions=None,
             from_task=None, from_agent=None, response_model=None) -> str:
        self.prompts.append(str(messages))
        if getattr(from_agent, "role", "") == "Data scout":
            return f"Thought: this route answers the request\nFinal Answer: {self._url}"
        self._payer_turns += 1
        if self._payer_turns == 1:
            return (
                "Thought: pay the chosen route\nAction: nirium_x402_fetch\n"
                f'Action Input: {{"url": "{self._url}"}}'
            )
        return "Thought: I have the tool result\nFinal Answer: done, see tool result"


@pytest.fixture
def stop_patches():
    started: list = []
    yield started
    for p in started:
        p.stop()


def test_crew_has_two_agents_and_only_payer_has_tool(stop_patches):
    tool, _signer, patches = _tool_with(FakeSession(amount="200000"))
    stop_patches.extend(patches)
    crew = example.build_crew(tool, ScriptedLLM(CHEAP_URL), verbose=False)
    scout, payer = crew.agents
    assert (scout.role, payer.role) == ("Data scout", "Payer")
    assert not scout.tools
    assert [t.name for t in payer.tools] == ["nirium_x402_fetch"]


def test_crew_pays_cheap_route(stop_patches):
    tool, signer, patches = _tool_with(FakeSession(amount="200000"))
    stop_patches.extend(patches)
    crew = example.build_crew(tool, ScriptedLLM(CHEAP_URL), verbose=False)

    crew.kickoff(inputs={"request": "short market summary", "catalog": example.catalog(SERVER)})

    assert [h["status"] for h in tool.history] == ["paid"]
    assert tool.history[0]["tx_hash"] == TX_HASH
    signer.assert_called_once()


def test_crew_survives_over_cap_refusal(stop_patches):
    session = FakeSession(amount="20000000")  # $2
    tool, signer, patches = _tool_with(session)
    stop_patches.extend(patches)
    crew = example.build_crew(tool, ScriptedLLM(EXPENSIVE_URL), verbose=False)

    result = crew.kickoff(inputs={"request": "full report", "catalog": example.catalog(SERVER)})

    assert result.raw  # crew finished, no exception
    assert [h["status"] for h in tool.history] == ["refused"]
    assert tool.history[0]["error"] == "X402SpendCapError"
    signer.assert_not_called()
    assert len(session.requests) == 1
