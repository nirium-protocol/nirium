from setuptools import setup, find_packages

setup(
    name="nirium",
    version="0.12.9",
    package_dir={"": "src"},
    packages=find_packages(where="src"),
    install_requires=[
        "websockets>=13.0",
        "aiohttp>=3.9.0",
        "stellar-sdk>=11.0.0,<16.0.0",
    ],
    extras_require={
        "langchain": ["langchain-core>=0.3.0"],
        "test": [
            "pytest>=8.0.0",
            "pytest-asyncio>=0.23.0",
            "langchain-core>=0.3.0",
        ],
    },
    author="Nirium Team",
    description="Pay per request in USDC on Stellar (x402) from Python and AI agents, with a spending cap and receipts anyone can verify. Non-custodial.",
    keywords=["stellar", "x402", "usdc", "payments", "pay-per-request", "ai-agents", "agentic-payments", "receipts", "audit-trail"],
    python_requires=">=3.10",
)
