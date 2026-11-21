"""Tests for the signing and error helpers (no network)."""

from __future__ import annotations

import os
from unittest.mock import patch, MagicMock

from stellar_sdk import Keypair, Network, TransactionBuilder, Operation, Asset, TransactionEnvelope

import sys
sys.path.insert(0, os.path.join(os.path.dirname(__file__), "..", "src"))

from src.sign import (
    resolve_testnet_passphrase,
    public_key_from_secret,
    sign_unsigned_xdr,
    TESTNET_PASSPHRASE,
)
from src.errors import (
    explain_failure,
    is_insufficient_balance,
    is_missing_trustline,
    is_passphrase_mismatch,
    is_unfunded_account,
    QuickstartError,
    InsufficientBalanceError,
    MissingTrustlineError,
    PassphraseMismatchError,
    UnfundedAccountError,
)


def unsigned_payment_xdr(secret: str, passphrase: str) -> str:
    from stellar_sdk import Account
    keypair = Keypair.from_secret(secret)
    account = TransactionBuilder(
        source_account=Account(keypair.public_key, 0),
        network_passphrase=passphrase,
        base_fee=100,
    )
    tx = account.append_payment_op(
        destination=keypair.public_key,
        asset=Asset.native(),
        amount="1",
    ).set_timeout(30).build()
    return tx.to_xdr()


def test_resolve_testnet_passphrase_accepts_testnet():
    assert resolve_testnet_passphrase(TESTNET_PASSPHRASE) == TESTNET_PASSPHRASE
    assert resolve_testnet_passphrase(None) == TESTNET_PASSPHRASE
    assert resolve_testnet_passphrase("") == TESTNET_PASSPHRASE


def test_resolve_testnet_passphrase_rejects_public():
    try:
        resolve_testnet_passphrase(Network.PUBLIC_NETWORK_PASSPHRASE)
        assert False, "should have raised"
    except ValueError as e:
        assert "passphrase mismatch" in str(e).lower()


def test_public_key_from_secret():
    secret = Keypair.random().secret
    pk = public_key_from_secret(secret)
    assert pk.startswith("G")
    assert len(pk) == 56


def test_sign_unsigned_xdr_signs_testnet_xdr():
    secret = Keypair.random().secret
    xdr = unsigned_payment_xdr(secret, TESTNET_PASSPHRASE)
    signed = sign_unsigned_xdr(xdr, secret, TESTNET_PASSPHRASE)

    # Verify the signed envelope has exactly one signature
    envelope = TransactionEnvelope.from_xdr(signed, TESTNET_PASSPHRASE)
    assert len(envelope.signatures) == 1


def test_sign_unsigned_xdr_refuses_public_passphrase():
    secret = Keypair.random().secret
    xdr = unsigned_payment_xdr(secret, TESTNET_PASSPHRASE)
    try:
        sign_unsigned_xdr(xdr, secret, Network.PUBLIC_NETWORK_PASSPHRASE)
        assert False, "should have raised"
    except ValueError as e:
        assert "passphrase" in str(e).lower()


def test_explain_failure_classifies_insufficient_balance():
    err = explain_failure(Exception("op_underfunded: account does not have enough XLM"))
    assert isinstance(err, InsufficientBalanceError)
    assert is_insufficient_balance(err)
    assert "Friendbot" in str(err)


def test_explain_failure_classifies_unfunded_account():
    err = explain_failure(Exception("account not found"))
    assert isinstance(err, UnfundedAccountError)
    assert is_unfunded_account(err)
    assert "Friendbot" in str(err)


def test_explain_failure_classifies_missing_trustline():
    err = explain_failure(Exception("trustline missing"))
    assert isinstance(err, MissingTrustlineError)
    assert is_missing_trustline(err)
    assert "trustline" in str(err).lower()


def test_explain_failure_classifies_passphrase_mismatch():
    err = explain_failure(Exception("passphrase mismatch: mainnet vs testnet"))
    assert isinstance(err, PassphraseMismatchError)
    assert is_passphrase_mismatch(err)
    assert "testnet" in str(err).lower()


def test_explain_failure_wraps_unknown():
    err = explain_failure(Exception("something completely different"))
    assert isinstance(err, QuickstartError)
    assert "something completely different" in str(err)