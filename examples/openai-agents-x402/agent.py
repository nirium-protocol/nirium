"""OpenAI Agents SDK agent that uses Nirium x402 payment tool.

This script demonstrates:
1. A successful paid call (below the spend cap)
2. A refused call (above the spend cap) that returns a clear error

The agent uses the OpenAI Agents SDK with the @function_tool decorator.
"""

from __future__ import annotations

import asyncio
import json
import os
import sys
from typing import Any

from agents import Agent as OpenAIAgent, Runner
from dotenv import load_dotenv

from nirium_tool import initialize_nirium_x402, nirium_x402_fetch


def _load_env() -> tuple[str, str]:
    """Load environment variables and return (secret_key, server_url)."""
    load_dotenv()
    
    secret_key = os.getenv("STELLAR_SECRET_KEY")
    if not secret_key:
        print("❌ Error: STELLAR_SECRET_KEY not set in .env")
        print("   Generate a testnet key at: https://laboratory.stellar.org/#account-creator?network=test")
        sys.exit(1)
    
    port = os.getenv("X402_SERVER_PORT", "3402")
    server_url = f"http://localhost:{port}"
    
    return secret_key, server_url


async def test_agent(server_url: str) -> None:
    """Run the agent with both test scenarios."""
    print("\n" + "="*60)
    print("🤖 OpenAI Agents SDK Test")
    print("="*60)
    
    # Create agent with the Nirium x402 tool
    agent = OpenAIAgent(
        name="Nirium x402 Payment Agent",
        instructions=(
            "You are a helpful agent that can make paid calls to x402-protected endpoints. "
            "When asked to fetch data from a URL, use the nirium_x402_fetch tool. "
            "If a payment is refused due to the spend cap, explain this clearly to the user."
        ),
        tools=[nirium_x402_fetch],
        model="gpt-4o-mini",
    )
    
    # Test 1: Cheap endpoint (below cap)
    print("\n📝 Test 1: Calling cheap endpoint (below $1 cap)")
    print("-" * 60)
    cheap_url = f"{server_url}/paid/market-summary"
    
    try:
        result1 = await Runner.run(agent, f"Please fetch data from {cheap_url}")
        print(f"✅ Agent response: {result1.final_output}")
    except Exception as e:
        print(f"Result: {e}")
    
    # Test 2: Expensive endpoint (above cap). server/ charges $2 here, so the
    # tool must refuse before signing and the agent explains why.
    print("\n📝 Test 2: Calling expensive endpoint (above $1 cap, must be refused)")
    print("-" * 60)
    expensive_url = f"{server_url}/paid/full-report"

    try:
        result2 = await Runner.run(agent, f"Please fetch data from {expensive_url}")
        print(f"✅ Agent response: {result2.final_output}")
    except Exception as e:
        print(f"Result: {e}")
    
    print("\n" + "="*60)
    print("✅ Agent tests complete!")
    print("="*60)


async def main() -> int:
    """Main entry point."""
    secret_key, server_url = _load_env()
    
    # Initialize Nirium x402 with $1 cap
    print(f"🔧 Initializing Nirium x402 client (cap: $1, network: stellar:testnet)")
    initialize_nirium_x402(
        secret_key=secret_key,
        network="stellar:testnet",
        max_amount_per_payment="$1",
    )
    
    # Check if OpenAI API key is available
    api_key = os.getenv("OPENAI_API_KEY")
    if not api_key:
        print("\n⚠️  OPENAI_API_KEY not set - cannot run live agent")
        print("   Set OPENAI_API_KEY in .env to test with a real model")
        print("   For now, run the offline tests: pytest test_openai_tool.py -v")
        return 1
    
    await test_agent(server_url)
    return 0


if __name__ == "__main__":
    try:
        sys.exit(asyncio.run(main()))
    except KeyboardInterrupt:
        print("\n\n👋 Interrupted by user")
        sys.exit(1)
