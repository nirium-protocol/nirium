# x402 policy: daily budget per agent

A small, runnable policy engine for the SDK's [pre-sign policy hook](../../packages/sdk/README.md#pre-sign-policy-hook-experimental) (`initX402({ policy })`, experimental since 0.16.0). Every `x402Fetch()` asks it before signing, and it answers `ALLOW` or `DENY` based on a per-agent daily spend cap.

**This is a reference, not a guarantee.** Read [What this does not solve](#what-this-does-not-solve) before relying on it.

## What it does

- **Daily cap per agent.** The agent is the signer address (`ctx.signer`); the day is the UTC calendar day. One default cap, optional per-agent overrides. Amounts are base units of the asset (`BigInt`, no floats).
- **Atomic check-and-commit.** `tryCommit` adds the amount only if `spent today + amount <= cap`, in one step. Two concurrent requests can never both pass on the same remaining budget: one gets `ALLOW`, the other `DENY`.
- **Bound, short-lived ALLOW.** An `ALLOW` echoes the exact `ctx.contextHash` and carries `expiresAt = now + ttlMs` (default 2 s). `requireExpiry: true` is set on the hook.
- **Fails closed on policy change.** `currentVersion()` is wired; `update()` bumps the version, so an `ALLOW` issued before a change is refused by the SDK with `STALE`.

## Use

```typescript
import { DailyBudgetPolicy } from './src/daily-budget-policy.ts';

const budget = new DailyBudgetPolicy({
  dailyCap: 10_000_000n,           // 1 USDC per agent per day (7 decimals)
  caps: { 'GAB...': 50_000_000n },   // optional overrides
  ttlMs: 2_000,
});

agent.initX402({ signer, network: 'stellar:pubnet', policy: budget.hook() });
```

Requires Node >= 22.12 (npm 10), the same as the SDK. No `--legacy-peer-deps` is needed here; with npm 9 / Node 20, `npm ci` rejects the lockfile.

```bash
npm install
npm test        # node:test via tsx, no network
npm run typecheck
npm start       # offline demo with fake contexts
```

The SDK is referenced as `file:../../packages/sdk` and only its types are imported, so build it once (`cd ../../packages/sdk && npm install --legacy-peer-deps && npm run build`, as the SDK CI does; `@stellar/mpp` 0.7.1 still declares a peer of `@stellar/stellar-sdk` ^15) before `typecheck`.

## Multi-process: map it to SQL

The in-memory store is atomic only inside one process (no `await` between read and write). Across processes, make the database do the check in a single conditional write:

```sql
INSERT INTO agent_daily_spend (agent, day, spent) VALUES ($1, $2, 0) ON CONFLICT DO NOTHING;

UPDATE agent_daily_spend
   SET spent = spent + $3
 WHERE agent = $1 AND day = $2 AND spent + $3 <= $4
RETURNING spent;   -- 0 rows => DENY
```

Never `SELECT` the spend and then `UPDATE` it: that reintroduces the race.

## What this does not solve

These are the limits listed in the SDK README (from [#96](https://github.com/nirium-protocol/nirium/issues/96)). This example does not remove them.

- **L01, pending-capacity reservation.** The budget is committed when the policy says `ALLOW`, not when the payment settles. A payment that is allowed but then refused by a later SDK check (`STALE`, `EXPIRED`, ...), fails at the signer, or is never settled by the facilitator still counts against today's budget, and there is no release or reconciliation against on-chain settlement here. The opposite also holds: nothing ties the committed amount to what actually lands on-chain. Real reservation of capacity across signed-but-unsettled payments is not solved.
- **L02, same-process signer access.** This is a check on the agent side. Any code in the same process that holds the raw signer (or replaces its `signAuthEntry`) can sign without asking this policy. Nothing on-chain enforces the cap.
- **Version check is not atomic with signing.** As the SDK README says, `currentVersion()` narrows the stale-ALLOW window; it does not close it.
- **In-memory state.** Restarting the process resets the spend. Use a durable store (see SQL above) for anything real.

For a fuller engine (reserve floor, per-action caps, approvals, hash-chained audit trail), see [AgentLedger](https://useagentledger.xyz).
