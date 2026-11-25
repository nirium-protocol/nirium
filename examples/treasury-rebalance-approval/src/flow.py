"""Flujo del ejemplo: configurar → proponer → aprobar → ejecutar → verificar.

Ninguna función de aquí recibe una clave secreta. Recibe firmantes locales
(``Signer``) que hacen la firma en esta máquina, y un ``Agent`` que solo
construye y transmite XDR ya firmados.
"""

from __future__ import annotations

import re
from dataclasses import dataclass, field
from typing import Any

from src.approval import ApprovalDecision
from src.errors import ExampleError, UnauthorizedOperation
from src.redaction import SecretRing
from src.roles import Operation, VaultRoles
from src.sign import Signer

_TX_HASH_RE = re.compile(r"^[0-9a-fA-F]{64}$")


@dataclass
class FlowReport:
    vault: str
    roles: VaultRoles
    decision: ApprovalDecision
    hashes: dict[str, str | None] = field(default_factory=dict)
    steps: list[str] = field(default_factory=list)
    proposal: dict[str, Any] = field(default_factory=dict)
    executed: bool = False
    denials: dict[str, dict[str, Any]] = field(default_factory=dict)

    def as_dict(self) -> dict[str, Any]:
        return {
            "vault": self.vault,
            "owner": self.roles.owner,
            "rebalance_manager": self.roles.rebalance_manager,
            "approval_source": self.decision.source,
            "approved": self.decision.approved,
            "executed": self.executed,
            "hashes": self.hashes,
            "steps": self.steps,
            "denials": self.denials,
        }


def tx_hash(result: dict[str, Any]) -> str | None:
    return result.get("hash") or result.get("transaction_hash")


def explorer_tx(hash_value: str | None) -> str:
    if hash_value and _TX_HASH_RE.fullmatch(hash_value):
        return f"https://stellar.expert/explorer/testnet/tx/{hash_value}"
    return "N/A (hash PENDING: no hubo envío real en esta ejecución)"


async def _call(awaitable: Any, ring: SecretRing) -> dict[str, Any]:
    try:
        result = await awaitable
    except Exception as exc:
        raise ring.wrap(exc) from None
    if not isinstance(result, dict):
        raise ExampleError("El agente devolvió una respuesta inesperada.")
    return result


async def configure_rebalance_manager(
    agent: Any,
    *,
    vault: str,
    roles: VaultRoles,
    owner_signer: Signer,
    ring: SecretRing,
) -> dict[str, Any]:
    """El owner firma el XDR que otorga el rol de rebalance al manager."""
    roles.authorize(owner_signer.public_key, Operation.SET_REBALANCE_MANAGER)
    built = await _call(
        agent.set_treasury_rebalance_manager(
            vault=vault,
            manager=roles.owner,
            rebalance_manager=roles.rebalance_manager,
        ),
        ring,
    )
    xdr = built.get("xdr")
    if not xdr:
        raise ExampleError("set_treasury_rebalance_manager no devolvió XDR.")
    signed = owner_signer.sign(xdr)
    result = await _call(agent.submit_treasury_tx(signed), ring)
    return {"xdr": xdr, "result": result, "hash": tx_hash(result)}


async def propose_rebalance(
    agent: Any,
    *,
    vault: str,
    roles: VaultRoles,
    manager_signer: Signer,
    enter_at: float,
    exit_at: float,
    min_idle: Any = None,
    ring: SecretRing,
) -> dict[str, Any]:
    """El agente propone; con la manager key se construye el XDR, aún sin firma."""
    roles.authorize(manager_signer.public_key, Operation.REBALANCE)
    proposal = await _call(
        agent.propose_treasury_rebalance(
            vault=vault,
            caller=manager_signer.public_key,
            enter_at=enter_at,
            exit_at=exit_at,
            min_idle=min_idle,
        ),
        ring,
    )
    if proposal.get("xdr"):
        return proposal
    instructions = proposal.get("instructions") or []
    if not instructions:
        return proposal
    built = await _call(
        agent.build_treasury_rebalance(
            vault=vault,
            instructions=instructions,
            caller=manager_signer.public_key,
        ),
        ring,
    )
    return {**proposal, **built}


