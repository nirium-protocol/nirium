"""Human-readable explanations for the treasury quickstart failures.

The goal is an actionable message instead of a raw stack trace.
"""

from __future__ import annotations

import re

_INSUFFICIENT = re.compile(
    r"insufficient|underfunded|balance too low|does not have enough|"
    r"exceeds balance|not enough|not funded|tx_bad_seq|tx_insufficient_balance",
    re.IGNORECASE,
)
_TRUSTLINE = re.compile(
    r"trustline|trust line|no trust|asset not trusted|op_no_trust|untrusted",
    re.IGNORECASE,
)
_PASSPHRASE = re.compile(
    r"passphrase|wrong network|network mismatch|invalid network|tx_wrong_network",
    re.IGNORECASE,
)
_SIGNATURE = re.compile(
    r"signature|bad auth|not authorized|invalid signature|tx_bad_auth",
    re.IGNORECASE,
)


def extract_message(exc: BaseException | str) -> str:
    if isinstance(exc, str):
        return exc
    return str(exc) or exc.__class__.__name__


def explain_failure(exc: BaseException | str) -> RuntimeError:
    """Wrap a low-level error in a message a human can act on."""
    message = extract_message(exc)

    if _TRUSTLINE.search(message):
        return RuntimeError(
            "Missing USDC trustline (or the asset is not trusted by your account).\n"
            "  • Fund the account via https://friendbot.stellar.org?addr=<YOUR_G_ADDRESS>\n"
            "  • Open the Blend testnet USDC trustline before depositing.\n"
            f"Original: {message}"
        )
    if _INSUFFICIENT.search(message):
        return RuntimeError(
            "Insufficient balance for this step.\n"
            "  • Deploy needs testnet XLM for fees / contract creation — use Friendbot:\n"
            "    https://friendbot.stellar.org?addr=<YOUR_G_ADDRESS>\n"
            "  • Deposit needs testnet USDC; mint it at https://testnet.blend.capital\n"
            f"Original: {message}"
        )
    if _PASSPHRASE.search(message):
        return RuntimeError(
            "Wrong network passphrase. This quickstart is testnet-only and must use:\n"
            '  "Test SDF Network ; September 2015".\n'
            f"Original: {message}"
        )
    if _SIGNATURE.search(message):
        return RuntimeError(
            "The signature was rejected. Check that:\n"
            "  • the XDR was signed with the account that the operation expects as caller/from,\n"
            "  • the signature was produced with the TESTNET passphrase,\n"
            "  • the account sequence number is still current (retry with a fresh XDR).\n"
            f"Original: {message}"
        )
    return RuntimeError(message)


def is_insufficient_balance(exc: BaseException | str) -> bool:
    return bool(_INSUFFICIENT.search(extract_message(exc)))


def is_trustline_error(exc: BaseException | str) -> bool:
    return bool(_TRUSTLINE.search(extract_message(exc)))


def is_passphrase_mismatch(exc: BaseException | str) -> bool:
    return bool(_PASSPHRASE.search(extract_message(exc)))


def is_signature_error(exc: BaseException | str) -> bool:
    return bool(_SIGNATURE.search(extract_message(exc)))
