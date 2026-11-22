"""Firma local, nunca dentro del ``Agent`` de Nirium.

El SDK construye XDR sin firmar. Las claves ``owner`` y ``manager`` se leen de
variables de entorno, se usan aquí para firmar en esta máquina y no se envían
nunca en un cuerpo HTTP ni se imprimen.

``stellar-sdk`` se importa de forma diferida para que el modo ``--demo`` funcione
sin dependencias de red ni de Stellar.
"""

from __future__ import annotations

import os
from typing import Protocol

from src.errors import ConfigurationError
from src.redaction import SecretRing

TESTNET_PASSPHRASE = "Test SDF Network ; September 2015"
PUBLIC_PASSPHRASE = "Public Global Stellar Network ; September 2015"


class Signer(Protocol):
    public_key: str

    def sign(self, xdr: str) -> str:
        ...


class FakeSigner:
    """Firmante determinista para el demo offline y los tests. Sin secretos."""

    def __init__(self, public_key: str) -> None:
        self.public_key = public_key
        self.signed_xdrs: list[str] = []

    def __repr__(self) -> str:
        return f"FakeSigner({self.public_key})"

    def sign(self, xdr: str) -> str:
        self.signed_xdrs.append(xdr)
        return f"SIGNED:{xdr}"


class StellarSigner:
    """Firma XDR con una clave Stellar local, solo bajo passphrase de testnet."""

    __repr__ = False

    def __init__(
        self,
        secret: str,
        ring: SecretRing,
        passphrase: str = TESTNET_PASSPHRASE,
    ) -> None:
        if passphrase != TESTNET_PASSPHRASE:
            raise ConfigurationError("Solo se permite la passphrase de Stellar testnet.")
        try:
            from stellar_sdk import Keypair
        except ImportError as exc:  # pragma: no cover - dependencia opcional en demo
            raise ConfigurationError("stellar-sdk no está instalado (pip install -r requirements.txt).") from exc
        try:
            self._keypair = Keypair.from_secret(secret)
        except Exception as exc:
            raise ring.wrap(exc) from None
        self._secret = secret
        self.public_key = self._keypair.public_key
        self._passphrase = passphrase
        self._ring = ring
        self.signed_xdrs: list[str] = []

    def sign(self, xdr: str) -> str:
        try:
            from stellar_sdk import TransactionEnvelope
        except ImportError as exc:  # pragma: no cover
            raise ConfigurationError("stellar-sdk no está instalado.") from exc
        try:
            envelope = TransactionEnvelope.from_xdr(xdr, self._passphrase)
            envelope.sign(self._keypair)
            signed = envelope.to_xdr()
        except Exception as exc:
            raise self._ring.wrap(exc) from None
        self.signed_xdrs.append(xdr)
        return signed


def resolve_testnet_passphrase(passphrase: str | None) -> str:
    if passphrase is None or not passphrase.strip():
        return TESTNET_PASSPHRASE
    if passphrase.strip() == TESTNET_PASSPHRASE:
        return TESTNET_PASSPHRASE
    raise ConfigurationError(
        "NETWORK_PASSPHRASE debe ser la de Stellar testnet; mainnet está fuera de alcance."
    )


def load_signer(env_var: str, ring: SecretRing) -> StellarSigner:
    """Carga una ``S...`` local. Nunca la incluye en el error."""
    secret = os.environ.get(env_var, "").strip()
    if not secret:
        raise ConfigurationError(f"{env_var} no está configurada (usa .env local).")
    if not secret.startswith("S"):
        raise ConfigurationError(f"{env_var} debe ser una clave secreta Stellar (S...).")
    ring.add(secret)
    return StellarSigner(secret, ring)
