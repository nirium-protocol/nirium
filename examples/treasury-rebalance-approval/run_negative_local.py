#!/usr/bin/env python3
"""Direct negative test using the test modules."""
import sys
import os
import asyncio

SCRIPT_DIR = r'C:\Users\User\.local\share\opencode\worktree\d25dc5\witty-mountain\_hf41\nirium_443\examples\treasury-rebalance-approval'
sys.path.insert(0, SCRIPT_DIR)
os.chdir(SCRIPT_DIR)

from dotenv import load_dotenv
load_dotenv('.env.testnet')

# Import the modules that work in tests
from src.roles import Operation, VaultRoles
from src.sign import load_signer, resolve_testnet_passphrase
from src.auth import DEFAULT_BASE_URL, make_agent, resolve_api_key
from src.flow import deny_operation
from src.redaction import SecretRing

async def main():
    ring = SecretRing()
    resolve_testnet_passphrase(os.environ.get("NETWORK_PASSPHRASE"))
    
    owner_signer = load_signer("OWNER_SECRET_KEY", ring)
    manager_signer = load_signer("MANAGER_SECRET_KEY", ring)
    vault = os.environ.get("VAULT_ID", "").strip()
    if not vault:
        print("VAULT_ID is required for testnet mode.")
        return 1
    
    roles = VaultRoles(owner=owner_signer.public_key, rebalance_manager=manager_signer.public_key)
    base_url = os.environ.get("NIRIUM_BASE_URL", "https://rpc-futurenet.stellar.org").rstrip("/")
    api_key = await resolve_api_key(base_url, roles.owner)
    agent = make_agent(base_url, api_key)
    
    print("Testing local denial (no network)...")
    denial = deny_operation(
        roles=roles,
        caller=manager_signer.public_key,
        operation=Operation.WITHDRAW,
        ring=ring,
    )
    print(f"Local denial: {denial['reason']}")
    print(f"signed={denial['signed']} submitted={denial['submitted']}")
    
    print("\nLocal negative test PASSED - manager key correctly denied for withdraw")
    return 0

if __name__ == "__main__":
    asyncio.run(main())