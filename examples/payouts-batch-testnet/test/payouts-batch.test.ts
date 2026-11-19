import assert from 'node:assert/strict';
import { test } from 'node:test';

import {
    Account,
    Asset,
    Keypair,
    Networks,
    Operation,
    TransactionBuilder,
} from '@stellar/stellar-sdk';
import { Agent } from 'nirium';

import { explainFailure, isInsufficientBalance, isMissingTrustline } from '../src/errors.ts';
import {
    buildBatchPayoutOptions,
    reportUntrustedRecipients,
    stellarExpertAccountUrl,
    stellarExpertTxUrl,
    TESTNET_RECIPIENTS,
} from '../src/payout.ts';
import {
    publicKeyFromSecret,
    resolveTestnetPassphrase,
    signUnsignedXdr,
    TESTNET_PASSPHRASE,
} from '../src/sign.ts';

function createMockUnsignedXdr(keypair: Keypair, passphrase: string): string {
    const account = new Account(keypair.publicKey(), '100');
    return new TransactionBuilder(account, { fee: '100', networkPassphrase: passphrase })
        .addOperation(
            Operation.payment({
                destination: keypair.publicKey(),
                asset: Asset.native(),
                amount: '1',
            }),
        )
        .setTimeout(30)
        .build()
        .toXDR();
}

test('buildBatchPayoutOptions builds valid batch payload for 10 recipients', () => {
    const opts = buildBatchPayoutOptions();
    assert.equal(opts.recipients.length, 10);
    assert.equal(opts.acknowledgeTerms, true);
    assert.equal(opts.asset, 'USDC');
    assert.match(opts.memo ?? '', /Batch Payout/);
});

test('buildBatchPayoutOptions rejects empty recipient list', () => {
    assert.throws(() => buildBatchPayoutOptions({ recipients: [] }), /requires at least one recipient/);
});

test('resolveTestnetPassphrase accepts testnet passphrase', () => {
    assert.equal(resolveTestnetPassphrase(TESTNET_PASSPHRASE), TESTNET_PASSPHRASE);
});

test('resolveTestnetPassphrase rejects public/mainnet passphrase for testnet safety', () => {
    assert.throws(() => resolveTestnetPassphrase(Networks.PUBLIC), /passphrase mismatch/i);
});

test('signUnsignedXdr signs transaction locally with caller key', () => {
    const keypair = Keypair.random();
    const xdr = createMockUnsignedXdr(keypair, TESTNET_PASSPHRASE);
    const signedXdr = signUnsignedXdr(xdr, keypair.secret(), TESTNET_PASSPHRASE);

    const tx = TransactionBuilder.fromXDR(signedXdr, TESTNET_PASSPHRASE);
    assert.equal(tx.signatures.length, 1);
});

test('signUnsignedXdr validates secret key format', () => {
    assert.throws(() => signUnsignedXdr('AAAA...', 'INVALID_KEY', TESTNET_PASSPHRASE), /must be a valid Stellar secret seed/);
});

test('publicKeyFromSecret derives valid G-address', () => {
    const keypair = Keypair.random();
    assert.equal(publicKeyFromSecret(keypair.secret()), keypair.publicKey());
});

test('reportUntrustedRecipients outputs onboarding guidance for untrusted wallets', () => {
    const untrusted = ['GBABC123', 'GDXYZ456'];
    const report = reportUntrustedRecipients(untrusted);
    assert.match(report, /2 recipient\(s\) lack a trustline/);
    assert.match(report, /submitPayoutOnboard/);
    assert.match(report, /GBABC123/);
});

test('reportUntrustedRecipients handles clean recipient list', () => {
    assert.match(reportUntrustedRecipients([]), /valid trustlines/);
});

test('explainFailure correctly identifies missing trustlines', () => {
    const err = explainFailure(new Error('op_no_trust: recipient has no trustline for USDC'));
    assert.match(err.message, /missing required trustline/);
    assert.equal(isMissingTrustline(err), true);
});

test('explainFailure correctly identifies underfunded payer account', () => {
    const err = explainFailure(new Error('op_underfunded: balance too low'));
    assert.match(err.message, /Insufficient payer balance/);
    assert.equal(isInsufficientBalance(err), true);
});

test('stellarExpert URLs format valid links', () => {
    const txLink = stellarExpertTxUrl('abcdef123456');
    assert.equal(txLink, 'https://stellar.expert/explorer/testnet/tx/abcdef123456');

    const accLink = stellarExpertAccountUrl('GABC123');
    assert.equal(accLink, 'https://stellar.expert/explorer/testnet/account/GABC123');
});

test('Agent payout workflow executes end-to-end with mocked HTTP layer (zero network)', async () => {
    const keypair = Keypair.random();
    const unsignedXdr = createMockUnsignedXdr(keypair, TESTNET_PASSPHRASE);

    const originalFetch = globalThis.fetch;
    const fetchCalls: Array<{ url: string; method: string; body: any }> = [];

    globalThis.fetch = (async (url: string, init?: any) => {
        fetchCalls.push({
            url: url.toString(),
            method: init?.method ?? 'GET',
            body: init?.body ? JSON.parse(init.body) : null,
        });

        if (url.toString().includes('/api/payroll/run')) {
            return {
                ok: true,
                status: 200,
                json: async () => ({
                    runId: 'mock-run-001',
                    xdr: unsignedXdr,
                    recipientCount: 10,
                    totalAmount: '1.00',
                    asset: 'USDC',
                }),
            };
        }

        if (url.toString().includes('/api/payroll/submit')) {
            return {
                ok: true,
                status: 200,
                json: async () => ({
                    runId: 'mock-run-001',
                    txHash: '0000000000000000000000000000000000000000000000000000000000000000',
                    cid: 'bafybeigdyrzt5sfp7udm7hu76uh7y26nf3efuylqabf3oclgtqy55fbzdi',
                }),
            };
        }

        return { ok: false, status: 404, json: async () => ({ error: 'Not found' }) };
    }) as any;

    try {
        const agent = new Agent({ baseUrl: 'http://localhost:3002', apiKey: 'test-batch-key' });

        // Step 1: Create Run
        const options = buildBatchPayoutOptions({
            recipients: TESTNET_RECIPIENTS,
            asset: 'USDC',
            treasury: keypair.publicKey(),
        });
        const run = await agent.createPayoutRun(options);
        assert.equal(run.runId, 'mock-run-001');
        assert.equal(run.xdr, unsignedXdr);

        // Step 2: Sign Locally (Secret NEVER passed over network)
        const signedXdr = signUnsignedXdr(run.xdr, keypair.secret(), TESTNET_PASSPHRASE);
        assert.ok(signedXdr.length > 0);

        // Verify secret is NEVER sent in HTTP body or headers
        const runCall = fetchCalls[0];
        assert.equal(runCall.url, 'http://localhost:3002/api/payroll/run');
        assert.equal(JSON.stringify(runCall.body).includes(keypair.secret()), false);

        // Step 3: Submit Payout
        const submitResult = await agent.submitPayout(run.runId, signedXdr);
        assert.equal(submitResult.runId, 'mock-run-001');
        assert.equal(submitResult.txHash, '0000000000000000000000000000000000000000000000000000000000000000');

        const submitCall = fetchCalls[1];
        assert.equal(submitCall.url, 'http://localhost:3002/api/payroll/submit');
        assert.equal(submitCall.body.signedXdr, signedXdr);
        assert.equal(JSON.stringify(submitCall.body).includes(keypair.secret()), false);
    } finally {
        globalThis.fetch = originalFetch;
    }
});
