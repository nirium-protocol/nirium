"""Google Agent Development Kit (ADK) agent that uses the Nirium x402 payment tool.

This script demonstrates:
1. A successful paid call (below the spend cap)
2. A refused call (above the spend cap) that returns a clear error

The agent uses Google ADK with a Gemini model and the FunctionTool wrapper.
"""

from __future__ import annotations

import asyncio
import os
import sys

from dotenv import load_dotenv
from google.adk.agents import LlmAgent
from google.adk.runners import Runner
from google.adk.sessions import InMemorySessionService
from google.genai import types

from nirium_tool import initialize_nirium_x402, nirium_x402_tool


def _load_env() -> tuple[str, str, str]:
    """Load environment variables and return (secret_key, server_url, model)."""
    load_dotenv()

    secret_key = os.getenv("STELLAR_SECRET_KEY")
    if not secret_key:
        print("Error: STELLAR_SECRET_KEY not set in .env")
        print("   Generate a testnet key at: https://laboratory.stellar.org/#account-creator?network=test")
        sys.exit(1)

    port = os.getenv("X402_SERVER_PORT", "3402")
    server_url = f"http://localhost:{port}"
    model = os.getenv("GEMINI_MODEL", "gemini-3.6-flash")

    return secret_key, server_url, model


async def _run_prompt(runner: Runner, session_id: str, prompt: str) -> str:
    """Send one prompt to the agent and return its final response text."""
    final_text = ""
    async for event in runner.run_async(
        user_id="demo_user",
        session_id=session_id,
        new_message=types.Content(role="user", parts=[types.Part(text=prompt)]),
    ):
        if event.is_final_response() and event.content and event.content.parts:
            for part in event.content.parts:
                if part.text:
                    final_text += part.text
    return final_text


async def test_agent(server_url: str, model: str) -> None:
    """Run the agent with both test scenarios."""
    print("\n" + "=" * 60)
    print("Google ADK x402 Payment Agent")
    print(f"Model: {model}")
    print("=" * 60)

    # Create agent with the Nirium x402 tool
    agent = LlmAgent(
        name="Nirium_x402_Payment_Agent",
        model=model,
        instruction=(
            "You are a helpful agent that can make paid calls to x402-protected endpoints. "
            "When asked to fetch data from a URL, use the nirium_x402_fetch tool. "
            "If a payment is refused due to the spend cap, explain this clearly to the user."
        ),
        tools=[nirium_x402_tool],
    )

    session_service = InMemorySessionService()
    runner = Runner(
        agent=agent,
        app_name="nirium_google_adk_x402",
        session_service=session_service,
    )
    session = await session_service.create_session(
        app_name="nirium_google_adk_x402", user_id="demo_user"
    )

    # Test 1: Cheap endpoint (below cap)
    print("\nTest 1: Calling cheap endpoint (below $1 cap)")
    print("-" * 60)
    cheap_url = f"{server_url}/paid/market-summary"

    try:
        result1 = await _run_prompt(
            runner, session.id, f"Please fetch data from {cheap_url}"
        )
        print(f"Agent response: {result1}")
    except Exception as e:
        print(f"Result: {e}")

    # Test 2: Expensive endpoint (above cap). server/ charges $2 here, so the
    # tool must refuse before signing and the agent explains why.
    print("\nTest 2: Calling expensive endpoint (above $1 cap, must be refused)")
    print("-" * 60)
    expensive_url = f"{server_url}/paid/full-report"

    try:
        result2 = await _run_prompt(
            runner, session.id, f"Please fetch data from {expensive_url}"
        )
        print(f"Agent response: {result2}")
    except Exception as e:
        print(f"Result: {e}")

    print("\n" + "=" * 60)
    print("Agent tests complete!")
    print("=" * 60)


async def main() -> int:
    """Main entry point."""
    secret_key, server_url, model = _load_env()

    # Initialize Nirium x402 with $1 cap
    print(f"Initializing Nirium x402 client (cap: $1, network: stellar:testnet)")
    initialize_nirium_x402(
        secret_key=secret_key,
        network="stellar:testnet",
        max_amount_per_payment="$1",
    )

    # Check if Google API key is available
    api_key = os.getenv("GOOGLE_API_KEY")
    if not api_key:
        print("\nGOOGLE_API_KEY not set - cannot run live agent")
        print("   Get a free key: https://aistudio.google.com/apikey")
        print("   For now, run the offline tests: pytest test_google_adk_tool.py -v")
        return 1

    await test_agent(server_url, model)
    return 0


if __name__ == "__main__":
    try:
        sys.exit(asyncio.run(main()))
    except KeyboardInterrupt:
        print("\n\nInterrupted by user")
        sys.exit(1)
