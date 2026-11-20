"""API key resolution for the quickstart.

Deploy/deposit/withdraw require auth. A first-time reader should not need an
institutional key: the public demo-auth endpoint issues a short-lived token from
the caller's own G-address (same flow as the TypeScript quickstart).
"""

from __future__ import annotations

import base64
import json
import os
import urllib.request

DEFAULT_BASE_URL = "https://nirium-agent.fly.dev"
DEMO_AUTH_PATH = "/api/public/demo-auth"


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

    Tries the environment variable first, then falls back to the public
    demo-auth token scoped to the caller's G-address.
    """
    env_key = os.environ.get("NIRIUM_API_KEY", "").strip()
    if env_key:
        return env_key

    url = f"{base_url.rstrip('/')}{DEMO_AUTH_PATH}"
    payload = json.dumps({"walletAddress": caller}).encode("utf-8")
    try:
        req = urllib.request.Request(
            url,
            data=payload,
            method="POST",
            headers={"Content-Type": "application/json", "Accept": "application/json"},
        )
        with urllib.request.urlopen(req, timeout=15) as resp:
            data = json.loads(resp.read().decode("utf-8"))
        for field in ("apiKey", "api_key", "token", "accessToken"):
            key = data.get(field)
            if isinstance(key, str) and key:
                return key
        raise RuntimeError("demo-auth did not return a token")
    except Exception as exc:
        raise RuntimeError(
            f"Could not obtain a demo token from {url}. "
            f"Set NIRIUM_API_KEY in .env or ensure the demo endpoint is reachable. "
            f"Original error: {exc}"
        )


def attach_bearer_if_jwt(api_key: str, base_url: str) -> None:
    """Whether the key is a JWT. The Agent sets x-api-key; keep API compatibility."""
    return _looks_like_jwt(api_key)


def make_agent(base_url: str, credential: str):
    """Build the SDK Agent with the correct auth header for the credential type.

    The public demo-auth endpoint returns a JWT, which the treasury API accepts
    only as ``Authorization: Bearer <token>``. In the SDK that header is set when
    the value is passed via ``token=``; ``api_key=`` always sets ``x-api-key``.
    Real ``nrm_...`` keys keep using ``api_key=`` for backwards compatibility.
    """
    from nirium import Agent

    cred = (credential or "").strip()
    if cred.startswith("nrm_"):
        return Agent(api_url=base_url, api_key=cred)
    return Agent(api_url=base_url, token=cred)
