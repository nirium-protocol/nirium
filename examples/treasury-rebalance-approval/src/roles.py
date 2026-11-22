"""Modelo local de los roles del vault.

El vault real es DeFindex (Soroban) y sus operaciones están en el contrato de
terceros. Este módulo no sustituye al contrato: replica, de forma explícita y
testeable, la regla que el ejemplo necesita demostrar antes de tocar la red:

- ``owner`` (Manager del vault) puede cambiar el RebalanceManager, rebalancear
  y retirar **sus propias** acciones.
- ``rebalance_manager`` solo puede rebalancear. No puede cambiar roles,
  retirar acciones del vault ni transferir fondos hacia otra dirección.

``rebalance()`` no acepta dirección de destino: un "retiro disfrazado" de
rebalance no es una operación expresible, no solo una operación denegada.
"""

from __future__ import annotations

from dataclasses import dataclass
from enum import Enum

from src.errors import UnauthorizedOperation


class Operation(str, Enum):
    SET_REBALANCE_MANAGER = "set_rebalance_manager"
    REBALANCE = "rebalance"
    WITHDRAW = "withdraw"
    TRANSFER = "transfer"


# Operaciones que no pueden expresarse como un rebalance del vault.
_NON_REBALANCE_OPERATIONS = frozenset(
    {
        Operation.WITHDRAW,
        Operation.TRANSFER,
        Operation.SET_REBALANCE_MANAGER,
    }
)


@dataclass(frozen=True)
class VaultRoles:
    """Roles públicos del vault. Nunca contiene secretos."""

    owner: str
    rebalance_manager: str

    def role_of(self, caller: str) -> str | None:
        if caller == self.owner:
            return "owner"
        if caller == self.rebalance_manager:
            return "rebalance_manager"
        return None

    def authorize(self, caller: str, operation: Operation) -> None:
        """Falla cerrado si ``caller`` no tiene permitida ``operation``."""
        role = self.role_of(caller)
        if role is None:
            raise UnauthorizedOperation(caller, operation.value)
        if operation in _NON_REBALANCE_OPERATIONS and role != "owner":
            raise UnauthorizedOperation(caller, operation.value)
        if operation == Operation.REBALANCE and role not in ("owner", "rebalance_manager"):
            raise UnauthorizedOperation(caller, operation.value)

    @staticmethod
    def is_expressible_as_rebalance(operation: Operation) -> bool:
        """Un rebalance solo mueve fondos entre estratégias del mismo vault."""
        return operation == Operation.REBALANCE
