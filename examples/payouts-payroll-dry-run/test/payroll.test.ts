import assert from 'node:assert/strict';
import { mkdtemp, readFile, readdir, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { test } from 'node:test';
import { Account, Asset, Keypair, Networks, Operation, TransactionBuilder } from '@stellar/stellar-sdk';
import type { PayoutRunOptions } from 'nirium';

import { executePayroll, validateAndSign, type PayoutClient } from '../src/execute.ts';
import { parsePayroll, payrollLines, toStroops } from '../src/payroll.ts';

const payer = Keypair.random();
const alice = Keypair.random();
const bob = Keypair.random();
const csv = `contractor_id,wallet,amount\nC1,${alice.publicKey()},1.0000000\nC2,${bob.publicKey()},1.2500000\n`;
const plan = parsePayroll('2026-11', csv);

function unsignedXdr(rows = plan.rows): string {
    const tx = new TransactionBuilder(new Account(payer.publicKey(), '100'), {
        fee: '100', networkPassphrase: Networks.TESTNET,
    });
    rows.forEach((row) => tx.addOperation(Operation.payment({
        destination: row.wallet, asset: Asset.native(), amount: row.amount,
    })));
    return tx.setTimeout(300).build().toXDR();
}

function mockedClient(onSubmit?: (xdr: string) => void): PayoutClient {
    return {
        async createPayoutRun(options: PayoutRunOptions) {
            assert.equal(options.asset, 'XLM');
            assert.equal(options.acknowledgeTerms, true);
            assert.deepEqual(options.recipients, plan.rows.map((row) => ({ wallet: row.wallet, amount: row.amount })));
            return { runId: 'mock-run', xdr: unsignedXdr() };
        },
        async submitPayout(_runId, xdr) {
            onSubmit?.(xdr);
            return { runId: 'mock-run', txHash: 'a'.repeat(64) };
        },
    };
}

test('dry run produces deterministic rows and total without needing keys or a network', () => {
    assert.equal(toStroops('1.25'), 12_500_000n);
    assert.equal(plan.total, '2.2500000');
    assert.deepEqual(payrollLines(plan), payrollLines(parsePayroll('2026-11', csv)));
    assert.equal(payrollLines(plan).length, 4);
});

test('strict CSV rejects duplicate ID, duplicate wallet, invalid amount and month', () => {
    assert.throws(() => parsePayroll('2026-13', csv), /Month/);
    assert.throws(() => parsePayroll('2026-11', `contractor_id,wallet,amount\nC1,${alice.publicKey()},1\nC1,${bob.publicKey()},1\n`), /duplicate contractor/);
    assert.throws(() => parsePayroll('2026-11', `contractor_id,wallet,amount\nC1,${alice.publicKey()},1\nC2,${alice.publicKey()},1\n`), /Duplicate wallet/);
    assert.throws(() => parsePayroll('2026-11', `contractor_id,wallet,amount\nC1,${alice.publicKey()},0\n`), /Non-positive/);
    assert.throws(() => parsePayroll('2026-11', `contractor_id,wallet,amount\nC1,${alice.publicKey()},1.12345678\n`), /seven places/);
});

test('signer verifies every payment and never accepts a changed destination', () => {
    const xdr = validateAndSign(unsignedXdr(), plan, payer.secret());
    assert.equal(TransactionBuilder.fromXDR(xdr, Networks.TESTNET).signatures.length, 1);
    const tampered = [{ ...plan.rows[0], wallet: bob.publicKey() }, plan.rows[1]];
    assert.throws(() => validateAndSign(unsignedXdr(tampered), plan, payer.secret()), /does not match payroll/);
    const otherPayer = Keypair.random();
    assert.throws(() => validateAndSign(unsignedXdr(), plan, otherPayer.secret()), /source does not match/);
});

test('signer refuses excessive network fees in unsigned XDR', () => {
    const tx = new TransactionBuilder(new Account(payer.publicKey(), '100'), {
        fee: '1000000', networkPassphrase: Networks.TESTNET,
    });
    for (const row of plan.rows) tx.addOperation(Operation.payment({
        destination: row.wallet, asset: Asset.native(), amount: row.amount,
    }));
    const badFeeXdr = tx.setTimeout(300).build().toXDR();
    assert.throws(() => validateAndSign(badFeeXdr, plan, payer.secret()), /fee exceeds/);
});

test('successful submit stores one hash and rejects repeat month (even when CSV changes)', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'nirium-ledger-'));
    let sent = 0;
    try {
        const client = mockedClient((xdr) => {
            sent++;
            assert.equal(TransactionBuilder.fromXDR(xdr, Networks.TESTNET).signatures.length, 1);
            assert.equal(xdr.includes(payer.secret()), false);
        });
        const record = await executePayroll(plan, payer.secret(), client, dir);
        assert.equal(record.state, 'completed');
        assert.equal(record.txHash, 'a'.repeat(64));
        assert.equal(sent, 1);
        assert.equal((JSON.parse(await readFile(join(dir, '2026-11.json'), 'utf8')) as {digest:string}).digest, plan.digest);
        assert.deepEqual(await readdir(dir), ['2026-11.json']);
        await assert.rejects(() => executePayroll(plan, payer.secret(), client, dir), /already submitted/);
        const altered = parsePayroll('2026-11', csv.replace('1.2500000', '1.5000000'));
        await assert.rejects(() => executePayroll(altered, payer.secret(), client, dir), /already submitted/);
        assert.equal(sent, 1);
    } finally { await rm(dir, { recursive: true, force: true }); }
});

test('unknown submission outcome stays pending; never retries automatically', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'nirium-pending-'));
    let sent = 0;
    try {
        const client = mockedClient(() => { sent++; throw new Error('network response lost'); });
        await assert.rejects(() => executePayroll(plan, payer.secret(), client, dir), /network response lost/);
        await assert.rejects(() => executePayroll(plan, payer.secret(), client, dir), /unresolved pending/);
        const record = JSON.parse(await readFile(join(dir, '2026-11.json'), 'utf8')) as {state:string};
        assert.equal(record.state, 'pending');
        assert.equal(sent, 1);
    } finally { await rm(dir, { recursive: true, force: true }); }
});
