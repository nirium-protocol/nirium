"""Treasury flow helpers that keep the secret on this machine.

The Nirium ``Agent`` is used as a pure HTTP client: it builds unsigned XDRs and
broadcasts signed ones. These helpers make that boundary explicit, so the
"secret never leaves the machine" guarantee is easy to test with the HTTP layer
mocked (see ``test/request_body_test.py``).
"""

from __future__ import annotations

from typing import Any, Dict, Optional

from src.sign import sign_unsigned_xdr


async def build_deploy(
    agent: Any,
    *,
    manager: str,
    caller: str,
    asset: str,
    strategy: str,
    name: str,
    symbol: str,
    label: str = "usdc-blend",
) -> Dict[str, Any]:
    """Ask the agent to build an unsigned deploy XDR."""
    return await agent.deploy_treasury_vault(
        manager=manager,
        caller=caller,
        assets=[{"address": asset, "strategies": [{"address": strategy, "name": label}]}],
        name=name,
        symbol=symbol,
    )


async def build_deposit(
    agent: Any,
    *,
    vault: str,
    caller: str,
    amounts: Any,
    invest: bool,
) -> Dict[str, Any]:
    """Ask the agent to build an unsigned deposit XDR."""
    return await agent.deposit_to_treasury_vault(
        vault=vault,
        from_=caller,
        amounts=[str(a) for a in amounts],
        invest=invest,
    )


async def build_withdraw(
    agent: Any,
    *,
    vault: str,
    caller: str,
    shares: Optional[Any] = None,
) -> Dict[str, Any]:
    """Ask the agent to build an unsigned withdraw XDR.

    Omit ``shares`` to withdraw everything.
    """
    payload: Dict[str, Any] = {"vault": vault, "from_": caller}
    if shares is not None:
        payload["shares"] = str(shares)
    return await agent.withdraw_from_treasury_vault(**payload)


async def sign_and_submit(
    agent: Any,
    built: Dict[str, Any],
    secret: str,
    passphrase: str,
) -> Dict[str, Any]:
    """Sign an API-built XDR locally, then broadcast ONLY the signed XDR.

    The only value sent to the API here is the signed XDR string; the S... secret
    is never part of a request body.
    """
    signed_xdr = sign_unsigned_xdr(built["xdr"], secret, passphrase)
    return await agent.submit_treasury_tx(signed_xdr)


def tx_hash(result: Dict[str, Any]) -> Optional[str]:
    """Extract a transaction hash from a submit response."""
    return result.get("hash") or result.get("transaction_hash")


def vault_id(submit_result: Dict[str, Any]) -> Optional[str]:
    """Extract a vault id from a deploy submit response."""
    return submit_result.get("vault") or submit_result.get("vault_id") or submit_result.get("contract")


def explorer_tx(hash: Optional[str]) -> str:
    """Stellar Expert (testnet) link for a transaction hash."""
    if not hash:
        return "(no hash returned by the agent)"
    return f"https://stellar.expert/explorer/testnet/tx/{hash}"
