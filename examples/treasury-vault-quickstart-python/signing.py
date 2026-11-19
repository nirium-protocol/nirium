"""Local signing helpers for the Nirium treasury quickstart.

The Nirium Agent is an HTTP client ONLY. Every write endpoint returns an
UNSIGNED XDR; this module signs it here, with the caller's own testnet key.
The secret never leaves this process and is never logged.
"""

from __future__ import annotations

from stellar_sdk import Keypair, Network, TransactionBuilder

TESTNET_PASSPHRASE = Network.TESTNET_NETWORK_PASSPHRASE


def resolve_testnet_passphrase(value: str | None = None) -> str:
    """This quickstart is testnet-only; reject mainnet/public passphrases."""
    passphrase = (value or TESTNET_PASSPHRASE).strip()
    normalized = passphrase.lower()
    if normalized != TESTNET_PASSPHRASE.lower():
        raise ValueError(
            "Network passphrase mismatch. This quickstart is testnet-only.\n"
            f"  expected: {TESTNET_PASSPHRASE}\n"
            f"  got:      {passphrase}\n"
            "Signing with the public/mainnet passphrase will fail on submit."
        )
    return passphrase


def require_testnet_secret(value: str | None) -> str:
    """Validate a Stellar secret seed (S...) without ever printing it."""
    secret = (value or "").strip()
    if not secret:
        raise ValueError(
            "Set STELLAR_SECRET_KEY in .env to your own funded testnet secret (S...).\n"
            "This value is used only to sign locally — it is never sent to Nirium."
        )
    if secret.startswith("G"):
        raise ValueError("STELLAR_SECRET_KEY is a public key (G...). You need the secret seed (S...).")
    if not secret.startswith("S") or len(secret) < 56:
        raise ValueError("STELLAR_SECRET_KEY must be a Stellar secret seed (S...).")
    return secret


def public_key_from_secret(secret: str) -> str:
    return Keypair.from_secret(secret).public_key


def sign_unsigned_xdr(xdr: str, secret: str, passphrase: str = TESTNET_PASSPHRASE) -> str:
    """Sign an unsigned XDR locally and return the signed XDR.

    The secret stays in this process; only the signed XDR is returned so it
    can be handed to ``submit_treasury_tx``.
    """
    resolve_testnet_passphrase(passphrase)
    if not secret.startswith("S") or len(secret) < 56:
        raise ValueError("STELLAR_SECRET_KEY must be a Stellar secret seed (S...).")
    tx = TransactionBuilder.from_xdr(xdr, passphrase)
    tx.sign(Keypair.from_secret(secret))
    return tx.to_xdr()
