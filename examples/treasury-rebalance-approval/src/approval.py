"""Aprobación humana en terminal. Cualquier respuesta que no sea SÍ es NO."""

from __future__ import annotations

from dataclasses import dataclass

APPROVE_TOKENS = frozenset({"y", "yes"})


@dataclass(frozen=True)
class ApprovalDecision:
    approved: bool
    source: str = "human"

    def __bool__(self) -> bool:
        return self.approved


def approved() -> ApprovalDecision:
    return ApprovalDecision(True, "injected-approved")


def declined(reason: str = "injected-declined") -> ApprovalDecision:
    return ApprovalDecision(False, reason)


def parse_answer(answer: str) -> ApprovalDecision:
    token = (answer or "").strip().lower()
    return ApprovalDecision(token in APPROVE_TOKENS)


def ask_human_approval(summary: str) -> ApprovalDecision:
    """Muestra el resumen público de la propuesta y espera ``y/N``."""
    print(summary)
    try:
        answer = input("¿Aprobar y ejecutar este rebalance? [y/N]: ")
    except EOFError:
        answer = ""
    return parse_answer(answer)
