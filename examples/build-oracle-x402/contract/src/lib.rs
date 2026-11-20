#![no_std]
//! Oracle feed: stores one value plus the ledger timestamp of the write.
//! Only the oracle key fixed at `init` time can write.

use soroban_sdk::{contract, contracterror, contractimpl, contracttype, Address, Env};

#[contracterror]
#[derive(Copy, Clone, Debug, Eq, PartialEq, PartialOrd, Ord)]
#[repr(u32)]
pub enum Error {
    AlreadyInitialized = 1,
    NotInitialized = 2,
    NoValue = 3,
}

#[contracttype]
#[derive(Clone)]
enum Key {
    Oracle,
    Latest,
}

#[contracttype]
#[derive(Clone, Debug, Eq, PartialEq)]
pub struct Reading {
    /// Fixed-point value (the example stores temperature in 1/100 degC).
    pub value: i64,
    /// Ledger close time (unix seconds) of the write that stored it.
    pub timestamp: u64,
}

#[contract]
pub struct OracleFeed;

#[contractimpl]
impl OracleFeed {
    /// Fix the oracle key. Callable once; the oracle must authorise it so
    /// nobody can front-run the deployer and claim the feed.
    pub fn init(env: Env, oracle: Address) -> Result<(), Error> {
        if env.storage().instance().has(&Key::Oracle) {
            return Err(Error::AlreadyInitialized);
        }
        oracle.require_auth();
        env.storage().instance().set(&Key::Oracle, &oracle);
        Ok(())
    }

    /// Store a new value. Requires the oracle's authorisation; any other
    /// signer makes the transaction fail.
    pub fn set(env: Env, value: i64) -> Result<Reading, Error> {
        let oracle: Address = env
            .storage()
            .instance()
            .get(&Key::Oracle)
            .ok_or(Error::NotInitialized)?;
        oracle.require_auth();
        let reading = Reading {
            value,
            timestamp: env.ledger().timestamp(),
        };
        env.storage().instance().set(&Key::Latest, &reading);
        Ok(reading)
    }

    pub fn latest(env: Env) -> Result<Reading, Error> {
        env.storage().instance().get(&Key::Latest).ok_or(Error::NoValue)
    }

    pub fn oracle(env: Env) -> Result<Address, Error> {
        env.storage().instance().get(&Key::Oracle).ok_or(Error::NotInitialized)
    }
}

#[cfg(test)]
mod test {
    use super::*;
    use soroban_sdk::testutils::{Address as _, Ledger, MockAuth, MockAuthInvoke};
    use soroban_sdk::{IntoVal, Env};

    fn setup() -> (Env, OracleFeedClient<'static>, Address) {
        let env = Env::default();
        let id = env.register(OracleFeed, ());
        let client = OracleFeedClient::new(&env, &id);
        let oracle = Address::generate(&env);
        env.mock_all_auths();
        client.init(&oracle);
        (env, client, oracle)
    }

    #[test]
    fn oracle_writes_and_reads_value_with_timestamp() {
        let (env, client, _oracle) = setup();
        env.ledger().set_timestamp(1_700_000_000);
        client.set(&1850);
        assert_eq!(client.latest(), Reading { value: 1850, timestamp: 1_700_000_000 });
        env.ledger().set_timestamp(1_700_000_600);
        client.set(&-120);
        assert_eq!(client.latest(), Reading { value: -120, timestamp: 1_700_000_600 });
    }

    #[test]
    fn read_before_first_write_fails() {
        let (_env, client, _oracle) = setup();
        assert_eq!(client.try_latest(), Err(Ok(Error::NoValue)));
    }

    #[test]
    fn init_twice_fails() {
        let (env, client, _oracle) = setup();
        let other = Address::generate(&env);
        assert_eq!(client.try_init(&other), Err(Ok(Error::AlreadyInitialized)));
    }

    #[test]
    fn write_from_another_key_fails() {
        let env = Env::default();
        let id = env.register(OracleFeed, ());
        let client = OracleFeedClient::new(&env, &id);
        let oracle = Address::generate(&env);
        let attacker = Address::generate(&env);
        env.mock_all_auths();
        client.init(&oracle);

        // Only the attacker authorises the call; the oracle's auth is absent.
        env.mock_auths(&[MockAuth {
            address: &attacker,
            invoke: &MockAuthInvoke {
                contract: &id,
                fn_name: "set",
                args: (999_i64,).into_val(&env),
                sub_invokes: &[],
            },
        }]);
        assert!(client.try_set(&999).is_err());
        assert_eq!(client.try_latest(), Err(Ok(Error::NoValue)));
    }

    #[test]
    fn write_without_any_auth_fails() {
        let (env, client, _oracle) = setup();
        env.mock_auths(&[]);
        assert!(client.try_set(&1).is_err());
    }
}
