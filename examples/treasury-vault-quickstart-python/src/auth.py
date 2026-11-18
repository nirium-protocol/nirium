"""API key resolution for the quickstart.

The Nirium Agent can work with a public demo token (no account needed) or a personal
API key. This module resolves the key and attaches the Bearer header if it's a JWT.
"""

from __future__ import annotations

import base64
import json
import os
import urllib.request

DEFAULT_BASE_URL = "https://nirium-agent.fly.dev"
DEMO_TOKEN_URL = "https://nirium-agent.fly.dev/demo-token"


def _looks_like_jwt(token: str) -> bool:
    parts = token.split(".")
    if len(parts) != 3:
        return False
    try:
        payload = parts[1] + "=" * (-len(parts[1]) % 4)
        json.loads(base64.urlsafe_b64decode(payload))
        return True
    except Exception:
        return False


async def resolve_api_key(base_url: str, caller: str) -> str:
    """Return an API key for the caller.

    Tries the environment variable first, then falls back to the public demo token.
    The demo token is a short-lived JWT scoped to the caller's G-address.
    """
    env_key = os.environ.get("NIRIUM_API_KEY", "").strip()
    if env_key:
        return env_key

    url = f"{DEMO_TOKEN_URL}?address={caller}"
    try:
        req = urllib.request.Request(url, method="GET")
        req.add_header("Accept", "application/json")
        with urllib.request.urlopen(req, timeout=15) as resp:
            data = json.loads(resp.read().decode("utf-8"))
        return data.get("token", "")
    except Exception as exc:
        raise RuntimeError(
            f"Could not obtain a demo token from {DEMO_TOKEN_URL}. "
            f"Set NIRIUM_API_KEY in .env or ensure the demo endpoint is reachable. "
            f"Original error: {exc}"
        )


def attach_bearer_if_jwt(api_key: str, base_url: str) -> None:
    """If the API key is a JWT, store it for the Agent to use as Bearer token.

    The Agent class reads the Authorization header from the api_key if it looks
    like a JWT (three dot-separated base64url parts).
    """
    # The Agent class handles this internally when api_key is passed.
    # This function exists for API compatibility with the TypeScript example.
    if _looks_like_jwt(api_key):
        pass  # Agent will use it as Bearer