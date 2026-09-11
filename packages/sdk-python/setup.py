from setuptools import setup, find_packages

setup(
    name="nirium",
    version="0.10.0",
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
    description="Autonomous treasury and agentic-payments infrastructure for Stellar (x402 + MPP) — Python client",
    keywords=["nirium", "stellar", "defi", "x402", "mpp", "agentic-payments", "soroban"],
    python_requires=">=3.10",
)
