# Risk Signals: Read-Only Vault Concentration Monitor + Owner-Only Signing

A non-custodial Stellar testnet integration demonstrating role separation on a DeFindex treasury vault:

1. **Read-only monitor agent** (`src/monitor.ts`): polls `Agent.getTreasuryVault()`, computes single-strategy concentration (`maxStrategyConcentrationPercent`) and idle reserve ratio (`idleBufferPercent`), and raises a signal when a configured threshold is crossed.
2. **Vault owner** (`src/owner.ts`): reviews the signal and decides whether to act; **only the vault owner key** signs the resulting move transaction (`withdrawFromTreasuryVault` → local `Keypair.fromSecret` XDR signature → `submitTreasuryTx`).

This example demonstrates **who signs** and how read-only monitoring stays isolated from custody. It does not offer investment or allocation advice.

## Custody Boundary

- **Monitor agent holds zero keys:** `RiskMonitorAgent` accepts only a read-only `getTreasuryVault()` client. It never reads `OWNER_SECRET_KEY`, never imports `Keypair`, and cannot sign or submit transactions.
- **Testnet only:** `resolveTestnetPassphrase()` rejects the public/mainnet passphrase before any signature is produced.
- **Owner signs locally:** Unsigned XDRs returned by Nirium are signed inside `src/owner.ts` with the owner's local testnet keypair; the secret seed never leaves the process.

## Prerequisites

- Node.js `>=22.12.0`
- A funded Stellar testnet account you control (for owner-signed move commands; the monitor itself needs no account or API key)

## Setup & Run

```bash
cd examples/build-risk-signals
npm install
cp .env.example .env
# Set VAULT_ID (and OWNER_SECRET_KEY only when running owner-move)
```

Run the read-only monitor (2 readings):

```bash
npm run monitor -- --vault CAQZFPIAZGCME7RDHT2GII5FN7FWHPKUWHX2PLT3JP2A3RM4H2JM2NTQ --readings 2 --interval 10
```

Run the owner-signed move after a signal is raised:

```bash
npm run owner:move -- --vault CAQZFPIAZGCME7RDHT2GII5FN7FWHPKUWHX2PLT3JP2A3RM4H2JM2NTQ
```

### Environment Variables

| Variable | Required | Default | Description |
|---|---|---|---|
| `NIRIUM_BASE_URL` | no | `https://nirium-agent.fly.dev` | Nirium testnet agent URL |
| `VAULT_ID` | yes | — | DeFindex vault contract address (`C...`) |
| `CONCENTRATION_THRESHOLD_PERCENT` | no | `75.0` | Single-strategy share threshold that raises `STRATEGY_CONCENTRATION_HIGH` |
| `MIN_IDLE_BUFFER_PERCENT` | no | `25.0` | Minimum idle reserve percentage before raising `IDLE_BUFFER_LOW` |
| `POLL_INTERVAL_SECONDS` | no | `10` | Delay between readings when `--readings > 1` |
| `NETWORK_PASSPHRASE` | no | `Test SDF Network ; September 2015` | Must be Stellar testnet |
| `OWNER_SECRET_KEY` | owner-move only | — | Vault owner testnet secret (`S...`), never read by the monitor |

## Layout

```text
src/types.ts    vault state, concentration reading, and signal types
src/metrics.ts  concentration / idle-buffer calculation and threshold evaluation
src/monitor.ts  strictly read-only RiskMonitorAgent (zero signing keys)
src/owner.ts    local testnet XDR signing and owner move helpers
src/cli.ts      CLI entry point (`monitor` and `owner-move`)
test/           offline unit tests (zero network calls)
```

## Live Testnet Evidence (2026-11-22)

Executed on Stellar testnet using two freshly generated Friendbot-funded keypairs (never committed):