def proposal_summary(vault: str, proposal: dict[str, Any]) -> str:
    """Resumen público: no incluye secretos ni claves privadas."""
    instructions = proposal.get("instructions") or []
    lines = [
        "Propuesta de rebalance (testnet)",
        f"  vault: {vault}",
        f"  instructions: {len(instructions)}",
    ]
    for instruction in instructions:
        lines.append(
            f"    - {instruction.get('kind')} {instruction.get('amount')} "
            f"en {instruction.get('strategy')}"
        )
    if proposal.get("reason"):
        lines.append(f"  reason: {proposal['reason']}")
    return "\n".join(lines)


async def execute_if_approved(
    agent: Any,
    *,
    vault: str,
    roles: VaultRoles,
    proposal: dict[str, Any],
    manager_signer: Signer,
    decision: ApprovalDecision,
    ring: SecretRing,
) -> dict[str, Any]:
    """Firma y envía SOLO si el humano aprobó. Sin aprobación: no-op."""
    if not decision.approved:
        return {
            "executed": False,
            "signed": False,
            "submitted": False,
            "reason": f"approval declined ({decision.source})",
        }
    roles.authorize(manager_signer.public_key, Operation.REBALANCE)
    xdr = proposal.get("xdr")
    if not xdr:
        return {
            "executed": False,
            "signed": False,
            "submitted": False,
            "reason": proposal.get("reason") or "no hay XDR que firmar",
        }
    signed = manager_signer.sign(xdr)
    result = await _call(agent.submit_treasury_tx(signed), ring)
    return {
        "executed": True,
        "signed": True,
        "submitted": True,
        "hash": tx_hash(result),
        "result": result,
    }


def deny_operation(
    *,
    roles: VaultRoles,
    caller: str,
    operation: Operation,
    ring: SecretRing,
) -> dict[str, Any]:
    """Falla cerrado antes de firmar o de hablar con la red."""
    try:
        roles.authorize(caller, operation)
    except UnauthorizedOperation as exc:
        return {
            "operation": operation.value,
            "denied": True,
            "reason": ring.redact(str(exc)),
            "signed": False,
            "submitted": False,
        }
    raise AssertionError(f"{caller} no debía estar autorizado para {operation.value}")


async def run_flow(
    agent: Any,
    *,
    vault: str,
    roles: VaultRoles,
    owner_signer: Signer,
    manager_signer: Signer,
    decision: ApprovalDecision,
    ring: SecretRing,
    enter_at: float = 1.0,
    exit_at: float = 2.0,
    min_idle: Any = None,
) -> FlowReport:
    """Un solo punto de entrada para el demo y para la ejecución en testnet."""
    report = FlowReport(vault=vault, roles=roles, decision=decision)

    setup = await configure_rebalance_manager(
        agent, vault=vault, roles=roles, owner_signer=owner_signer, ring=ring
    )
    report.hashes["set_rebalance_manager"] = setup["hash"]
    report.steps.append("owner firmó y envió set_treasury_rebalance_manager")

    proposal = await propose_rebalance(
        agent,
        vault=vault,
        roles=roles,
        manager_signer=manager_signer,
        enter_at=enter_at,
        exit_at=exit_at,
        min_idle=min_idle,
        ring=ring,
    )
    report.proposal = proposal
    report.steps.append("manager key propuso el rebalance (XDR aún sin firmar)")

    execution = await execute_if_approved(
        agent,
        vault=vault,
        roles=roles,
        proposal=proposal,
        manager_signer=manager_signer,
        decision=decision,
        ring=ring,
    )
    report.executed = bool(execution.get("executed"))
    if report.executed:
        report.hashes["rebalance"] = execution.get("hash")
        report.steps.append("humano aprobó: manager firmó y envió el rebalance")
    else:
        report.steps.append(f"humano NO aprobó: {execution['reason']} (0 firmas, 0 envíos)")

    for operation in (Operation.WITHDRAW, Operation.TRANSFER):
        denial = deny_operation(
            roles=roles,
            caller=manager_signer.public_key,
            operation=operation,
            ring=ring,
        )
        report.denials[operation.value] = denial
    report.steps.append("manager key denegada para withdraw y transfer antes de firmar")
    return report
