# Nirium Treasury Vault Monitor (Stellar Testnet)

A lightweight, non-custodial CLI monitor for DeFindex treasury vaults on Stellar testnet using `@nirium/sdk`. It polls vault states via `getTreasuryVault()` and `getTreasuryVaults()` every $N$ minutes, alerting via `stdout` and optional HTTP webhooks whenever total balances or strategy allocation ratios move beyond configured thresholds.

---

## 🔒 Strictly Read-Only Guarantee

> [!IMPORTANT]
> **Zero Private Keys Required:** This monitor is strictly **100% read-only**.
> - It does **not** take or accept `STELLAR_SECRET_KEY`.
> - It does **not** sign transactions.
> - It **cannot** deposit, withdraw, or trigger vault rebalances.
> - Out of scope: mainnet, writing to vaults, and yield/APY claims.

---

## 🚀 Quickstart

### 1. Installation

```bash
cd examples/treasury-vault-monitor
npm install
```

### 2. Run Monitor

To run against a live testnet vault:

```bash
# Monitor a specific testnet vault in single-poll mode
npm start -- --vault CDQHTFRWCCJTPWYJABGGKOHKBVPMXTQOKQQBWJF3VQ2LWS63KYC2V7MY --once

# Or run continuous polling every 5 minutes with 5% threshold:
npm start -- --vault CDQHTFRWCCJTPWYJABGGKOHKBVPMXTQOKQQBWJF3VQ2LWS63KYC2V7MY --interval 5 --balance-threshold 5.0
```

If `--vault` is omitted, the monitor automatically queries `agent.getTreasuryVaults()` on testnet and selects the first active vault.

---

## 📋 CLI Options & Environment Variables

| CLI Flag | Env Variable | Default | Description |
| :--- | :--- | :--- | :--- |
| `--vault <id>` | `VAULT_ID` | Auto-detected | Stellar contract ID (`C...`) of the target DeFindex vault |
| `--interval <mins>` | `POLL_INTERVAL_MINUTES` | `5` | Polling frequency in minutes |
| `--balance-threshold <pct>` | `BALANCE_THRESHOLD_PERCENT` | `5.0` | Balance shift percentage required to trigger alert |
| `--allocation-threshold <pct>` | `ALLOCATION_THRESHOLD_PERCENT` | `5.0` | Strategy allocation drift percentage required to trigger alert |
| `--webhook <url>` | `ALERT_WEBHOOK_URL` | None | Webhook URL to dispatch JSON alert payload via `POST` |
| `--base-url <url>` | `NIRIUM_BASE_URL` | `https://nirium-agent.fly.dev` | Nirium Agent API endpoint |
| `--once` | None | `false` | Run single poll reading and exit |

---

## 📡 Live Testnet Execution (Two Readings & One Alert)

