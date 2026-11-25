# Non-custodial Treasury Vault Quickstart (Python)

A complete Python loop against a **live Stellar testnet** DeFindex vault:

1. `deploy_treasury_vault` → sign the unsigned XDR with **your** key → `submit_treasury_tx`
2. `deposit_to_treasury_vault` → sign → `submit_treasury_tx`
3. `get_treasury_vault` → print the idle / invested split
4. `withdraw_from_treasury_vault` → sign → `submit_treasury_tx`

Every XDR returned by the API is signed locally with your own testnet key before
`submit_treasury_tx` broadcasts it. This is the Python equivalent of
`examples/treasury-vault-quickstart` (TypeScript).

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

This example runs the full deploy → deposit → read state → withdraw loop. It does
not call `execute_treasury_rebalance` or the RebalanceManager endpoints.

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

The script prints a `https://stellar.expert/explorer/testnet/tx/<hash>` link for
each submitted transaction (deploy, deposit, withdraw), the vault's idle /
invested amounts, and a ready-to-paste hash summary at the end.

### Transaction hashes (testnet)

| Step | Transaction | Stellar Expert |
|------|-------------|----------------|
| Deploy | `9d3fc51ecfb22302855106b57711ebd5ab6200abf15a910471f6860483696b12` | https://stellar.expert/explorer/testnet/tx/9d3fc51ecfb22302855106b57711ebd5ab6200abf15a910471f6860483696b12 |
| Deposit | `06573f03ce3ad2a9eefa7c6efa33baac7fc2da481c6756a823f0068ea2c4bced` | https://stellar.expert/explorer/testnet/tx/06573f03ce3ad2a9eefa7c6efa33baac7fc2da481c6756a823f0068ea2c4bced |
| Withdraw | `6d826446826ac706b8d338b40c51860bbd19e3cb5e01e536b4dc3fd03058e422` | https://stellar.expert/explorer/testnet/tx/6d826446826ac706b8d338b40c51860bbd19e3cb5e01e536b4dc3fd03058e422 |

All three were broadcast to **Stellar testnet** and each is reported `successful: true`
by `https://horizon-testnet.stellar.org/transactions/<hash>` (ledgers 5837026,
5837027 and 5837029). The vault created in the run was
`CDKOOOU25N335WUIRSXNONPNOA56UPQ4FLHMFDTGQGRLN2W57PUJUVZK`, funded through
Friendbot plus the public Blend testnet faucet; the signing key was a random
testnet keypair generated in memory for the run and never written to disk,
a log or this repository.

*Reading the vault state is a read-only call and produces no transaction hash.*
The script prints the real hashes at the end of every run — paste them into this
table when you run it with your own funded testnet account. Hashes are never
fabricated: a deploy/deposit/withdraw only produces a hash after a real testnet
submission.

## Environment

| Variable | Required | Default |
|---|---|---|
| `STELLAR_SECRET_KEY` | yes | - (your testnet `S...` only) |
| `NIRIUM_API_KEY` | no | public `demo-auth` token |
| `NIRIUM_BASE_URL` | no | `https://nirium-agent.fly.dev` |
| `VAULT_ASSET` | no | `usdc` (from treasury info) |
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
- **Request bodies contain only signed XDR and never the secret** (`test/request_body_test.py`,
  real `Agent` with `aiohttp.ClientSession` mocked, no network)

## Secret handling

- **Never** commit `.env` or any `S...` secret.
- The script loads `STELLAR_SECRET_KEY` from `.env` (gitignored via root `.gitignore`).
- The secret is only used locally to sign XDR; it never leaves this machine
  and is never sent to the Nirium agent or logged.