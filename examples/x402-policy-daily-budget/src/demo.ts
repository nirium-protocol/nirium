// Offline demo: runs the policy against fake contexts. No network, no signer.
import type { X402PolicyContext } from 'nirium';
import { DailyBudgetPolicy } from './daily-budget-policy.ts';

const ctx = (amount: string, nonce: string) => ({
    contextHash: `hash-${nonce}`,
    signer: 'GAGENT',
    authorization: { amount, nonce },
}) as unknown as X402PolicyContext;

const policy = new DailyBudgetPolicy({ dailyCap: 1_000_000n }); // 0.1 USDC (7 decimals)
for (const [amt, n] of [['600000', 'a'], ['600000', 'b'], ['400000', 'c']] as const) {
    const d = await policy.evaluate(ctx(amt, n));
    console.log(amt, '=>', d.decision, d.reason ?? '');
}
// Real use:
//   agent.initX402({ signer, network: 'stellar:pubnet', policy: policy.hook() });
