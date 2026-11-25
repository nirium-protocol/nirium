import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { parseArgs } from 'node:util';
import { Keypair } from '@stellar/stellar-sdk';
import { anchorHash, cliVerify } from './audit.js';
import { buildCorrection, check, publish, type Entry, type Receipt } from './correction.js';

const { positionals, values } = parseArgs({
    allowPositionals: true,
    options: { total: { type: 'string' }, currency: { type: 'string' }, reason: { type: 'string' } },
});
const [command, invoice] = positionals;
const path = (n: number): string => `records/${invoice}.${n}`;

function load(): Entry[] {
    const chain: Entry[] = [];
    while (existsSync(`${path(chain.length)}.json`)) {
        const n = path(chain.length);
        chain.push({ file: readFileSync(`${n}.json`), receipt: JSON.parse(readFileSync(`${n}.receipt.json`, 'utf8')) as Receipt });
    }
    return chain;
}

function save(e: Entry, n: number): void {
    mkdirSync('records', { recursive: true });
    writeFileSync(`${path(n)}.json`, e.file);
    writeFileSync(`${path(n)}.receipt.json`, `${JSON.stringify(e.receipt, null, 2)}\n`);
    console.log(`Document ${n}\nCID: ${e.receipt.cid}\nSHA-256: ${e.receipt.sha256}`);
}

function issuerKey(): Keypair {
    const secret = process.env.ISSUER_SECRET_KEY;
    if (!secret) throw new Error('Set ISSUER_SECRET_KEY to a testnet key made only for this. It needs no funds.');
    return Keypair.fromSecret(secret);
}

if (command === 'issue' && invoice && values.total && values.currency) {
    if (load().length > 0) throw new Error('This invoice already exists. Use correct.');
    const key = issuerKey();
    const doc = { schema: 'example.invoice.v1' as const, invoice, total: values.total, currency: values.currency, issuer: key.publicKey() };
    save(await publish(doc, key, anchorHash), 0);
} else if (command === 'correct' && invoice && values.total && values.reason) {
    const chain = load();
    save(await publish(buildCorrection(chain, values.total, values.reason), issuerKey(), anchorHash), chain.length);
} else if (command === 'check' && invoice) {
    const { errors, current } = check(load(), cliVerify);
    if (current !== null) console.log(`OK: every document verifies and each correction points to the one before it. Current total: ${current}`);
    for (const e of errors) console.error(`FAIL: ${e}`);
    process.exitCode = errors.length === 0 ? 0 : 1;
} else {
    console.error('issue <invoice> --total <n> --currency <code>\ncorrect <invoice> --total <n> --reason <text>\ncheck <invoice>');
    process.exitCode = 2;
}
