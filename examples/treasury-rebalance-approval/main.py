#!/usr/bin/env python3
"""Rebalance de Treasury con aprobación humana (Stellar testnet).

Modos:
  python main.py --demo            flujo completo offline, aprobación inyectada SÍ
  python main.py --demo --decline  mismo flujo con NO (cero firmas del rebalance)
  python main.py                   flujo real en testnet con claves locales y y/N
  python main.py --negative-testnet
      prueba negativa local: la manager key intenta retirar y es denegada
  python main.py --negative-testnet --i-understand-testnet-only
      prueba negativa live: firma con la manager key y espera rechazo on-chain
      (NO ejecutada en este PR: requiere tus propias claves y fondos testnet)

Nunca se usa mainnet. Ninguna clave se imprime ni se envía al Agente.
"""

from __future__ import annotations

import argparse
import asyncio
import os
import re
import sys
from typing import Any

try:
    from dotenv import load_dotenv

    load_dotenv()
except ImportError:  # el demo no necesita python-dotenv
    pass

sys.path.insert(0, os.path.dirname(__file__))

from src.approval import approved, ask_human_approval, declined  # noqa: E402
from src.auth import DEFAULT_BASE_URL, make_agent, resolve_api_key  # noqa: E402
from src.errors import ConfigurationError, ExampleError, UnauthorizedOperation  # noqa: E402
from src.fake_agent import FakeAgent  # noqa: E402
from src.flow import (  # noqa: E402
    FlowReport,
    configure_rebalance_manager,
    deny_operation,
    execute_if_approved,
    explorer_tx,
    propose_rebalance,
    proposal_summary,
    run_flow,
)
from src.redaction import SecretRing  # noqa: E402
from src.roles import Operation, VaultRoles  # noqa: E402
from src.sign import FakeSigner, load_signer, resolve_testnet_passphrase  # noqa: E402

DEMO_OWNER = "GOWNER-DEMO-AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA"
DEMO_MANAGER = "GMANAGER-DEMO-AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA"
HEX_HASH_RE = re.compile(r"^[0-9a-fA-F]{64}$")


def build_parser() -> argparse.ArgumentParser:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--demo", action="store_true", help="modo offline, sin red ni claves")
    parser.add_argument("--decline", action="store_true", help="con --demo: rechaza la aprobación")
    parser.add_argument(
        "--negative-testnet",
        action="store_true",
        help="intento de retiro con la manager key; por defecto solo local",
    )
    parser.add_argument(
        "--i-understand-testnet-only",
        action="store_true",
        help="autoriza firmar y enviar el intento negativo SOLO en testnet",
    )
    return parser


def print_report(report: Any, ring: SecretRing) -> None:
    print("Resumen del flujo (testnet):")
    for step in report.steps:
        print(f"  - {ring.redact(step)}")
    print("  hashes:")
    for step, hash_value in report.hashes.items():
        hash_label = hash_value if hash_value and HEX_HASH_RE.fullmatch(hash_value) else "PENDING"
        print(f"    {step}: {hash_label} | {ring.redact(explorer_tx(hash_value))}")
    for operation, denial in report.denials.items():
        print(f"  negado {operation}: {denial['reason']} (firmado={denial['signed']}, enviado={denial['submitted']})")
    print(f"  aprobado={report.decision.approved} ejecutado={report.executed}")


async def run_demo(decline: bool) -> int:
    ring = SecretRing()
    roles = VaultRoles(owner=DEMO_OWNER, rebalance_manager=DEMO_MANAGER)
    agent = FakeAgent(owner=DEMO_OWNER, manager=DEMO_MANAGER)
    owner_signer = FakeSigner(DEMO_OWNER)
    manager_signer = FakeSigner(DEMO_MANAGER)
    decision = declined("demo") if decline else approved()

    print("Demo offline: sin red, sin claves, sin transacciones reales.")
    report = await run_flow(
        agent,
        vault="CVAULT-DEMO",
        roles=roles,
        owner_signer=owner_signer,
        manager_signer=manager_signer,
        decision=decision,
        ring=ring,
    )
    print(report.proposal and proposal_summary("CVAULT-DEMO", report.proposal))
    print_report(report, ring)

    if decline:
        assert not manager_signer.signed_xdrs, "declinar no debe firmar con la manager key"
        assert agent.submitted_xdrs == ["SIGNED:UNSIGNED:set-rebalance-manager"], (
            "declinar no debe enviar el rebalance"
        )
        print("OK: declinar no firmó ni envió el rebalance (0 firmas manager, 1 submit de setup).")
    else:
        assert manager_signer.signed_xdrs == ["UNSIGNED:rebalance"]
        assert agent.submitted_xdrs[-1] == "SIGNED:UNSIGNED:rebalance"
        print("OK: flujo completo; rebalance firmado y enviado solo tras aprobación.")
    print("Hashes de testnet: PENDING / N/A (demo no emite transacciones).")
    return 0


