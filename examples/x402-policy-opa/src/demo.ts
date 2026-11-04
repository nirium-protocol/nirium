// Demo against a running OPA (see README). No signer, fake contexts.
//   OPA_URL=http://127.0.0.1:8181 npm start
import type { X402PolicyContext } from 'nirium';
import { OpaPolicy } from './opa-policy.ts';

const ctx = (amount: string, to: string, nonce: string) => ({
    contextHash: `hash-${nonce}`,
    signer: 'GAGENT',
    requirements: { network: 'stellar:testnet' },
    authorization: { amount, to, contractId: 'CUSDC', nonce },
}) as unknown as X402PolicyContext;

const policy = new OpaPolicy({ url: process.env.OPA_URL ?? 'http://127.0.0.1:8181' });
const signal = AbortSignal.timeout(2_000);
console.log('bundle revision:', await policy.currentVersion({ signal }));
for (const [amt, to, n] of [['5000000', 'GMERCHANTALLOWED', 'a'], ['20000000', 'GMERCHANTALLOWED', 'b'], ['5000000', 'GOTHER', 'c']] as const) {
    const d = await policy.evaluate(ctx(amt, to, n), { signal });
    console.log(amt, to, '=>', d.decision, d.reason ?? '', d.policyVersion);
}
// Real use:
//   agent.initX402({ signer, network: 'stellar:pubnet', policy: policy.hook() });
