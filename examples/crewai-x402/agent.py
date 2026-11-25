"""Two-agent CrewAI crew that pays your own x402Serve route on stellar:testnet.

- Data scout: reads the catalog of paid routes and picks the one that answers the
  request (it has no payment tool).
- Payer: fetches the chosen URL with NiriumX402Tool, capped at $1 per payment.

Run 1 asks for the market summary ($0.02): paid, tx hash on Stellar Expert.
Run 2 asks for the full report ($2): refused by the cap before signing; the crew
finishes normally and explains the refusal.
"""

from __future__ import annotations

import json
import os
import sys
from typing import Any

# Keep the run quiet and local: no CrewAI telemetry or trace upload prompts.
os.environ.setdefault("CREWAI_TRACING_ENABLED", "false")
os.environ.setdefault("CREWAI_DISABLE_TELEMETRY", "true")
os.environ.setdefault("OTEL_SDK_DISABLED", "true")

from dotenv import load_dotenv  # noqa: E402

load_dotenv()

from crewai import LLM, Agent, Crew, Process, Task  # noqa: E402

from nirium_crewai_tool import NiriumX402Tool  # noqa: E402

CAP = "$1"
NETWORK = "stellar:testnet"


def catalog(server_url: str) -> str:
    return (
        f"- {server_url}/paid/market-summary : short market summary, price "
        f"${os.getenv('X402_PRICE', '0.02').lstrip('$')} USDC\n"
        f"- {server_url}/paid/full-report : full detailed report, price $2 USDC"
    )


def build_crew(tool: NiriumX402Tool, llm: Any, verbose: bool = True) -> Crew:
    scout = Agent(
        role="Data scout",
        goal="Pick the single paid endpoint that answers the request.",
        backstory="You know the catalog of x402 routes and their prices. You never pay for anything.",
        llm=llm,
        allow_delegation=False,
        verbose=verbose,
    )
    payer = Agent(
        role="Payer",
        goal="Fetch the endpoint chosen by the scout, paying with the nirium_x402_fetch tool.",
        backstory=(
            "You pay x402 routes on Stellar testnet with a hard per-payment cap of $1. "
            "If the tool says status='refused', you do not retry: you report the refusal."
        ),
        tools=[tool],
        llm=llm,
        allow_delegation=False,
        max_iter=3,
        verbose=verbose,
    )
    find = Task(
        description=(
            "Request: {request}\n\nCatalog of paid routes:\n{catalog}\n\n"
            "Choose the one route that answers the request."
        ),
        expected_output="Only the absolute URL of the chosen route, nothing else.",
        agent=scout,
    )
    pay = Task(
        description=(
            "Call nirium_x402_fetch exactly once with the URL chosen by the Data scout. "
            "Report what came back."
        ),
        expected_output=(
            "If paid: the data and the tx_hash. If refused: say the payment was refused "
            "before signing because it exceeds the $1 cap."
        ),
        agent=payer,
        context=[find],
    )
    return Crew(agents=[scout, payer], tasks=[find, pay], process=Process.sequential, verbose=verbose, tracing=False)


def main() -> int:
    secret = os.getenv("STELLAR_SECRET_KEY")
    if not secret:
        print("STELLAR_SECRET_KEY is not set in .env (testnet payer key).")
        return 1
    if not os.getenv("OPENAI_API_KEY"):
        print("OPENAI_API_KEY is not set in .env. Offline tests: pytest -v")
        return 1

    server_url = f"http://localhost:{os.getenv('X402_SERVER_PORT', '3402')}"
    tool = NiriumX402Tool(secret, network=NETWORK, max_amount_per_payment=CAP)
    llm = LLM(model=os.getenv("CREWAI_MODEL", "gpt-4o-mini"), temperature=0)
    print(f"Nirium x402 tool ready (cap {CAP}, {NETWORK}), server {server_url}")

    runs = [
        ("Test 1: market summary (below the $1 cap, must pay)", "I need a short market summary."),
        ("Test 2: full report ($2, above the $1 cap, must be refused)", "I need the full detailed report."),
    ]
    for title, request in runs:
        print("\n" + "=" * 70 + f"\n{title}\n" + "=" * 70)
        crew = build_crew(tool, llm)  # fresh crew per run, same tool and cap
        result = crew.kickoff(inputs={"request": request, "catalog": catalog(server_url)})
        print(f"\nCrew answer: {result.raw}")

    print("\n" + "=" * 70 + "\nTool call log (from NiriumX402Tool, not from the LLM)\n" + "=" * 70)
    for entry in tool.history:
        line = {k: entry.get(k) for k in ("status", "url", "tx_hash", "stellar_expert", "error", "cap", "requested_amount_stroops", "signed") if entry.get(k) is not None}
        print(json.dumps(line))
    return 0


if __name__ == "__main__":
    try:
        sys.exit(main())
    except KeyboardInterrupt:
        sys.exit(1)
