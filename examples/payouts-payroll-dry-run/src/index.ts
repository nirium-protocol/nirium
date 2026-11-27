import 'dotenv/config';
import { readFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { Keypair, Networks } from '@stellar/stellar-sdk';
import { Agent } from 'nirium';

import { executePayroll } from './execute.ts';
import { parsePayroll, payrollLines } from './payroll.ts';

function argument(flag: string): string | undefined {
    const at = process.argv.indexOf(flag);
    if (at < 0) return undefined;
    if (!process.argv[at + 1] || process.argv[at + 1].startsWith('--')) throw new Error(`Missing value for ${flag}`);
    return process.argv[at + 1];
}

export async function main(): Promise<void> {
    const dryRun = process.argv.includes('--dry-run');
    const execute = process.argv.includes('--execute');
    if (dryRun === execute) throw new Error('Specify exactly one of --dry-run or --execute.');
    const month = argument('--month');
    const csv = argument('--file');
    if (!month || !csv) throw new Error('Required: --month YYYY-MM --file PATH');
    const plan = parsePayroll(month, await readFile(resolve(csv), 'utf8'));
    console.log(payrollLines(plan).join('\n'));
    console.log(`SHA256 plan digest: ${plan.digest}`);
    if (dryRun) {
        console.log('DRY RUN: no keys read, no network requests, no ledger writes.');
        return;
    }
    if ((process.env.NETWORK_PASSPHRASE || Networks.TESTNET) !== Networks.TESTNET) {
        throw new Error('Only Stellar testnet network passphrase is permitted.');
    }
    const secret = process.env.STELLAR_SECRET_KEY?.trim();
    if (!secret) throw new Error('STELLAR_SECRET_KEY is required for --execute.');
    Keypair.fromSecret(secret);
    const baseUrl = (process.env.NIRIUM_BASE_URL ?? 'https://nirium-agent.fly.dev').replace(/\/$/, '');
    const parsedUrl = new URL(baseUrl);
    if (parsedUrl.protocol !== 'https:' && !(parsedUrl.protocol === 'http:' && ['127.0.0.1','localhost'].includes(parsedUrl.hostname))) {
        throw new Error('Nirium API must use HTTPS or localhost HTTP.');
    }
    const apiKey = process.env.NIRIUM_API_KEY?.trim();
    if (!apiKey) throw new Error('NIRIUM_API_KEY is required for --execute (no implicit authentication fallback).');
    const client = new Agent({ baseUrl, apiKey });
    const record = await executePayroll(plan, secret, client, resolve('ledger'));
    console.log(`Nirium run: ${record.runId}`);
    console.log(`Testnet tx: https://stellar.expert/explorer/testnet/tx/${record.txHash}`);
    if (record.cid) console.log(`Receipt CID: ${record.cid}`);
}

if (import.meta.url === `file://${process.argv[1]?.replace(/\\/g, '/')}`) {
    main().catch((error: unknown) => {
        console.error('Payroll failed:', error instanceof Error ? error.message : 'Unknown error');
        process.exitCode = 1;
    });
}
