"""Integración del flujo con agentes y firmantes en memoria (sin red)."""

from src.approval import approved, declined
from src.errors import UnauthorizedOperation
from src.fake_agent import FakeAgent
from src.flow import (
    configure_rebalance_manager,
    deny_operation,
    execute_if_approved,
    propose_rebalance,
    run_flow,
)
from src.redaction import SecretRing
from src.roles import Operation, VaultRoles
from src.sign import FakeSigner

OWNER = "GOWNERAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA"
MANAGER = "GMANAGERAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA"
VAULT = "CVAULTAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA"


def fixture():
    ring = SecretRing("S" + "A" * 55)
    roles = VaultRoles(owner=OWNER, rebalance_manager=MANAGER)
    agent = FakeAgent(owner=OWNER, manager=MANAGER)
    owner_signer = FakeSigner(OWNER)
    manager_signer = FakeSigner(MANAGER)
    return ring, roles, agent, owner_signer, manager_signer


async def test_happy_path_signs_and_submits_only_after_approval():
    ring, roles, agent, owner_signer, manager_signer = fixture()

    report = await run_flow(
        agent,
        vault=VAULT,
        roles=roles,
        owner_signer=owner_signer,
        manager_signer=manager_signer,
        decision=approved(),
        ring=ring,
    )

    assert report.executed is True
    assert owner_signer.signed_xdrs == ["UNSIGNED:set-rebalance-manager"]
    assert manager_signer.signed_xdrs == ["UNSIGNED:rebalance"]
    assert agent.submitted_xdrs == [
        "SIGNED:UNSIGNED:set-rebalance-manager",
        "SIGNED:UNSIGNED:rebalance",
    ]
    assert agent.events.index("set_treasury_rebalance_manager") < agent.events.index(
        "propose_treasury_rebalance"
    )
    assert agent.events.count("submit_treasury_tx") == 2
    assert report.hashes["rebalance"] == "PENDING"


async def test_declining_approval_signs_and_submits_nothing_for_rebalance():
    ring, roles, agent, owner_signer, manager_signer = fixture()

    report = await run_flow(
        agent,
        vault=VAULT,
        roles=roles,
        owner_signer=owner_signer,
        manager_signer=manager_signer,
        decision=declined("humano dijo no"),
        ring=ring,
    )

    assert report.executed is False
    assert report.decision.source == "humano dijo no"
    assert manager_signer.signed_xdrs == []
    assert agent.submitted_xdrs == ["SIGNED:UNSIGNED:set-rebalance-manager"]
    assert agent.events == [
        "set_treasury_rebalance_manager",
        "submit_treasury_tx",
        "propose_treasury_rebalance",
    ]
    assert agent.events.count("submit_treasury_tx") == 1
    assert agent.submitted_xdrs[-1].endswith("set-rebalance-manager")


async def test_manager_withdraw_denied_before_any_network_call_or_signature():
    ring, roles, agent, _owner_signer, manager_signer = fixture()
    before_events = list(agent.events)

    denial = deny_operation(
        roles=roles,
        caller=manager_signer.public_key,
        operation=Operation.WITHDRAW,
        ring=ring,
    )

    assert denial["denied"] is True
    assert denial["signed"] is False
    assert denial["submitted"] is False
    assert "not authorized" in denial["reason"]
    assert agent.events == before_events
    assert manager_signer.signed_xdrs == []


async def test_manager_transfer_denied_without_state_change():
    ring, roles, agent, _owner_signer, manager_signer = fixture()
    before = (roles.owner, roles.rebalance_manager)

    denial = deny_operation(
        roles=roles,
        caller=manager_signer.public_key,
        operation=Operation.TRANSFER,
        ring=ring,
    )

    assert denial["denied"] is True
    assert (roles.owner, roles.rebalance_manager) == before
    assert agent.requests == []


async def test_setup_requires_owner_key():
    ring, roles, agent, _owner_signer, manager_signer = fixture()
    try:
        await configure_rebalance_manager(
            agent,
            vault=VAULT,
            roles=roles,
            owner_signer=manager_signer,
            ring=ring,
        )
    except UnauthorizedOperation:
        assert agent.events == []
    else:
        raise AssertionError("la manager key no debe poder configurarse a sí misma")


async def test_no_instructions_means_no_signature_and_no_submission():
    ring, roles, agent, owner_signer, manager_signer = fixture()
    agent.with_instructions = False
    await configure_rebalance_manager(
        agent, vault=VAULT, roles=roles, owner_signer=owner_signer, ring=ring
    )
    proposal = await propose_rebalance(
        agent,
        vault=VAULT,
        roles=roles,
        manager_signer=manager_signer,
        enter_at=1.0,
        exit_at=2.0,
        ring=ring,
    )
    result = await execute_if_approved(
        agent,
        vault=VAULT,
        roles=roles,
        proposal=proposal,
        manager_signer=manager_signer,
        decision=approved(),
        ring=ring,
    )
    assert result["executed"] is False
    assert manager_signer.signed_xdrs == []
    assert agent.events.count("submit_treasury_tx") == 1
