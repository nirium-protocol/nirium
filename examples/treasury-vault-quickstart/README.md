# Non-custodial treasury vault quickstart

A complete TypeScript loop against a **live Stellar testnet** DeFindex vault:

1. `deployTreasuryVault({ caller, manager })` → sign the unsigned XDR with **your** key → `submitTreasuryTx`
2. `depositToTreasuryVault({ vault, from, amounts })` → sign → `submitTreasuryTx`
3. `getTreasuryVault(vault, holder)` → print the idle / invested split

Nirium's SDK never holds a signing key in this path. The Agent only builds and broadcasts XDR.

## Why this is non-custodial

- **Nirium builds unsigned XDR.** `deployTreasuryVault` and `depositToTreasuryVault` return `xdr` + `signWith`. Nothing is submitted until you sign.
- **`Agent` never touches a private key on this path.** This example constructs `new Agent({ apiKey, baseUrl })` - it receives no `S...` secret. Signing is done locally with `@stellar/stellar-sdk` (`Keypair.fromSecret` in `src/sign.ts`).
- **Every signature comes from the caller's own keypair.** `manager` is set to *your* testnet address (the role that can rescue funds, pause strategies, and revoke rebalance). Nirium, if present at all, only holds `RebalanceManager`, which cannot withdraw. A browser port would sign with Freighter the same way: the wallet holds the key, the SDK does not.

This issue is deploy + deposit only. It does not call `executeTreasuryRebalance` or the RebalanceManager endpoints.

## Prerequisites

- Node.js >=22.12.0 (`@stellar/stellar-sdk` 16.x requires it)
- A **funded Stellar testnet** account you control:
  - **XLM** for fees / contract deploy - [Friendbot](https://friendbot.stellar.org) (`https://friendbot.stellar.org?addr=G...`)
  - A small balance of the vault asset. Default is **Blend testnet USDC** (`USDC-GATALTG…`, contract `CAQCFV…`) - not Circle USDC. The script opens that trustline if it is missing; then click Faucet on [testnet.blend.capital](https://testnet.blend.capital). Set `VAULT_ASSET=cetes` if you hold testnet CETES instead.

You do **not** need a Nirium institutional API key. The script requests a public demo token with your G-address.

## Run (under 10 minutes)

```bash
cd examples/treasury-vault-quickstart
cp .env.example .env
# put your own testnet S... key in .env - never a Nirium key, never mainnet
npm install
npm start
```

The script prints two `stellar.expert/explorer/testnet/tx/<hash>` links (deploy + deposit) and the vault's idle / invested amounts.

### Environment

| Variable | Required | Default |
|---|---|---|
| `STELLAR_SECRET_KEY` | yes | - (your testnet `S...` only) |
| `NIRIUM_API_KEY` | no | public `demo-auth` token |
| `NIRIUM_BASE_URL` | no | `https://nirium-agent.fly.dev` |
| `VAULT_ASSET` | no | `usdc` (`cetes` also supported) |
| `DEPOSIT_AMOUNT_STROOPS` | no | `10000000` (1.0 with 7 decimals) |
| `INVEST` | no | `false` (deposit stays idle so the split is obvious) |
| `VAULT_ID` | no | Reuse an already-deployed vault and skip deploy |
| `NETWORK_PASSPHRASE` | no | `Test SDF Network ; September 2015` |

Mainnet is out of scope. Setting the public network passphrase is rejected before any signature is produced.

## Failure modes this example handles

The two that show up in this repo's own history:

- **Insufficient balance** - missing testnet account, not enough XLM to deploy, or not enough of the vault asset to deposit. The script preflights XLM on Horizon and rewrites agent/Horizon errors into a Friendbot + asset hint.
- **Wrong network passphrase** - signing a testnet XDR with the public passphrase (or pointing `NETWORK_PASSPHRASE` at mainnet). `src/sign.ts` refuses to sign unless the passphrase is exactly testnet.

```bash
npm test
npm run typecheck
```

## Layout

```
src/index.ts   end-to-end loop (deploy → sign → submit → deposit → sign → submit → read)
src/sign.ts    local keypair signing; testnet passphrase guard
src/auth.ts    demo-auth + optional Bearer header
src/errors.ts  insufficient-balance / passphrase error mapping
src/usdc.ts    BlendUSDC trustline + balance preflight (not Circle USDC)
```

SDK methods used: `Agent.deployTreasuryVault`, `Agent.depositToTreasuryVault`, `Agent.submitTreasuryTx`, `Agent.getTreasuryVault`, `Agent.getTreasuryInfo` (`nirium@0.12.0`).
