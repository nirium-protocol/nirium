"""Roles: el manager puede rebalancear, pero no sacar fondos del vault."""

from src.errors import UnauthorizedOperation
from src.roles import Operation, VaultRoles

OWNER = "GOWNERAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA"
MANAGER = "GMANAGERAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA"
STRANGER = "GSTRANGERAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA"

roles = VaultRoles(owner=OWNER, rebalance_manager=MANAGER)


def test_role_of():
    assert roles.role_of(OWNER) == "owner"
    assert roles.role_of(MANAGER) == "rebalance_manager"
    assert roles.role_of(STRANGER) is None


def test_manager_may_rebalance():
    roles.authorize(MANAGER, Operation.REBALANCE)


def test_manager_cannot_withdraw():
    try:
        roles.authorize(MANAGER, Operation.WITHDRAW)
    except UnauthorizedOperation as exc:
        assert exc.operation == "withdraw"
        assert exc.caller == MANAGER
    else:
        raise AssertionError("la manager key NO debe poder retirar fondos")


def test_manager_cannot_transfer_out_of_vault():
    try:
        roles.authorize(MANAGER, Operation.TRANSFER)
    except UnauthorizedOperation:
        pass
    else:
        raise AssertionError("la manager key NO debe poder transferir fuera del vault")


def test_manager_cannot_change_its_own_role():
    try:
        roles.authorize(MANAGER, Operation.SET_REBALANCE_MANAGER)
    except UnauthorizedOperation:
        pass
    else:
        raise AssertionError("solo el owner puede cambiar el RebalanceManager")


def test_owner_may_withdraw_its_own_shares():
    roles.authorize(OWNER, Operation.WITHDRAW)


def test_stranger_cannot_rebalance():
    try:
        roles.authorize(STRANGER, Operation.REBALANCE)
    except UnauthorizedOperation:
        pass
    else:
        raise AssertionError("una clave ajena no debe poder rebalancear")


def test_withdrawal_is_not_expressible_as_rebalance():
    assert VaultRoles.is_expressible_as_rebalance(Operation.REBALANCE) is True
    assert VaultRoles.is_expressible_as_rebalance(Operation.WITHDRAW) is False
    assert VaultRoles.is_expressible_as_rebalance(Operation.TRANSFER) is False


def test_denial_does_not_mutate_roles():
    before = (roles.owner, roles.rebalance_manager)
    for operation in (Operation.WITHDRAW, Operation.TRANSFER):
        try:
            roles.authorize(MANAGER, operation)
        except UnauthorizedOperation:
            pass
    assert (roles.owner, roles.rebalance_manager) == before