async def live_context() -> tuple[Any, VaultRoles, Any, Any, SecretRing, str, str]:
    ring = SecretRing()
    resolve_testnet_passphrase(os.environ.get("NETWORK_PASSPHRASE"))
    owner_signer = load_signer("OWNER_SECRET_KEY", ring)
    manager_signer = load_signer("MANAGER_SECRET_KEY", ring)
    vault = os.environ.get("VAULT_ID", "").strip()
    if not vault:
        raise ConfigurationError("VAULT_ID es obligatoria en modo testnet.")
    roles = VaultRoles(owner=owner_signer.public_key, rebalance_manager=manager_signer.public_key)
    base_url = os.environ.get("NIRIUM_BASE_URL", DEFAULT_BASE_URL).rstrip("/")
    api_key = await resolve_api_key(base_url, roles.owner)
    agent = make_agent(base_url, api_key)
    return agent, roles, owner_signer, manager_signer, ring, vault, base_url


async def run_live() -> int:
    agent, roles, owner_signer, manager_signer, ring, vault, base_url = await live_context()
    print(f"Agente: {base_url} | red: Stellar testnet | vault: {vault}")
    print("Firmando localmente la configuración del RebalanceManager...")

    setup = await configure_rebalance_manager(
        agent, vault=vault, roles=roles, owner_signer=owner_signer, ring=ring
    )
    proposal = await propose_rebalance(
        agent,
        vault=vault,
        roles=roles,
        manager_signer=manager_signer,
        enter_at=float(os.environ.get("ENTER_AT", "1.0")),
        exit_at=float(os.environ.get("EXIT_AT", "2.0")),
        min_idle=os.environ.get("MIN_IDLE_STROOPS") or None,
        ring=ring,
    )
    decision = ask_human_approval(proposal_summary(vault, proposal))
    execution = await execute_if_approved(
        agent,
        vault=vault,
        roles=roles,
        proposal=proposal,
        manager_signer=manager_signer,
        decision=decision,
        ring=ring,
    )

    report = FlowReport(vault=vault, roles=roles, decision=decision, proposal=proposal)
    report.hashes["set_rebalance_manager"] = setup["hash"]
    report.executed = bool(execution.get("executed"))
    if report.executed:
        report.hashes["rebalance"] = execution.get("hash")
        report.steps.append("owner configuró manager; humano aprobó; rebalance enviado")
    else:
        report.steps.append(f"humano NO aprobó: {execution['reason']} (0 firmas manager, 0 envíos)")
    for operation in (Operation.WITHDRAW, Operation.TRANSFER):
        report.denials[operation.value] = deny_operation(
            roles=roles,
            caller=manager_signer.public_key,
            operation=operation,
            ring=ring,
        )
    report.steps.append("manager key denegada para withdraw y transfer antes de firmar")
    print_report(report, ring)
    return 0 if report.executed else 3


async def run_negative_testnet(force_live: bool) -> int:
    ring = SecretRing()
    resolve_testnet_passphrase(os.environ.get("NETWORK_PASSPHRASE"))
    _agent, roles, _owner_signer, manager_signer, ring, vault, _base_url = await live_context()

    denial = deny_operation(
        roles=roles,
        caller=manager_signer.public_key,
        operation=Operation.WITHDRAW,
        ring=ring,
    )
    print(f"Gate local: {denial['reason']}")
    print(f"firmado={denial['signed']} enviado={denial['submitted']}")
    if not force_live:
        print("No se firmó ni se envió nada. Para intentar el rechazo on-chain usa "
              "--i-understand-testnet-only con tus propias claves testnet.")
        return 0

    print("ADVERTENCIA: intento live en testnet con la manager key; se espera rechazo del contrato.")
    withdrawal = await _agent.withdraw_from_treasury_vault(
        vault=vault,
        from_=roles.owner,
        shares=os.environ.get("WITHDRAW_SHARES_STROOPS", "1"),
    )
    xdr = withdrawal.get("xdr")
    if not xdr:
        raise ExampleError("El agente no devolvió XDR de retiro.")
    signed = manager_signer.sign(xdr)
    try:
        result = await _agent.submit_treasury_tx(signed)
    except Exception as exc:
        print(f"RECHAZADO como se esperaba: {ring.redact(exc)}")
        return 0
    hash_value = result.get("hash") or "PENDING"
    print(f"INESPERADO: el envío fue aceptado: {ring.redact(explorer_tx(hash_value))}")
    print("No uses este vault: revisa los roles on-chain antes de continuar.")
    return 2


async def main() -> int:
    args = build_parser().parse_args()
    try:
        if args.demo:
            return await run_demo(args.decline)
        if args.negative_testnet:
            return await run_negative_testnet(args.i_understand_testnet_only)
        return await run_live()
    except (ConfigurationError, ExampleError, UnauthorizedOperation) as exc:
        print(f"Error: {exc}", file=sys.stderr)
        return 1
    except Exception as exc:
        print(f"Error inesperado: {type(exc).__name__}", file=sys.stderr)
        return 1


if __name__ == "__main__":
    sys.exit(asyncio.run(main()))
