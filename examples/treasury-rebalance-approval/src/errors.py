"""Errores del ejemplo, con nombres estables para los tests."""

from __future__ import annotations


class ExampleError(RuntimeError):
    """Base de errores del ejemplo."""


class ConfigurationError(ExampleError):
    """Falta configuración local (variables de entorno, vault, etc.)."""


class UnauthorizedOperation(ExampleError, PermissionError):
    """El rol que intenta la operación no la tiene permitida."""

    def __init__(self, caller: str, operation: str) -> None:
        super().__init__(f"{caller} is not authorized for {operation}")
        self.caller = caller
        self.operation = operation


class ApprovalDeclined(ExampleError):
    """El humano rechazó la propuesta; no se firmó ni se envió nada."""
