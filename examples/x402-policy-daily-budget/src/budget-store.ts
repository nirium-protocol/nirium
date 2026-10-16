// Daily spend store with an atomic check-and-commit.
//
// The whole point of this file is `tryCommit`: the read of today's spend and the
// write of the new total happen in one step, so two concurrent requests can never
// both pass on the same remaining budget.
//
// In-memory: tryCommit is synchronous (no await between read and write), and
// JavaScript runs it to completion before any other callback, so it is atomic
// within one process. For several processes, use one conditional write in your
// database instead, e.g. in SQL:
//
//   INSERT INTO agent_daily_spend (agent, day, spent) VALUES ($agent, $day, 0)
//     ON CONFLICT DO NOTHING;
//   UPDATE agent_daily_spend
//      SET spent = spent + $amt
//    WHERE agent = $agent AND day = $day AND spent + $amt <= $cap
//   RETURNING spent;            -- 0 rows => DENY
//
// The row count of that UPDATE is the decision; never SELECT then UPDATE.

export interface CommitResult {
    ok: boolean;
    /** Spend for (agent, day) after the call, in the asset's base units. */
    spent: bigint;
}

export interface BudgetStore {
    tryCommit(agent: string, day: string, amount: bigint, cap: bigint): CommitResult;
    spent(agent: string, day: string): bigint;
}

export class InMemoryBudgetStore implements BudgetStore {
    private readonly rows = new Map<string, bigint>();

    tryCommit(agent: string, day: string, amount: bigint, cap: bigint): CommitResult {
        const key = `${agent}|${day}`;
        const current = this.rows.get(key) ?? 0n;
        // Not a single `await` in here: that is what keeps it atomic.
        if (amount <= 0n || current + amount > cap) return { ok: false, spent: current };
        const next = current + amount;
        this.rows.set(key, next);
        return { ok: true, spent: next };
    }

    spent(agent: string, day: string): bigint {
        return this.rows.get(`${agent}|${day}`) ?? 0n;
    }
}
