#!/usr/bin/env python3
"""Non-custodial treasury vault quickstart (Python, testnet).

A complete Python loop against a **live Stellar testnet** DeFindex vault:

1. `deploy_treasury_vault` → sign the unsigned XDR with **your** key → `submit_treasury_tx`
2. `deposit_to_treasury_vault` → sign → `submit_treasury_tx`
3. `get_treasury_vault` → print the idle / invested split
4. `withdraw_from_treasury_vault` → sign → `submit_treasury_tx`

Nirium's SDK never holds a signing key in this path. The Agent only builds
and broadcasts XDR.

This example is the Python equivalent of `examples/treasury-vault-quickstart`
(TypeScript).

Why this is non-custodial
-------------------------

- **Nirium builds unsigned XDR.** Every treasury endpoint returns `xdr` +
  `signWith`. Nothing is submitted until you sign.
- **`Agent` never touches a private key on this path.** This example constructs
  `Agent({api_key, base_url})` — it receives no `S...` secret. Signing is done
  locally with `stellar-sdk` (`Keypair.from_secret` in `src/sign.py`).
- **Every signature comes from the caller's own keypair.** `manager` is set to
  *your* testnet address (the role that can rescue funds, pause strategies, and
  revoke rebalance). Nirium, if present at all, only holds `RebalanceManager`,
  which cannot withdraw.

This example does not call `execute_treasury_rebalance` or the RebalanceManager
endpoints. Rebalancing is out of scope for this quickstart.

Prerequisites
-------------

- Python >=3.10 (`stellar-sdk` 15.x requires it)
- A **funded Stellar testnet** account you control:
  - **XLM** for fees / contract deploy — [Friendbot]
    (https://friendbot.stellar.org) (`https://friendbot.stellar.org?addr=G...`)
  - A small balance of the vault asset. Default is **Blend testnet USDC**
    (contract from treasury info) — not Circle USDC. The script opens that
    trustline if it is missing; then click Faucet on
    [testnet.blend.capital](https://testnet.blend.capital).

You do **not** need a Nirium institutional API key. The script requests a public
demo token with your G-address.

Run (under 10 minutes)
----------------------

```bash
cd examples/treasury-vault-quickstart-python
cp .env.example .env
# put your own testnet S... key in .env - never a Nirium key, never mainnet
pip install -r requirements.txt
python main.py
```

The script prints a `https://stellar.expert/explorer/testnet/tx/<hash>` link for
every submitted transaction (deploy, deposit, withdraw), the vault state, and a
ready-to-paste summary of all hashes.

Environment
-----------

| Variable | Required | Default |
|---|---|---|
| `STELLAR_SECRET_KEY` | yes | - (your testnet `S...` only) |
| `NIRIUM_API_KEY` | no | public `demo-auth` token |
| `NIRIUM_BASE_URL` | no | `https://nirium-agent.fly.dev` |
| `VAULT_ASSET` | no | `usdc` (`cetes` also supported via treasury info) |
| `DEPOSIT_AMOUNT_STROOPS` | no | `10000000` (1.0 with 7 decimals) |
| `WITHDRAW_SHARES_STROOPS` | no | empty (withdraw the full balance) |
| `INVEST` | no | `false` (deposit stays idle so the split is obvious) |
| `VAULT_ID` | no | Reuse an already-deployed vault and skip deploy |
| `VAULT_MANAGER` | no | defaults to caller (your G-address) |
| `VAULT_NAME` | no | `Quickstart <last4>` |
| `VAULT_SYMBOL` | no | `QS<last3>` (max 10 chars) |
| `NETWORK_PASSPHRASE` | no | `Test SDF Network ; September 2015` |

Mainnet is out of scope. Setting the public network passphrase is rejected
before any signature is produced.

Failure modes this example handles
----------------------------------

The two that show up in this repo's own history:

- **Insufficient balance** — missing testnet account, not enough XLM to deploy,
  or not enough of the vault asset to deposit. The script preflights XLM on
  Horizon and rewrites agent/Horizon errors into a Friendbot + asset hint.

- **Wrong network passphrase** — signing a testnet XDR with the public
  passphrase (or pointing `NETWORK_PASSPHRASE` at mainnet). `src/sign.py`
  refuses to sign unless the passphrase is exactly testnet.
"""

from __future__ import annotations

import asyncio
import os
import sys

from dotenv import load_dotenv

load_dotenv()

# Ensure src/ is on the path
sys.path.insert(0, os.path.join(os.path.dirname(__file__), "src"))

from nirium import Agent

from src.auth import make_agent, resolve_api_key
from src.errors import QuickstartError, explain_failure
from src.flow import (
    build_deploy,
    build_deposit,
    build_withdraw,
    explorer_tx,
    sign_and_submit,
    tx_hash,
    vault_id,
)
from src.sign import (
    require_testnet_secret,
    resolve_testnet_passphrase,
    public_key_from_secret,
)
from src.usdc import pick_asset, preflight_xlm, ensure_usdc_trustline, required_usdc


DEFAULT_BASE_URL = "https://nirium-agent.fly.dev"
HORIZON_TESTNET = "https://horizon-testnet.stellar.org"
FRIENDBOT = "https://friendbot.stellar.org"
MIN_XLM = 10_000_000  # 10 XLM in stroops


