"""Error classification and human-readable explanations for the quickstart."""

from __future__ import annotations


class QuickstartError(Exception):
    """Base error with a user-friendly message."""
    pass


class InsufficientBalanceError(QuickstartError):
    """Raised when the testnet account lacks XLM or the vault asset."""
    pass


class MissingTrustlineError(QuickstartError):
    """Raised when the vault asset trustline is missing."""
    pass


class PassphraseMismatchError(QuickstartError):
    """Raised when the network passphrase is not testnet."""
    pass


class UnfundedAccountError(QuickstartError):
    """Raised when the testnet account does not exist (needs Friendbot)."""
    pass


def is_insufficient_balance(err: Exception) -> bool:
    return isinstance(err, InsufficientBalanceError)


def is_missing_trustline(err: Exception) -> bool:
    return isinstance(err, MissingTrustlineError)


def is_passphrase_mismatch(err: Exception) -> bool:
    return isinstance(err, PassphraseMismatchError)


def is_unfunded_account(err: Exception) -> bool:
    return isinstance(err, UnfundedAccountError)


def explain_failure(exc: Exception) -> QuickstartError:
    """Convert a raw exception from the agent/Horizon into a typed QuickstartError."""
    msg = str(exc).lower()

    # Horizon / RPC errors
    if "op_underfunded" in msg or "insufficient balance" in msg:
        return InsufficientBalanceError(
            "Insufficient XLM balance. Fund your testnet account via Friendbot: "
            "https://friendbot.stellar.org?addr=<YOUR_G_ADDRESS>"
        )
    if "account not found" in msg or "not funded" in msg:
        return UnfundedAccountError(
            "Testnet account not found. Create and fund it via Friendbot: "
            "https://friendbot.stellar.org?addr=<YOUR_G_ADDRESS>"
        )
    if "trustline" in msg and "missing" in msg:
        return MissingTrustlineError(
            "Missing trustline for the vault asset. The script will attempt to open it; "
            "if that fails, visit https://testnet.blend.capital and click the faucet."
        )
    if "passphrase" in msg and ("mismatch" in msg or "mainnet" in msg or "public" in msg):
        return PassphraseMismatchError(
            "Network passphrase mismatch. Ensure NETWORK_PASSPHRASE is the Stellar testnet "
            "passphrase ('Test SDF Network ; September 2015'). Mainnet is out of scope."
        )

    # Fallback: wrap in base error
    return QuickstartError(f"Operation failed: {exc}")