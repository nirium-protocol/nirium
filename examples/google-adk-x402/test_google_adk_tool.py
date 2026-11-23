"""Offline tests for the Google ADK x402 FunctionTool.

Tests run without network calls or real LLM invocations.
Tests exercise the actual ADK FunctionTool wrapper.
"""

from __future__ import annotations

import json
from typing import Any
from unittest.mock import AsyncMock, MagicMock, patch

import pytest

import nirium_tool
from nirium_tool import initialize_nirium_x402, _extract_settlement_tx


# Test constants
TESTNET_USDC = "CBIELTK6YBZJU5UP2WWQEUCYKLPU6AUNZ2BQ4WWFEIE3USCIHMXQDAMA"
TEST_URL = "https://test.example/paid"

# Generate test secret at runtime (never funded, for testing only)
from stellar_sdk import Keypair

TEST_SECRET = Keypair.random().secret


@pytest.fixture
def mock_agent():
    """Set up mocked Nirium Agent for tests."""
    with patch("nirium_tool.Agent") as mock_agent_class:
        mock_instance = MagicMock()
        mock_instance.x402_fetch = AsyncMock()
        mock_instance.last_x402_settlement = None
        mock_agent_class.return_value = mock_instance
        yield mock_instance


def test_initialize_sets_cap():
    """Test that initialize_nirium_x402 sets up the agent with the correct cap."""
    with patch("nirium_tool.Agent") as mock_agent_class:
        mock_instance = MagicMock()
        mock_agent_class.return_value = mock_instance

        initialize_nirium_x402(
            secret_key=TEST_SECRET,
            network="stellar:testnet",
            max_amount_per_payment="$0.50",
        )

        mock_agent_class.assert_called_once()
        mock_instance.init_x402.assert_called_once_with(
            TEST_SECRET,
            network="stellar:testnet",
            max_amount_per_payment="$0.50",
        )


@pytest.mark.asyncio
async def test_successful_payment_below_cap(mock_agent):
    """Test a successful payment below the spend cap."""
    mock_agent.x402_fetch.return_value = {"ok": True, "data": "success"}
    mock_agent.last_x402_settlement = {
        "transaction": "abc123",
        "status": "settled",
    }

    initialize_nirium_x402(TEST_SECRET, max_amount_per_payment="$1")

    # Call the underlying function directly (before FunctionTool wrapping)
    result = await nirium_tool.nirium_x402_fetch(TEST_URL, "GET")

    parsed = json.loads(result)
    assert parsed["ok"] is True
    assert parsed["_x402_settlement_tx"] == "abc123"
    mock_agent.x402_fetch.assert_called_once_with(TEST_URL, method="GET")


@pytest.mark.asyncio
async def test_payment_above_cap_refused(mock_agent):
    """Test that a payment above the cap is refused with X402SpendCapError."""
    from nirium import X402SpendCapError

    error = X402SpendCapError(
        url=TEST_URL,
        requirement={
            "amount": "15000000",
            "asset": TESTNET_USDC,
            "network": "stellar:testnet",
            "payTo": "GABC123",
        },
        cap="$1",
        reason="The requested payment of 1.5 USDC exceeds the cap of $1",
    )
    mock_agent.x402_fetch.side_effect = error

    initialize_nirium_x402(TEST_SECRET, max_amount_per_payment="$1")
    result = await nirium_tool.nirium_x402_fetch(TEST_URL, "GET")

    parsed = json.loads(result)
    assert parsed["error"] == "X402SpendCapError"
    assert "exceeds the per-payment cap" in parsed["message"]
    assert parsed["details"]["cap"] == "$1"
    assert parsed["details"]["amount"] == "15000000"


@pytest.mark.asyncio
async def test_network_mismatch_error(mock_agent):
    """Test network mismatch handling."""
    from nirium import X402NetworkMismatchError

    error = X402NetworkMismatchError(
        url=TEST_URL,
        network="stellar:testnet",
        offered=["stellar:pubnet"],
    )
    mock_agent.x402_fetch.side_effect = error

    initialize_nirium_x402(TEST_SECRET, network="stellar:testnet")
    result = await nirium_tool.nirium_x402_fetch(TEST_URL, "GET")

    parsed = json.loads(result)
    assert parsed["error"] == "X402NetworkMismatchError"
    assert "Network mismatch" in parsed["message"]


@pytest.mark.asyncio
async def test_uninitialized_agent():
    """Test that calling the tool without initialization returns an error."""
    original_agent = nirium_tool._nirium_agent
    nirium_tool._nirium_agent = None

    try:
        result = await nirium_tool.nirium_x402_fetch(TEST_URL, "GET")
        parsed = json.loads(result)
        assert "error" in parsed
        assert "not initialized" in parsed["error"]
    finally:
        nirium_tool._nirium_agent = original_agent


def test_extract_settlement_tx_from_various_formats():
    """Test transaction hash extraction from different settlement payloads."""

    # Direct transaction field
    assert _extract_settlement_tx({"transaction": "tx123"}) == "tx123"

    # txHash field
    assert _extract_settlement_tx({"txHash": "tx456"}) == "tx456"

    # Nested in settlement
    assert _extract_settlement_tx({
        "settlement": {"transaction": "tx789"}
    }) == "tx789"

    # No transaction
    assert _extract_settlement_tx({"status": "pending"}) is None

    # None input
    assert _extract_settlement_tx(None) is None


@pytest.mark.asyncio
async def test_tool_returns_string_result(mock_agent):
    """Test that non-dict results are stringified properly."""
    mock_agent.x402_fetch.return_value = "plain text response"
    mock_agent.last_x402_settlement = {"transaction": "tx999"}

    initialize_nirium_x402(TEST_SECRET)
    result = await nirium_tool.nirium_x402_fetch(TEST_URL, "GET")

    assert "plain text response" in result
    assert "x402_settlement_tx: tx999" in result


def test_function_tool_wrapper():
    """Test that the FunctionTool wrapper is applied."""
    from google.adk.tools import FunctionTool

    # The exported object should be a FunctionTool instance
    assert isinstance(nirium_tool.nirium_x402_tool, FunctionTool)
    # Verify tool has expected properties
    assert nirium_tool.nirium_x402_tool.name == "nirium_x402_fetch"
    assert "x402 payment" in nirium_tool.nirium_x402_tool.description


if __name__ == "__main__":
    pytest.main([__file__, "-v"])
