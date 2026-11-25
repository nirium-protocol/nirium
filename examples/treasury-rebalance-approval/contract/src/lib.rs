//! Modelo host-side del guardián de roles que demuestra el ejemplo.
//!
//! NO es el contrato DeFindex desplegado y NO se compila a WASM aquí: en el PC
//! donde se escribió este ejemplo no está disponible el CLI `soroban`/`stellar`.
//! Es una especificación ejecutable con `cargo test` de la misma regla que el
//! ejemplo aplica en Python antes de firmar: `RebalanceManager` puede
//! rebalancear; no puede retirar, transferir ni cambiar roles.

use std::fmt;

#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum Operation {
    SetRebalanceManager,
    Rebalance,
    Withdraw,
    Transfer,
}

impl Operation {
    pub fn as_str(self) -> &'static str {
        match self {
            Operation::SetRebalanceManager => "set_rebalance_manager",
            Operation::Rebalance => "rebalance",
            Operation::Withdraw => "withdraw",
            Operation::Transfer => "transfer",
        }
    }
}

#[derive(Clone, Debug, PartialEq, Eq)]
pub enum AuthError {
    UnknownCaller,
    Unauthorized { caller: String, operation: Operation },
}

impl fmt::Display for AuthError {
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        match self {
            AuthError::UnknownCaller => write!(f, "caller is not a vault role"),
            AuthError::Unauthorized { caller, operation } => {
                write!(f, "{} is not authorized for {}", caller, operation.as_str())
            }
        }
    }
}

#[derive(Clone, Debug, PartialEq, Eq)]
pub struct VaultRoles {
    pub owner: String,
    pub rebalance_manager: String,
}

impl VaultRoles {
    pub fn new(owner: &str, rebalance_manager: &str) -> Self {
        Self {
            owner: owner.to_string(),
            rebalance_manager: rebalance_manager.to_string(),
        }
    }

    pub fn role_of(&self, caller: &str) -> Option<&'static str> {
        if caller == self.owner {
            Some("owner")
        } else if caller == self.rebalance_manager {
            Some("rebalance_manager")
        } else {
            None
        }
    }

    pub fn authorize(&self, caller: &str, operation: Operation) -> Result<(), AuthError> {
        let role = self
            .role_of(caller)
            .ok_or(AuthError::UnknownCaller)?;
        let allowed = match (role, operation) {
            (_, Operation::Rebalance) => true,
            ("owner", _) => true,
            _ => false,
        };
        if allowed {
            Ok(())
        } else {
            Err(AuthError::Unauthorized {
                caller: caller.to_string(),
                operation,
            })
        }
    }

    /// `rebalance()` solo mueve fondos entre estrategias del mismo vault;
    /// no acepta dirección de destino, así que un retiro es inexpresible.
    pub fn is_expressible_as_rebalance(operation: Operation) -> bool {
        matches!(operation, Operation::Rebalance)
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    const OWNER: &str = "GOWNERAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA";
    const MANAGER: &str = "GMANAGERAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA";
    const STRANGER: &str = "GSTRANGERAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA";

    fn roles() -> VaultRoles {
        VaultRoles::new(OWNER, MANAGER)
    }

    #[test]
    fn manager_may_rebalance() {
        assert!(roles().authorize(MANAGER, Operation::Rebalance).is_ok());
    }

    #[test]
    fn manager_cannot_withdraw() {
        let err = roles().authorize(MANAGER, Operation::Withdraw).unwrap_err();
        assert_eq!(
            err,
            AuthError::Unauthorized {
                caller: MANAGER.to_string(),
                operation: Operation::Withdraw
            }
        );
    }

    #[test]
    fn manager_cannot_transfer_out() {
        let err = roles().authorize(MANAGER, Operation::Transfer).unwrap_err();
        assert_eq!(err.to_string(), format!("{} is not authorized for transfer", MANAGER));
    }

    #[test]
    fn manager_cannot_change_roles() {
        assert!(roles()
            .authorize(MANAGER, Operation::SetRebalanceManager)
            .is_err());
    }

    #[test]
    fn owner_may_set_manager_and_withdraw() {
        let roles = roles();
        assert!(roles.authorize(OWNER, Operation::SetRebalanceManager).is_ok());
        assert!(roles.authorize(OWNER, Operation::Withdraw).is_ok());
    }

    #[test]
    fn stranger_is_not_a_role() {
        assert_eq!(
            roles().authorize(STRANGER, Operation::Rebalance).unwrap_err(),
            AuthError::UnknownCaller
        );
    }

    #[test]
    fn withdrawal_is_not_expressible_as_rebalance() {
        assert!(VaultRoles::is_expressible_as_rebalance(Operation::Rebalance));
        assert!(!VaultRoles::is_expressible_as_rebalance(Operation::Withdraw));
        assert!(!VaultRoles::is_expressible_as_rebalance(Operation::Transfer));
    }

    #[test]
    fn denial_does_not_mutate_roles() {
        let roles = roles();
        let before = roles.clone();
        let _ = roles.authorize(MANAGER, Operation::Withdraw);
        assert_eq!(roles, before);
    }
}