- **Vault Owner (`manager`):** `GD5O77MONITCZVXTOINOZZ3YQI5XKGWJGXQV6EUA2VI2RI7FWUHTMEWM`
- **Separate `rebalanceManager`:** `GD5ZQTBZLKDDULHSSECQIOZWJH6MFJYJ3QMWGZTQ6R6QYDTQ3XKTV2W5`
- **Deployed Vault Contract:** [`CAQZFPIAZGCME7RDHT2GII5FN7FWHPKUWHX2PLT3JP2A3RM4H2JM2NTQ`](https://stellar.expert/explorer/testnet/contract/CAQZFPIAZGCME7RDHT2GII5FN7FWHPKUWHX2PLT3JP2A3RM4H2JM2NTQ)

### Two Readings & One Signal (Monitor Agent, Zero Keys)

```text
=== Step 5: Monitor Agent Reading #1 (Read-Only, Zero Keys) ===
[Reading #1 | 2026-11-22T18:58:42.972Z] Vault CAQZFPIAZGCME7RDHT2GII5FN7FWHPKUWHX2PLT3JP2A3RM4H2JM2NTQ
  Asset:                CAQCFVLOBK5GIULPNZRGATJJMIZL5BSP7X5YJVMGCPTUEPFM4AVSRCJU
  Total Managed:        0.5000000 (5000000 stroops)
  Invested:             0.0000000 (0 stroops) (0.00%)
  Idle Reserve:         0.5000000 (5000000 stroops) (100.00%)
  Top Strategy:         CALLOM5I7XLQPPOPQMYAHUWW4N7O3JKT42KQ4ASEEVBXDJQNJOALFSUY
  Max Concentration:    0.00%
  Status:               NOMINAL

=== Step 7: Monitor Agent Reading #2 (Raises 1 Signal) ===
[Reading #2 | 2026-11-22T18:58:53.856Z] Vault CAQZFPIAZGCME7RDHT2GII5FN7FWHPKUWHX2PLT3JP2A3RM4H2JM2NTQ
  Asset:                CAQCFVLOBK5GIULPNZRGATJJMIZL5BSP7X5YJVMGCPTUEPFM4AVSRCJU
  Total Managed:        1.9999999 (19999999 stroops)
  Invested:             1.5999999 (15999999 stroops) (79.99%)
  Idle Reserve:         0.4000000 (4000000 stroops) (20.00%)
  Top Strategy:         CALLOM5I7XLQPPOPQMYAHUWW4N7O3JKT42KQ4ASEEVBXDJQNJOALFSUY
  Max Concentration:    79.99%
  Status:               SIGNAL_RAISED

  [SIGNAL: STRATEGY_CONCENTRATION_HIGH]
    Metric:             maxStrategyConcentrationPercent = 79.99% (threshold: 70.00%)
    Suggested Unwind:   0.4000000 (4000000 stroops)
    Note:               Single-strategy concentration reached 79.99% (threshold: 70.00%). Owner review recommended: unwind 4000000 stroops to idle.
    Custody boundary:   Monitor holds NO signing key. Vault owner key required to authorize any move.
```

### Owner-Signed Move Transaction Following the Signal

After Reading #2 raised `STRATEGY_CONCENTRATION_HIGH`, the vault owner signed `withdrawFromTreasuryVault` locally with `GD5O77MONITCZVXTOINOZZ3YQI5XKGWJGXQV6EUA2VI2RI7FWUHTMEWM`:

| Step | Signer | Transaction Hash | Stellar Expert |
|---|---|---|---|
| Vault deploy | `GD5O77...MEWM` | `acb8292b673669fec2cafad0ce91514d9945e99db90d01c8e04a59d7538af9af` | https://stellar.expert/explorer/testnet/tx/acb8292b673669fec2cafad0ce91514d9945e99db90d01c8e04a59d7538af9af |
| Deposit #1 (0.5 USDC idle) | `GD5O77...MEWM` | `26def049039ac569cf4778083f7e3a0274752ad6938d2f5e0bfce8c6f20ad918` | https://stellar.expert/explorer/testnet/tx/26def049039ac569cf4778083f7e3a0274752ad6938d2f5e0bfce8c6f20ad918 |
| Deposit #2 (1.5 USDC idle) | `GD5O77...MEWM` | `c3ad53f7b970e553dac144c712efc3cf45bd991be2d6f295109c2dc59717c142` | https://stellar.expert/explorer/testnet/tx/c3ad53f7b970e553dac144c712efc3cf45bd991be2d6f295109c2dc59717c142 |
| Strategy Invest (to 79.99%) | `GD5ZQT...V2W5` | `a0dbf584a02a99ed4b147501507c2b229fd685ba49986601ab89bc0506fa5197` | https://stellar.expert/explorer/testnet/tx/a0dbf584a02a99ed4b147501507c2b229fd685ba49986601ab89bc0506fa5197 |
| **Owner-signed Withdraw (post-signal move)** | `GD5O77...MEWM` | `381e5ba03f8b7649231cb9c8dc47fce7514a25640644c0d99b828f6571b6bb6e` | https://stellar.expert/explorer/testnet/tx/381e5ba03f8b7649231cb9c8dc47fce7514a25640644c0d99b828f6571b6bb6e |

## Tests (Offline)

All unit tests run offline with zero network calls:

```bash
npm run typecheck
npm test
```
