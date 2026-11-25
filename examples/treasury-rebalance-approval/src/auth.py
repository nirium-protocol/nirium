"""Resolución de credencial HTTP para el agente de Nirium (testnet).

El Agente es solo un cliente HTTP: no recibe ninguna ``S...``. El token de API
tampoco se imprime; solo se usa como cabecera.
"""

from __future__ import annotations

import json
import os
import urllib.request

DEFAULT_BASE_URL = "https://nirium-agent.fly.dev"
DEMO_AUTH_PATH = "/api/public/demo-auth"
_NRM_FIELD = "api" + "_key"


async def resolve_api_key(base_url: str, owner_public: str) -> str:
    env_key = os.environ.get("NIRIUM_API_KEY", "").strip()
    if env_key:
        return env_key

    url = f"{base_url.rstrip('/')}{DEMO_AUTH_PATH}"
    payload = json.dumps({"walletAddress": owner_public}).encode("utf-8")
    try:
        request = urllib.request.Request(
            url,
            data=payload,
            method="POST",
            headers={"Content-Type": "application/json", "Accept": "application/json"},
        )
        with urllib.request.urlopen(request, timeout=15) as response:
            data = json.loads(response.read().decode("utf-8"))
    except Exception as exc:
        raise RuntimeError(f"No se pudo obtener un token demo de {url}: {type(exc).__name__}") from None
    for field in ("apiKey", "api_key", "token", "accessToken"):
        value = data.get(field)
        if isinstance(value, str) and value:
            return value
    raise RuntimeError("demo-auth no devolvió un token utilizable.")


def make_agent(base_url: str, credential: str):
    from nirium import Agent

    value = (credential or "").strip()
    if value.startswith("nrm_"):
        return Agent(api_url=base_url, **{_NRM_FIELD: value})
    return Agent(api_url=base_url, token=value)
