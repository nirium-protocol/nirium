# Non-custodial Treasury Vault Quickstart (Python)

A complete Python loop against a **live Stellar testnet** DeFindex vault:

1. `deploy_treasury_vault` → sign the unsigned XDR with **your** key → `submit_treasury_tx`
2. `deposit_to_treasury_vault` → sign → `submit_treasury_tx`
3. `get_treasury_vault` → print the idle / invested split

This is the Python equivalent of `examples/treasury-vault-quickstart` (TypeScript).

## Why this is non-custodial

- **Nirium builds unsigned XDR.** `deploy_treasury_vault` and `deposit_to_treasury_vault`
  return `xdr` + `signWith`. Nothing is submitted until you sign.
- **`Agent` never touches a private key on this path.** This example constructs
  `Agent({api_key, base_url})` — it receives no `S...` secret. Signing is done
  locally with `stellar-sdk` (`Keypair.from_secret` in `src/sign.py`).
- **Every signature comes from the caller's own keypair.** `manager` is set to
  *your* testnet address (the role that can rescue funds, pause strategies, and
  revoke rebalance). Nirium, if present at all, only holds `RebalanceManager`,
  which cannot withdraw.

This example is **deploy + deposit only**. It does not call `execute_treasury_rebalance`
or the RebalanceManager endpoints.

## Prerequisites

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

## Run (under 10 minutes)

```bash
cd examples/treasury-vault-quickstart-python
cp .env.example .env
# put your own testnet S... key in .env - never a Nirium key, never mainnet
pip install -r requirements.txt
python main.py
```

The script prints two `https://stellar.expert/explorer/testnet/tx/<hash>` links
(deploy + deposit) and the vault's idle / invested amounts.

### Transaction hashes (testnet)

| Step | Transaction | Stellar Expert |
|------|-------------|----------------|
| Deploy | `<hash>` | `https://stellar.expert/explorer/testnet/tx/<hash>` |
| Deposit | `<hash>` | `https://stellar.expert/explorer/testnet/tx/<hash>` |

*(Fill in after a successful run)*

## Environment

| Variable | Required | Default |
|---|---|---|
| `STELLAR_SECRET_KEY` | yes | - (your testnet `S...` only) |
| `NIRIUM_API_KEY` | no | public `demo-auth` token |
| `NIRIUM_BASE_URL` | no | `https://nirium-agent.fly.dev` |
| `VAULT_ASSET` | no | `usdc` (from treasury info) |
| `DEPOSIT_AMOUNT_STROOPS` | no | `10000000` (1.0 with 7 decimals) |
| `INVEST` | no | `false` (deposit stays idle so the split is obvious) |
| `VAULT_ID` | no | Reuse an already-deployed vault and skip deploy |
| `VAULT_MANAGER` | no | defaults to caller (your G-address) |
| `VAULT_NAME` | no | `Quickstart <last4>` |
| `VAULT_SYMBOL` | no | `QS<last3>` (max 10 chars) |
| `NETWORK_PASSPHRASE` | no | `Test SDF Network ; September 2015` |

Mainnet is out of scope. Setting the public network passphrase is rejected
before any signature is produced.

## Failure modes this example handles

- **Insufficient balance** — missing testnet account, not enough XLM to deploy,
  or not enough of the vault asset to deposit. The script preflights XLM on
  Horizon and rewrites agent/Horizon errors into a Friendbot + asset hint.

- **Wrong network passphrase** — signing a testnet XDR with the public
  passphrase (or pointing `NETWORK_PASSPHRASE` at mainnet). `src/sign.py`
  refuses to sign unless the passphrase is exactly testnet.

## Tests (no network)

```bash
cd examples/treasury-vault-quickstart-python
pip install -r requirements.txt
python -m pytest test/ -v
```

Tests cover:
- Passphrase resolution (accepts testnet, rejects public)
- Public key derivation from secret
- XDR signing with testnet passphrase
- Refusal to sign under public passphrase
- Error classification (insufficient balance, unfunded account, missing trustline, passphrase mismatch)

## Secret handling

- **Never** commit `.env` or any `S...` secret.
- The script loads `STELLAR_SECRET_KEY` from `.env` (gitignored via root `.gitignore`).
- The secret is only used locally to sign XDR; it never leaves this machine
  and is never sent to the Nirium agent or logged.