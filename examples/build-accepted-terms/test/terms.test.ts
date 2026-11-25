import assert from 'node:assert/strict';
import { test } from 'node:test';
import { Keypair } from '@stellar/stellar-sdk';
import { sha256, type Verifier } from '../src/audit.js';
import { accept, buildAcceptance, check } from '../src/terms.js';

// No network: the anchor is a fake, and the verifier answers for the hash that was anchored.
const customer = Keypair.random();
const v1 = Buffer.from('terms one');
const v2 = Buffer.from('terms two');
const verifierFor = (hash: string, signer = customer.publicKey()): Verifier => (_cid, h) => ({ ok: h === hash, signer });

async function make() {
    const a = buildAcceptance({ terms: v2, termsVersion: 'v2', order: 'order-1', customerId: 'demo-customer', customerKey: customer.publicKey() });
    let sent = '';
    const { file, receipt } = await accept(a, customer, async (hash) => { sent = hash; return 'QmTest'; });
    return { a, file: Buffer.from(file), receipt, sent };
}

test('only the hash of the file is sent', async () => {
    const { file, sent } = await make();
    assert.equal(sent, sha256(file));
});

test('the accepted terms pass', async () => {
    const { file, receipt } = await make();
    assert.deepEqual(check(file, v2, receipt, verifierFor(receipt.sha256)), []);
});

test('another version of the terms fails', async () => {
    const { file, receipt } = await make();
    assert.match(check(file, v1, receipt, verifierFor(receipt.sha256)).join(), /not the terms that were accepted/);
});

test('an edited acceptance fails', async () => {
    const { file, receipt } = await make();
    const edited = Buffer.from(file.toString().replace('order-1', 'order-2'));
    const errors = check(edited, v2, receipt, verifierFor(receipt.sha256)).join();
    assert.match(errors, /not the one in the receipt/);
    assert.match(errors, /nirium verify did not pass/);
});

test('a receipt signed by someone else fails', async () => {
    const { file, receipt } = await make();
    assert.match(check(file, v2, receipt, verifierFor(receipt.sha256, Keypair.random().publicKey())).join(), /not the one named/);
});

test('someone else cannot accept for the customer', async () => {
    const { a } = await make();
    await assert.rejects(accept(a, Keypair.random(), async () => 'QmTest'), /must sign/);
});

test('the customer id is not in the file', async () => {
    const { file } = await make();
    assert.ok(!file.toString().includes('demo-customer'));
});
