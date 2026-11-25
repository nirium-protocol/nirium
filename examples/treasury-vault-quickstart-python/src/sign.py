"""Signing helpers for the non-custodial treasury vault quickstart.

Every on-chain step follows the same pattern:
1. Agent builds an UNSIGNED XDR
2. This process signs it with YOUR testnet keypair (stellar-sdk)
3. Agent.submit_treasury_tx broadcasts the signed XDR

The SDK's Agent is used only as an HTTP client. Signing happens here,
with stellar-sdk, against the testnet passphrase.
"""

from __future__ import annotations

import os

from stellar_sdk import Keypair, Network

TESTNET_PASSPHRASE = Network.TESTNET_NETWORK_PASSPHRASE


def resolve_testnet_passphrase(passphrase: str | None) -> str:
    """Return the testnet passphrase, raising if the user supplied mainnet."""
    if passphrase is None or passphrase.strip() == "":
        return TESTNET_PASSPHRASE
    if passphrase.strip() == TESTNET_PASSPHRASE:
        return TESTNET_PASSPHRASE
    raise ValueError(
        f"Passphrase mismatch: expected Stellar testnet passphrase "
        f"('{TESTNET_PASSPHRASE}'), got '{passphrase}'. "
        f"Mainnet is out of scope for this example."
    )


def public_key_from_secret(secret: str) -> str:
    """Derive the public G-address from a testnet S-secret."""
    return Keypair.from_secret(secret).public_key


def sign_unsigned_xdr(xdr: str, secret: str, passphrase: str) -> str:
    """Sign an unsigned XDR with the caller's secret key.

    The XDR must have been built for the testnet passphrase. We refuse to sign
    under the public passphrase to prevent accidental mainnet signatures.
    """
    if passphrase != TESTNET_PASSPHRASE:
        raise ValueError("sign_unsigned_xdr: passphrase must be Stellar testnet")

    keypair = Keypair.from_secret(secret)
    from stellar_sdk import TransactionEnvelope

    envelope = TransactionEnvelope.from_xdr(xdr, passphrase)
    envelope.sign(keypair)
    return envelope.to_xdr()


def require_testnet_secret() -> str:
    """Read STELLAR_SECRET_KEY from env, validate it is a testnet S-key."""
    secret = os.environ.get("STELLAR_SECRET_KEY", "").strip()
    if not secret:
        raise RuntimeError(
            "STELLAR_SECRET_KEY is not set. "
            "Create a .env file from .env.example with your own testnet S... key. "
            "Never use a Nirium key, never mainnet."
        )
    if not secret.startswith("S"):
        raise RuntimeError("STELLAR_SECRET_KEY must be a Stellar testnet secret (starts with S).")
    return secret