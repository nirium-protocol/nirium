
"""Claude Messages API agent using Nirium x402 tool."""

import asyncio
import json
import os

from anthropic import AsyncAnthropic
from dotenv import load_dotenv

from nirium_claude_tool import (
    initialize_nirium_x402,
    nirium_x402_fetch,
)

TOOL = {
    "name": "nirium_x402_fetch",
    "description": (
        "Fetch an x402-protected HTTP endpoint using Nirium "
        "on Stellar testnet. Payments above the configured cap "
        "are refused before signing."
    ),
    "input_schema": {
        "type": "object",
        "properties": {
            "url": {
                "type": "string",
                "description": "Absolute URL of the paid endpoint.",
            },
            "method": {
                "type": "string",
                "enum": ["GET", "POST"],
            },
        },
        "required": ["url"],
    },
}


async def run_agent(client, prompt):
    messages = [{"role": "user", "content": prompt}]

    for _ in range(5):
        response = await client.messages.create(
            model=os.getenv(
                "CLAUDE_MODEL",
                "claude-3-5-haiku-20241022",
            ),
            max_tokens=1200,
            system=(
                "You are a payment-enabled assistant. "
                "Use the provided tool for paid requests. "
                "Explain payment refusals clearly. Never claim "
                "a payment succeeded unless the tool confirms it."
            ),
            tools=[TOOL],
            messages=messages,
        )

        messages.append({
            "role": "assistant",
            "content": response.content,
        })

        tool_calls = [
            block for block in response.content
            if block.type == "tool_use"
        ]

        if not tool_calls:
            for block in response.content:
                if block.type == "text":
                    print(block.text)
            return

        results = []

        for call in tool_calls:
            if call.name != "nirium_x402_fetch":
                result = json.dumps({
                    "status": "error",
                    "message": "Unknown tool.",
                })
            else:
                result = await nirium_x402_fetch(
                    url=call.input["url"],
                    method=call.input.get("method", "GET"),
                )

            data = json.loads(result)

            results.append({
                "type": "tool_result",
                "tool_use_id": call.id,
                "content": result,
                "is_error": data.get("status") in ("error", "refused"),
            })

        messages.append({
            "role": "user",
            "content": results,
        })

    print("Agent stopped after reaching the tool-call limit.")


async def main():
    load_dotenv()

    secret = os.getenv("STELLAR_SECRET_KEY")
    api_key = os.getenv("ANTHROPIC_API_KEY")

    if not secret or not api_key:
        raise SystemExit(
            "Set STELLAR_SECRET_KEY and ANTHROPIC_API_KEY in .env"
        )

    initialize_nirium_x402(
        secret_key=secret,
        network="stellar:testnet",
        max_amount_per_payment="$1",
    )

    client = AsyncAnthropic(api_key=api_key)

    print("\n--- Test 1: Payment below cap ---")
    await run_agent(
        client,
        "Fetch the market summary from "
        "http://localhost:3402/paid/market-summary",
    )

    print("\n--- Test 2: Payment above cap ---")
    await run_agent(
        client,
        "Fetch the full report from "
        "http://localhost:3402/paid/full-report",
        )


if __name__ == "__main__":
    asyncio.run(main())