async def main() -> int:
    try:
        # --- Secrets & passphrase ---
        secret = require_testnet_secret()
        passphrase = resolve_testnet_passphrase(os.environ.get("NETWORK_PASSPHRASE"))
        caller = public_key_from_secret(secret)
        manager = os.environ.get("VAULT_MANAGER", "").strip() or caller
        base_url = (os.environ.get("NIRIUM_BASE_URL", DEFAULT_BASE_URL)).rstrip("/")

        print("Nirium treasury vault quickstart (testnet, non-custodial)")
        print(f"  caller / signer: {caller}")
        print(f"  manager:         {manager}")
        print(f"  agent:           {base_url}")
        print(f"  passphrase:      {passphrase}")
        print("")

        # --- Preflight XLM ---
        await preflight_xlm(caller, MIN_XLM)

        # --- API key ---
        api_key = await resolve_api_key(base_url, caller)

        # Agent is an HTTP client. It does not receive STELLAR_SECRET_KEY.
        agent = make_agent(base_url, api_key)

        # --- Treasury info ---
        info = await agent.get_treasury_info()
        if info.get("network") and info["network"] != "testnet":
            raise RuntimeError(
                f"Agent is on '{info['network']}', not testnet. "
                f"Point NIRIUM_BASE_URL at the testnet agent."
            )
        print(f"  custody model:   {info.get('signing', 'Every endpoint returns an unsigned XDR.')}")

        # --- Pick asset ---
        asset, strategy, label = pick_asset(info)
        deposit_amount = os.environ.get("DEPOSIT_AMOUNT_STROOPS", "10000000")
        invest = (os.environ.get("INVEST", "false")).lower() == "true"
        withdraw_shares = os.environ.get("WITHDRAW_SHARES_STROOPS", "").strip() or None
        name = os.environ.get("VAULT_NAME", "").strip() or f"Quickstart {caller[-4:]}"
        symbol = (os.environ.get("VAULT_SYMBOL", "").strip() or f"QS{caller[-3:]}")[:10]

        print(f"  vault asset:     {label} {asset}")
        print(f"  strategy:        {strategy}")
        print(f"  deposit:         {deposit_amount} stroops (invest={invest})")
        print(f"  withdraw:        {withdraw_shares or 'all'} shares")
        print("")

        # --- Ensure USDC trustline ---
        if label == "usdc-blend":
            await ensure_usdc_trustline(secret, caller)
            need = required_usdc(deposit_amount)
            print("  (USDC balance check skipped — deposit will fail if insufficient)")

        hashes: dict[str, str] = {}

        # --- 1) DEPLOY VAULT ---
        existing_vault = os.environ.get("VAULT_ID", "").strip()
        if existing_vault:
            vault = existing_vault
            print(f"  reusing vault:   {vault}")
        else:
            print("  deploying vault...")
            deploy = await build_deploy(
                agent,
                manager=manager,
                caller=caller,
                asset=asset,
                strategy=strategy,
                name=name,
                symbol=symbol,
                label=label,
            )
            result = await sign_and_submit(agent, deploy, secret, passphrase)
            vault = vault_id(result) or ""
            if not vault:
                raise RuntimeError("Deploy confirmed but the agent returned no vault id.")
            hashes["Deploy"] = tx_hash(result) or ""
            print(f"    vault:         {vault}")
            print(f"    tx:            {explorer_tx(hashes['Deploy'])}")

        # --- 2) DEPOSIT ---
        print("  depositing...")
        deposit = await build_deposit(
            agent,
            vault=vault,
            caller=caller,
            amounts=[deposit_amount],
            invest=invest,
        )
        result = await sign_and_submit(agent, deposit, secret, passphrase)
        hashes["Deposit"] = tx_hash(result) or ""
        print(f"    tx:            {explorer_tx(hashes['Deposit'])}")

        # --- 3) READ VAULT STATE ---
        print("  reading vault state...")
        vault_state = await agent.get_treasury_vault(vault, holder=caller)
        print(f"  vault:           {vault_state.get('vault', vault)}")
        print(f"  network:         {vault_state.get('network')}")
        if "totalManagedFunds" in vault_state:
            for mf in vault_state["totalManagedFunds"]:
                print(f"    asset:         {mf.get('asset')}")
                print(f"    idle:          {mf.get('idle_amount')}")
                print(f"    invested:      {mf.get('invested_amount')}")
                print(f"    total:         {mf.get('total_amount')}")

        # --- 4) WITHDRAW ---
        print("  withdrawing...")
        withdraw = await build_withdraw(
            agent,
            vault=vault,
            caller=caller,
            shares=withdraw_shares,
        )
        result = await sign_and_submit(agent, withdraw, secret, passphrase)
        hashes["Withdraw"] = tx_hash(result) or ""
        print(f"    tx:            {explorer_tx(hashes['Withdraw'])}")

        # --- Summary for the PR / README hash table ---
        print("")
        print("Transaction hashes (testnet):")
        for step in ("Deploy", "Deposit", "Withdraw"):
            print(f"  {step + ':':<10} {explorer_tx(hashes.get(step))}")
        print("")
        print("Done.")
        return 0

    except QuickstartError as e:
        print(f"Error: {e}", file=sys.stderr)
        return 1
    except Exception as e:
        friendly = explain_failure(e)
        print(f"Error: {friendly}", file=sys.stderr)
        return 1


if __name__ == "__main__":
    sys.exit(asyncio.run(main()))
