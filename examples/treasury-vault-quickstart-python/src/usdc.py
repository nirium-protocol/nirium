"""Blend USDC trustline and balance helpers for testnet."""

from __future__ import annotations

import os
import urllib.request

from stellar_sdk import Asset, Keypair, TransactionBuilder, Network, Server

from src.errors import InsufficientBalanceError, UnfundedAccountError

# Blend testnet USDC (not Circle USDC)
USDC_CONTRACT = "CAQCFVLOBK5GIULPNZRGATJJMIZL5BSP7X5YJVMGCPTUEPFM4AVSRCJU"
USDC_ASSET_CODE = "USDC"
BLEND_USDC_ISSUER = "GATALTGTWIOT6BUDBCZM3Q4OQ4BO2COLOAZ7IYSKPLC2PMSOPPGF5V56"

# For classic Stellar assets (not Soroban), the issuer is different.
# This example uses the Soroban USDC contract on testnet.
# We'll just check the classic asset balance as a proxy since Soroban
# balance requires RPC simulation.

HORIZON_TESTNET = "https://horizon-testnet.stellar.org"
FRIENDBOT = "https://friendbot.stellar.org"


def _horizon_server() -> Server:
    return Server(horizon_url=HORIZON_TESTNET)


def _account_balances(server: Server, public_key: str) -> list[dict]:
    """Real balances from Horizon's account endpoint.

    `server.load_account()` returns an `Account` with only `.sequence`; it has
    NO `.balances` in stellar_sdk 15.x. Balances live in the account response.
    """
    data = server.accounts().account_id(public_key).call()
    return [b for b in (data.get("balances") or []) if isinstance(b, dict)]


async def usdc_balance(public_key: str) -> int:
    """Return the USDC balance in stroops (smallest unit) for the account."""
    # For Soroban contracts we'd need RPC simulation. As a proxy,
    # check the classic asset balance if it exists.
    server = _horizon_server()
    for bal in _account_balances(server, public_key):
        if bal.get("asset_type") != "native":
            if (
                bal.get("asset_code") == USDC_ASSET_CODE
                and bal.get("asset_issuer") == BLEND_USDC_ISSUER
            ):
                return int(float(bal.get("balance", "0")) * 10_000_000)
    return 0


async def ensure_usdc_trustline(secret: str, public_key: str) -> str | None:
    """Ensure the account has a USDC trustline. Returns the tx hash if created."""
    server = _horizon_server()
    account = server.load_account(public_key)

    for bal in _account_balances(server, public_key):
        if (
            bal.get("asset_type") != "native"
            and bal.get("asset_code") == USDC_ASSET_CODE
            and bal.get("asset_issuer") == BLEND_USDC_ISSUER
        ):
            return None  # already has trustline

    keypair = Keypair.from_secret(secret)
    # Blend testnet USDC issuer — NOT Circle. Mirrors the TypeScript quickstart.
    usdc_asset = Asset(USDC_ASSET_CODE, BLEND_USDC_ISSUER)

    tx = (
        TransactionBuilder(
            source_account=account,
            network_passphrase=Network.TESTNET_NETWORK_PASSPHRASE,
            base_fee=100,
        )
        .append_change_trust_op(asset=usdc_asset)
        .set_timeout(30)
        .build()
    )
    tx.sign(keypair)
    resp = server.submit_transaction(tx)
    return resp.get("hash")


def required_usdc(deposit_amount_stroops: str) -> int:
    """Return the required USDC balance in stroops for the deposit."""
    return int(deposit_amount_stroops)


def missing_usdc_error(have: int, need: int) -> str:
    return (
        f"Insufficient USDC balance: have {have} stroops, need {need} stroops. "
        "Get testnet USDC from the Blend faucet: https://testnet.blend.capital"
    )


def pick_asset(info: dict) -> tuple[str, str, str]:
    """Pick the vault asset from treasury info. Returns (asset, strategy, label)."""
    defindex = info.get("defindex", {})
    choice = os.environ.get("VAULT_ASSET", "usdc").strip().lower()
    usdc = defindex.get("usdc")
    strategies = defindex.get("strategies", {})
    usdc_blend = strategies.get("usdcBlend")

    if choice == "cetes":
        cetes = defindex.get("cetes")
        cetes_blend = strategies.get("cetesBlend")
        if cetes and cetes_blend:
            return cetes, cetes_blend, "cetes-blend"
        raise RuntimeError("CETES not available in treasury info")
    if choice != "usdc":
        raise RuntimeError(f"VAULT_ASSET must be 'usdc' or 'cetes', got '{choice}'.")
    if usdc and usdc_blend:
        return usdc, usdc_blend, "usdc-blend"
    raise RuntimeError("No supported vault asset found in treasury info")


async def preflight_xlm(public_key: str, min_xlm: int = 10) -> None:
    """Ensure the account has at least min_xlm stroops of XLM."""
    server = _horizon_server()
    for bal in _account_balances(server, public_key):
        if bal.get("asset_type") == "native":
            xlm = int(float(bal.get("balance", "0")) * 10_000_000)
            if xlm < min_xlm:
                raise InsufficientBalanceError(
                    f"Insufficient XLM for fees: have {xlm} stroops, need at least {min_xlm}. "
                    f"Fund via Friendbot: {FRIENDBOT}?addr={public_key}"
                )
            return
    raise UnfundedAccountError(
        f"Account {public_key} not found on testnet. "
        f"Fund via Friendbot: {FRIENDBOT}?addr={public_key}"
    )
