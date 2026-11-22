"""Agente en memoria para el demo offline y los tests. Sin red y sin secretos."""

from __future__ import annotations

from typing import Any


class FakeAgent:
    """Sustituye al ``Agent`` de Nirium sin abrir sockets.

    Guarda cada llamada en ``events`` para poder demostrar el orden:
    configurar manager → proponer → (aprobación) → firmar → submitir.
    """

    def __init__(self, *, owner: str, manager: str, with_instructions: bool = True) -> None:
        self.owner = owner
        self.manager = manager
        self.with_instructions = with_instructions
        self.events: list[str] = []
        self.requests: list[tuple[str, dict[str, Any]]] = []
        self.submitted_xdrs: list[str] = []

    def _record(self, name: str, **payload: Any) -> None:
        self.events.append(name)
        self.requests.append((name, payload))

    async def set_treasury_rebalance_manager(
        self, *, vault: str, manager: str, rebalance_manager: str
    ) -> dict[str, Any]:
        self._record(
            "set_treasury_rebalance_manager",
            vault=vault,
            manager=manager,
            rebalance_manager=rebalance_manager,
        )
        return {"xdr": "UNSIGNED:set-rebalance-manager", "signWith": manager}

    async def propose_treasury_rebalance(
        self,
        *,
        vault: str,
        caller: str,
        enter_at: float,
        exit_at: float,
        min_idle: Any = None,
    ) -> dict[str, Any]:
        self._record(
            "propose_treasury_rebalance",
            vault=vault,
            caller=caller,
            enter_at=enter_at,
            exit_at=exit_at,
            min_idle=min_idle,
        )
        if not self.with_instructions:
            return {"instructions": [], "reason": "nothing to do right now", "xdr": None}
        return {
            "vault": vault,
            "caller": caller,
            "instructions": [
                {"kind": "Invest", "strategy": "CSTRATEGY-DEMO", "amount": "1000000"}
            ],
            "xdr": "UNSIGNED:rebalance",
            "enterAt": enter_at,
            "exitAt": exit_at,
        }

    async def build_treasury_rebalance(
        self, *, vault: str, instructions: list[dict[str, Any]], caller: str
    ) -> dict[str, Any]:
        self._record("build_treasury_rebalance", vault=vault, instructions=instructions, caller=caller)
        return {"xdr": "UNSIGNED:rebalance", "instructions": instructions}

    async def submit_treasury_tx(self, xdr: str) -> dict[str, Any]:
        self._record("submit_treasury_tx", xdr=xdr)
        self.submitted_xdrs.append(xdr)
        return {"hash": "PENDING", "status": "PENDING"}

    async def get_treasury_vault(self, vault: str, holder: str | None = None) -> dict[str, Any]:
        self._record("get_treasury_vault", vault=vault, holder=holder)
        return {"vault": vault, "network": "testnet", "totalManagedFunds": []}

    async def withdraw_from_treasury_vault(
        self, *, vault: str, from_: str, shares: Any = None
    ) -> dict[str, Any]:
        self._record("withdraw_from_treasury_vault", vault=vault, from_=from_, shares=shares)
        return {"xdr": "UNSIGNED:withdraw", "signWith": from_}
