import { createHash } from 'node:crypto';
import { Keypair } from '@stellar/stellar-sdk';

const SCALE = 10_000_000n;
const MONTH = /^\d{4}-(0[1-9]|1[0-2])$/;
const AMOUNT = /^(0|[1-9]\d*)(?:\.(\d{1,7}))?$/;
const ID = /^[A-Za-z0-9_-]{1,64}$/;

export type PayrollRow = Readonly<{ contractorId: string; wallet: string; amount: string }>;
export type PayrollPlan = Readonly<{
    month: string;
    asset: 'XLM';
    rows: readonly PayrollRow[];
    total: string;
    digest: string;
}>;

export function toStroops(input: string): bigint {
    const match = AMOUNT.exec(input);
    if (!match) throw new Error('Amount must be a non-negative decimal with up to seven places.');
    return BigInt(match[1]) * SCALE + BigInt((match[2] ?? '').padEnd(7, '0'));
}

export function formatAmount(value: bigint): string {
    return `${value / SCALE}.${(value % SCALE).toString().padStart(7, '0')}`;
}

export function parsePayroll(month: string, csv: string): PayrollPlan {
    if (!MONTH.test(month)) throw new Error('Month must be YYYY-MM.');
    const lines = csv.replace(/^\uFEFF/, '').trim().split(/\r?\n/);
    if (lines.shift()?.trim() !== 'contractor_id,wallet,amount') {
        throw new Error('Expected CSV header: contractor_id,wallet,amount');
    }
    if (!lines.length || lines.length > 100) throw new Error('Payroll requires 1 to 100 rows.');
    const seenIds = new Set<string>();
    const seenWallets = new Set<string>();
    let total = 0n;
    const rows: PayrollRow[] = lines.map((line, index) => {
        const parts = line.split(',').map((part) => part.trim());
        if (parts.length !== 3) throw new Error(`Invalid CSV at row ${index + 2}; quoted commas are not supported.`);
        const [contractorId, wallet, rawAmount] = parts;
        if (!ID.test(contractorId) || seenIds.has(contractorId)) throw new Error(`Invalid or duplicate contractor ID at row ${index + 2}.`);
        try { Keypair.fromPublicKey(wallet); } catch { throw new Error(`Invalid Stellar wallet at row ${index + 2}.`); }
        if (seenWallets.has(wallet)) throw new Error(`Duplicate wallet at row ${index + 2}.`);
        const amount = toStroops(rawAmount);
        if (amount <= 0n) throw new Error(`Non-positive amount at row ${index + 2}.`);
        seenIds.add(contractorId);
        seenWallets.add(wallet);
        total += amount;
        return { contractorId, wallet, amount: formatAmount(amount) };
    });
    const digest = createHash('sha256').update(JSON.stringify({ month, asset: 'XLM', rows })).digest('hex');
    return { month, asset: 'XLM', rows, total: formatAmount(total), digest };
}

export function payrollLines(plan: PayrollPlan): string[] {
    return [
        `MONTH ${plan.month} | ASSET ${plan.asset} | RECIPIENTS ${plan.rows.length}`,
        ...plan.rows.map((row, i) => `${i + 1}. ${row.contractorId} | ${row.wallet} | ${row.amount} ${plan.asset}`),
        `TOTAL ${plan.total} ${plan.asset}`,
    ];
}