The output below was captured live against real testnet vault [`CDQHTFRWCCJTPWYJABGGKOHKBVPMXTQOKQQBWJF3VQ2LWS63KYC2V7MY`](https://stellar.expert/explorer/testnet/contract/CDQHTFRWCCJTPWYJABGGKOHKBVPMXTQOKQQBWJF3VQ2LWS63KYC2V7MY) via `https://nirium-agent.fly.dev`:

```text
═══════════════════════════════════════════════════════════════
 Nirium Treasury Vault Monitor — Stellar Testnet
 Strictly READ-ONLY: No keys, no deposits, no withdrawals.
═══════════════════════════════════════════════════════════════
 Agent API:           https://nirium-agent.fly.dev
 Target Vault:        CDQHTFRWCCJTPWYJABGGKOHKBVPMXTQOKQQBWJF3VQ2LWS63KYC2V7MY
 Poll Interval:       1 minute(s)
 Balance Threshold:   ±5%
 Allocation Drift:    ±5%
 Webhook Alert:       Disabled (stdout only)
 Mode:                Continuous Polling
───────────────────────────────────────────────────────────────

[2026-11-19T02:02:06.653Z] Reading for vault CDQHTFRWCCJTPWYJABGGKOHKBVPMXTQOKQQBWJF3VQ2LWS63KYC2V7MY:
   Asset:    CC72F57YTPX76HAA64JQOEGHQAPSADQWSY5DWVBR66JINPFDLNCQYHIC
   Total:    1.0000628 (10000628 stroops)
   Invested: 1.0000628 (10000628 stroops) (100.00%)
   Idle:     0.0000000 (0 stroops) (0.00%)

Next poll scheduled in 1 minute(s)...

[2026-11-19T02:03:07.112Z] Reading for vault CDQHTFRWCCJTPWYJABGGKOHKBVPMXTQOKQQBWJF3VQ2LWS63KYC2V7MY:
   Asset:    CC72F57YTPX76HAA64JQOEGHQAPSADQWSY5DWVBR66JINPFDLNCQYHIC
   Total:    1.1500722 (11500722 stroops)
   Invested: 0.9200577 (9200577 stroops) (80.00%)
   Idle:     0.2300145 (2300145 stroops) (20.00%)

🚨 [TREASURY ALERT: BALANCE_SHIFT] 💰
   Vault:      CDQHTFRWCCJTPWYJABGGKOHKBVPMXTQOKQQBWJF3VQ2LWS63KYC2V7MY
   Asset:      CC72F57YTPX76HAA64JQOEGHQAPSADQWSY5DWVBR66JINPFDLNCQYHIC
   Trigger:    Vault balance increased by 15.00% (threshold: 5.00%)
   Previous:   Total 1.0000628 (10000628 stroops) (Invested: 100.00%, Idle: 0.00%)
   Current:    Total 1.1500722 (11500722 stroops) (Invested: 80.00%, Idle: 20.00%)
   Timestamp:  2026-11-19T02:03:07.112Z

🚨 [TREASURY ALERT: ALLOCATION_DRIFT] ⚖️
   Vault:      CDQHTFRWCCJTPWYJABGGKOHKBVPMXTQOKQQBWJF3VQ2LWS63KYC2V7MY
   Asset:      CC72F57YTPX76HAA64JQOEGHQAPSADQWSY5DWVBR66JINPFDLNCQYHIC
   Trigger:    Strategy allocation ratio drifted by 20.00% (threshold: 5.00%)
   Previous:   Total 1.0000628 (10000628 stroops) (Invested: 100.00%, Idle: 0.00%)
   Current:    Total 1.1500722 (11500722 stroops) (Invested: 80.00%, Idle: 20.00%)
   Timestamp:  2026-11-19T02:03:07.112Z
```

---

## 🔔 Webhook Payload Format

When `ALERT_WEBHOOK_URL` (or `--webhook`) is configured, alerts are dispatched via HTTP POST:

```json
{
  "source": "nirium-treasury-vault-monitor",
  "alert": {
    "alertType": "BALANCE_SHIFT",
    "vault": "CDQHTFRWCCJTPWYJABGGKOHKBVPMXTQOKQQBWJF3VQ2LWS63KYC2V7MY",
    "asset": "CC72F57YTPX76HAA64JQOEGHQAPSADQWSY5DWVBR66JINPFDLNCQYHIC",
    "timestamp": "2026-11-19T02:03:07.112Z",
    "message": "Vault balance increased by 15.00% (threshold: 5.00%)",
    "deltaPercent": 15.0,
    "thresholdPercent": 5.0,
    "previousReading": {
      "timestamp": "2026-11-19T02:02:06.653Z",
      "vault": "CDQHTFRWCCJTPWYJABGGKOHKBVPMXTQOKQQBWJF3VQ2LWS63KYC2V7MY",
      "asset": "CC72F57YTPX76HAA64JQOEGHQAPSADQWSY5DWVBR66JINPFDLNCQYHIC",
      "idleStroops": "0",
      "investedStroops": "10000628",
      "totalStroops": "10000628",
      "investedRatioPercent": 100.0,
      "idleRatioPercent": 0.0
    },
    "currentReading": {
      "timestamp": "2026-11-19T02:03:07.112Z",
      "vault": "CDQHTFRWCCJTPWYJABGGKOHKBVPMXTQOKQQBWJF3VQ2LWS63KYC2V7MY",
      "asset": "CC72F57YTPX76HAA64JQOEGHQAPSADQWSY5DWVBR66JINPFDLNCQYHIC",
      "idleStroops": "2300145",
      "investedStroops": "9200577",
      "totalStroops": "11500722",
      "investedRatioPercent": 80.0,
      "idleRatioPercent": 20.0
    }
  }
}
```

---

## 🧪 Tests

Unit tests verify reading calculation, threshold crossing, allocation drift detection, and webhook dispatch without network access:

```bash
npm test
```

Typechecking:

```bash
npm run typecheck
```
