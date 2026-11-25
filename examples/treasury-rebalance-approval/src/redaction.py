"""Redacción de secretos en mensajes, logs y excepciones.

La regla del ejemplo es simple: un valor ``S...`` nunca debe aparecer en
stdout, stderr, logs ni cuerpos HTTP. ``SecretRing`` conoce los secretos que
cargó este proceso y los sustituye por ``***REDACTED***``; el patrón de respaldo
cubre cualquier otro secreto Stellar que aparezca en un mensaje de terceros.
"""

from __future__ import annotations

import re
from typing import Iterable

STELLAR_SECRET_RE = re.compile(r"\bS[2-9A-HJ-NP-Z]{55}\b")
REDACTED = "***REDACTED***"


class SecretRing:
    """Registro en memoria de los secretos locales. No se imprime nunca."""

    def __init__(self, *secrets: str | None) -> None:
        self._secrets: tuple[str, ...] = tuple(
            {secret for secret in secrets if isinstance(secret, str) and secret}
        )

    def __repr__(self) -> str:
        return "SecretRing(***)"

    def add(self, secret: str) -> None:
        if secret:
            self._secrets = tuple(set(self._secrets) | {secret})

    def redact(self, text: object) -> str:
        result = str(text)
        for secret in self._secrets:
            result = result.replace(secret, REDACTED)
        return STELLAR_SECRET_RE.sub(REDACTED, result)

    def wrap(self, exc: BaseException) -> RuntimeError:
        """Convierte una excepción de terceros en un mensaje seguro."""
        return RuntimeError(self.redact(f"{type(exc).__name__}: {exc}"))


def redact_known(text: object, secrets: Iterable[str | None]) -> str:
    """Atajo para usar sin construir un ``SecretRing``."""
    return SecretRing(*secrets).redact(text)
