"""Nirium Treasury vault quickstart — Python, testnet, non-custodial.

Loop for EVERY on-chain step:
  1. Agent builds an UNSIGNED XDR — Nirium never sees a private key
  2. This process signs it locally with the caller's own testnet keypair
  3. Agent.submit_treasury_tx broadcasts the signed XDR

Run:  python quickstart.py          (needs NIRIUM_API_KEY + STELLAR_SECRET_KEY)
Tests: python -m pytest -v          (no network, no real keys)
"""

from __future__ import annotations

import asyncio
import os
from typing import Any

from nirium import Agent

from errors import explain_failure
from signing import (
    TESTNET_PASSPHRASE,
    public_key_from_secret,
    require_testnet_secret,
    resolve_testnet_passphrase,
    sign_unsigned_xdr,
)

DEFAULT_BASE_URL = "https://nirium-agent.fly.dev"
EXPLORER_TESTNET_TX = "https://stellar.expert/explorer/testnet/tx/{hash}"


def explorer_tx(tx_hash: str) -> str:
    return EXPLORER_TESTNET_TX.format(hash=tx_hash)


def _hash_of(result: dict[str, Any]) -> str:
    """Accept the common hash field names the agent may return."""
    for key in ("hash", "tx_hash", "txHash"):
        if result.get(key):
            return str(result[key])
    return ""


async def sign_and_submit(
    agent: Agent,
    xdr: str,
    secret: str,
    passphrase: str = TESTNET_PASSPHRASE,
) -> dict[str, Any]:
    """Sign an unsigned XDR locally, then submit ONLY the signed XDR.

    The secret is used here for signing and is never included in the payload.
    """
    signed_xdr = sign_unsigned_xdr(xdr, secret, passphrase)
    return await agent.submit_treasury_tx(signed_xdr)


async def run(
    agent: Agent,
    secret: str,
    *,
    asset_id: str,
    strategy_id: str,
    label: str = "usdc-blend",
    deposit_amount: str = "10000000",
    vault_id: str | None = None,
    name: str | None = None,
    symbol: str | None = None,
    passphrase: str = TESTNET_PASSPHRASE,
) -> dict[str, Any]:
    """Full non-custodial flow: deploy -> deposit -> read state -> withdraw.

    `agent` is injected so the whole flow can be tested with a mock. Only
    signed XDR ever reaches `submit_treasury_tx`; the secret stays local.
    """
    caller = public_key_from_secret(secret)
    passphrase = resolve_testnet_passphrase(passphrase)
    manager = caller  # the client keeps control (rescue / pause / revoke)
    tx_hashes: dict[str, str] = {}

    info = await agent.get_treasury_info()
    network = str((info or {}).get("network") or "")
    if network and network not in ("testnet", "stellar:testnet"):
        raise ValueError(
            f'Agent is on "{network}", not testnet. Point the agent at stellar:testnet.'
        )

    # 1/4 — deploy (or reuse an existing vault)
    if vault_id:
        print(f"1/4 reusing VAULT_ID {vault_id} (skip deploy)")
    else:
        print("1/4 deploy_treasury_vault — agent returns unsigned XDR")
        deploy = await agent.deploy_treasury_vault(
            manager=manager,
            caller=caller,
            assets=[{"address": asset_id, "strategies": [{"address": strategy_id, "name": label}]}],
            name=name or f"Quickstart {caller[-4:]}",
            symbol=(symbol or f"QS{caller[-3:]}")[:10],
        )
        deployed = await sign_and_submit(agent, deploy["xdr"], secret, passphrase)
        h = _hash_of(deployed)
        if h:
            tx_hashes["deploy"] = h
        vault_id = deployed.get("contract") or deployed.get("vault") or vault_id
        if not vault_id:
            raise ValueError("Deploy confirmed but no vault id was returned.")

    # 2/4 — deposit
    print("2/4 deposit_to_treasury_vault — agent returns unsigned XDR")
    deposit = await agent.deposit_to_treasury_vault(
        vault=vault_id,
        from_=caller,
        amounts=[deposit_amount],
        invest=False,
    )
    deposited = await sign_and_submit(agent, deposit["xdr"], secret, passphrase)
    h = _hash_of(deposited)
    if h:
        tx_hashes["deposit"] = h

    # 3/4 — read the vault state
    print("3/4 get_treasury_vault — read state after deposit")
    state = await agent.get_treasury_vault(vault_id, caller)

    # 4/4 — withdraw everything
    print("4/4 withdraw_from_treasury_vault — agent returns unsigned XDR")
    withdraw = await agent.withdraw_from_treasury_vault(vault=vault_id, from_=caller)
    withdrawn = await sign_and_submit(agent, withdraw["xdr"], secret, passphrase)
    h = _hash_of(withdrawn)
    if h:
        tx_hashes["withdraw"] = h

    return {
        "vault_id": vault_id,
        "caller": caller,
        "tx_hashes": tx_hashes,
        "explorers": {k: explorer_tx(v) for k, v in tx_hashes.items()},
        "state": state,
    }


async def main() -> None:
    secret = require_testnet_secret(os.environ.get("STELLAR_SECRET_KEY"))
    passphrase = resolve_testnet_passphrase(os.environ.get("NETWORK_PASSPHRASE"))
    base_url = (os.environ.get("NIRIUM_BASE_URL") or DEFAULT_BASE_URL).rstrip("/")
    api_key = os.environ.get("NIRIUM_API_KEY", "").strip() or None

    agent = Agent(api_url=base_url, api_key=api_key)
    print("Nirium treasury vault quickstart (testnet, non-custodial)")
    print(f"  signer:  {public_key_from_secret(secret)}")
    print(f"  agent:   {base_url}")

    try:
        result = await run(
            agent,
            secret,
            asset_id=os.environ.get("VAULT_ASSET_ID", "").strip(),
            strategy_id=os.environ.get("VAULT_STRATEGY_ID", "").strip(),
            label=os.environ.get("VAULT_ASSET", "usdc-blend").strip(),
            deposit_amount=os.environ.get("DEPOSIT_AMOUNT_STROOPS", "10000000").strip(),
            vault_id=os.environ.get("VAULT_ID", "").strip() or None,
            passphrase=passphrase,
        )
    except Exception as exc:  # explain, never dump a stack trace
        raise explain_failure(exc) from None

    print("\nDone. Transaction hashes (testnet):")
    for step, h in result["tx_hashes"].items():
        print(f"  {step}:   {h}  ->  {result['explorers'][step]}")


if __name__ == "__main__":
    try:
        asyncio.run(main())
    except Exception as exc:  # noqa: BLE001 - CLI boundary
        print(f"Error: {explain_failure(exc)}")
        raise SystemExit(1) from None
