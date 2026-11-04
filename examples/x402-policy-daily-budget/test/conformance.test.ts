// The shared pre-sign policy conformance suite (#226) against DailyBudgetPolicy,
// through the SDK's real gate. Needs the SDK built (see README).
import { runPolicyConformance } from 'nirium/dist/x402-policy-conformance.js';
import { DailyBudgetPolicy } from '../src/daily-budget-policy.ts';

runPolicyConformance({
    name: 'daily-budget',
    // A fresh policy per case, so one case's spend never affects another.
    createHook: () => new DailyBudgetPolicy({ dailyCap: 10_000_000n }).hook(), // 1 USDC a day
    allow: { amount: '2500000' }, // 0.25 USDC
    deny: { amount: '10000001' }, // just over the cap
    // No `wait`: this engine never answers WAIT, so the suite turns its ALLOW into one.
});
