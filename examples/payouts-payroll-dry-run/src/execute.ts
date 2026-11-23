import { mkdir, open, readFile, rename, unlink, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { Keypair, Networks, TransactionBuilder } from '@stellar/stellar-sdk';
import type { PayoutRun, PayoutRunOptions } from 'nirium';

import { toStroops, type PayrollPlan } from './payroll.ts';

export type PayoutClient = {
    createPayoutRun(options: PayoutRunOptions): Promise<PayoutRun>;
    submitPayout(runId: string, signedXdr: string): Promise<PayoutRun>;
};

export type LedgerRecord = {
    month: string;
    digest: string;
    state: 'pending' | 'completed';
    runId?: string;
    txHash?: string;
    cid?: string;
};

/** Reject anything except exact payer-sourced XLM payments listed in this month's CSV. */
export function validateAndSign(xdr: string, plan: PayrollPlan, secret: string): string {
    const payer = Keypair.fromSecret(secret);
    const transaction = TransactionBuilder.fromXDR(xdr, Networks.TESTNET);
    if (!('operations' in transaction) || !('source' in transaction)) {
        throw new Error('Expected a classic Stellar transaction, not a fee-bump.');
    }
    if (transaction.source !== payer.publicKey()) throw new Error('Transaction source does not match local payer.');
    if (transaction.operations.length !== plan.rows.length) throw new Error('Transaction payment count differs from payroll.');
    // A malicious unsigned payload must not spend arbitrary XLM on transaction fees.
    if (BigInt(transaction.fee) > 10_000n * BigInt(plan.rows.length)) {
        throw new Error('Unsigned XDR fee exceeds the testnet payroll safety limit.');
    }
    transaction.operations.forEach((op, index) => {
        const row = plan.rows[index];
        if (op.type !== 'payment' || (op.source && op.source !== payer.publicKey()) ||
            op.destination !== row.wallet || !op.asset.isNative() ||
            toStroops(op.amount) !== toStroops(row.amount)) {
            throw new Error(`Unsigned XDR does not match payroll row ${index + 1}; refusing signature.`);
        }
    });
    transaction.sign(payer);
    return transaction.toXDR();
}

async function atomicLedgerWrite(file: string, record: LedgerRecord): Promise<void> {
    const tmp = `${file}.${process.pid}.tmp`;
    try {
        await writeFile(tmp, JSON.stringify(record, null, 2) + '\n', { flag: 'wx', mode: 0o600 });
        await rename(tmp, file);
    } catch (err) {
        await unlink(tmp).catch(() => undefined);
        throw err;
    }
}

/**
 * Month-level, fail-closed guard: reserve the month on disk BEFORE any network request.
 * A pending record is intentionally not retried; resolve it against testnet manually.
 */
export async function executePayroll(
    plan: PayrollPlan,
    secret: string,
    client: PayoutClient,
    ledgerDir: string,
): Promise<LedgerRecord> {
    await mkdir(ledgerDir, { recursive: true, mode: 0o700 });
    const file = join(ledgerDir, `${plan.month}.json`);
    const lockFile = join(ledgerDir, `${plan.month}.lock`);
    const lock = await open(lockFile, 'wx', 0o600);
    try {
        let existing: LedgerRecord | undefined;
        try {
            existing = JSON.parse(await readFile(file, 'utf8')) as LedgerRecord;
        } catch (err) {
            if ((err as NodeJS.ErrnoException).code !== 'ENOENT') throw err;
        }
        if (existing) {
            throw new Error(existing.state === 'completed'
                ? `Payroll ${plan.month} already submitted (${existing.txHash}); no duplicate payment.`
                : `Payroll ${plan.month} has an unresolved pending submission. Reconcile on testnet; no automatic retry.`);
        }
        const record: LedgerRecord = { month: plan.month, digest: plan.digest, state: 'pending' };
        await atomicLedgerWrite(file, record);
        const payer = Keypair.fromSecret(secret).publicKey();
        const run = await client.createPayoutRun({
            recipients: plan.rows.map((row) => ({ wallet: row.wallet, amount: row.amount })),
            asset: 'XLM',
            treasury: payer,
            memo: `Contractors ${plan.month}`,
            runId: `payroll-${plan.month}-${plan.digest.slice(0, 12)}`,
            acknowledgeTerms: true,
        });
        if (typeof run.runId !== 'string' || !run.runId || typeof run.xdr !== 'string' || !run.xdr) {
            throw new Error('Nirium did not return the runId and unsigned transaction XDR.');
        }
        record.runId = run.runId;
        await atomicLedgerWrite(file, record);
        if (run.untrustedRecipients && Array.isArray(run.untrustedRecipients) && run.untrustedRecipients.length) {
            throw new Error('Nirium returned untrusted recipients; resolve before an operator-reviewed reset.');
        }
        const signedXdr = validateAndSign(run.xdr, plan, secret);
        const result = await client.submitPayout(run.runId, signedXdr);
        if (typeof result.txHash !== 'string' || !/^[0-9a-fA-F]{64}$/.test(result.txHash)) {
            throw new Error('Submission has no valid transaction hash: outcome uncertain; inspect testnet before any reset.');
        }
        record.state = 'completed';
        record.txHash = result.txHash;
        if (typeof result.cid === 'string') record.cid = result.cid;
        await atomicLedgerWrite(file, record);
        return record;
    } finally {
        await lock.close();
        await unlink(lockFile);
    }
}
