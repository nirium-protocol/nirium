import assert from 'node:assert/strict';
import { test } from 'node:test';
import { Keypair } from '@stellar/stellar-sdk';
import { sha256, type Verifier } from '../src/audit.js';
import { buildCorrection, check, publish, serialize, type Correction, type Entry } from '../src/correction.js';

// No network: fake CIDs, and a verifier that knows which hash and key were anchored under each one.
const key = Keypair.random();

async function setup() {
    const anchored = new Map<string, { hash: string; signer: string }>();
    const anchor = async (hash: string, _tag: string, k: Keypair): Promise<string> => {
        const cid = `Qm${anchored.size}`;
        anchored.set(cid, { hash, signer: k.publicKey() });
        return cid;
    };
    const verify: Verifier = (cid, hash) => {
        const a = anchored.get(cid);
        return { ok: a?.hash === hash, signer: a?.signer ?? null };
    };
    const invoice = await publish({ schema: 'example.invoice.v1', invoice: 'A-12', total: '120.00', currency: 'USD', issuer: key.publicKey() }, key, anchor);
    const correction = await publish(buildCorrection([invoice], '100.00', 'Shipping charged twice'), key, anchor);
    return { anchor, verify, invoice, correction };
}

const withFile = (e: Entry, change: (s: string) => string): Entry => ({ ...e, file: Buffer.from(change(e.file.toString())) });

test('a corrected invoice passes and gives the new total', async () => {
    const { verify, invoice, correction } = await setup();
    assert.deepEqual(check([invoice, correction], verify), { errors: [], current: '100.00' });
});

test('a second correction follows the first', async () => {
    const { anchor, verify, invoice, correction } = await setup();
    const second = await publish(buildCorrection([invoice, correction], '90.00', 'Discount'), key, anchor);
    assert.equal(check([invoice, correction, second], verify).current, '90.00');
});

test('rewriting the original invoice fails', async () => {
    const { verify, invoice, correction } = await setup();
    const r = check([withFile(invoice, (s) => s.replace('120.00', '100.00')), correction], verify);
    assert.match(r.errors.join(), /Document 0 is not the one in its receipt/);
    assert.equal(r.current, null);
});

test('dropping a document in the middle fails', async () => {
    const { anchor, verify, invoice, correction } = await setup();
    const second = await publish(buildCorrection([invoice, correction], '90.00', 'Discount'), key, anchor);
    assert.match(check([invoice, second], verify).errors.join(), /does not correct the one before it/);
});

test('a correction by another key fails', async () => {
    const { anchor, verify, invoice } = await setup();
    const other = Keypair.random();
    const doc: Correction = { ...buildCorrection([invoice], '1.00', 'x'), issuer: other.publicKey() };
    assert.match(check([invoice, await publish(doc, other, anchor)], verify).errors.join(), /not signed by the issuer/);
});

test('the wrong key cannot publish', async () => {
    const { invoice, anchor } = await setup();
    await assert.rejects(publish(buildCorrection([invoice], '1.00', 'x'), Keypair.random(), anchor), /must sign/);
});

test('the anchored hash is the hash of the file', async () => {
    const { invoice } = await setup();
    assert.equal(invoice.receipt.sha256, sha256(serialize(JSON.parse(invoice.file.toString()))));
});
