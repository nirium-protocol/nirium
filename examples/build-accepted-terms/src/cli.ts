import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { parseArgs } from 'node:util';
import { Keypair } from '@stellar/stellar-sdk';
import { anchorHash, cliVerify } from './audit.js';
import { accept, buildAcceptance, check, type Receipt } from './terms.js';

const { positionals, values } = parseArgs({
    allowPositionals: true,
    options: { terms: { type: 'string' }, 'terms-version': { type: 'string' }, order: { type: 'string' }, customer: { type: 'string' } },
});
const [command, id] = positionals;
const { terms, order, customer, 'terms-version': termsVersion } = values;

if (command === 'accept' && terms && termsVersion && order && customer) {
    const secret = process.env.CUSTOMER_SECRET_KEY;
    if (!secret) throw new Error('Set CUSTOMER_SECRET_KEY to a testnet key made only for this. It needs no funds.');
    const path = `records/${order}.json`;
    if (existsSync(path)) throw new Error(`${path} already exists.`);
    const keypair = Keypair.fromSecret(secret);
    const acceptance = buildAcceptance({ terms: readFileSync(terms), termsVersion, order, customerId: customer, customerKey: keypair.publicKey() });
    const { file, receipt } = await accept(acceptance, keypair, anchorHash);
    mkdirSync('records', { recursive: true });
    writeFileSync(path, file);
    writeFileSync(`records/${order}.receipt.json`, `${JSON.stringify(receipt, null, 2)}\n`);
    console.log(`Accepted ${termsVersion} for ${order}\nCID: ${receipt.cid}\nSHA-256: ${receipt.sha256}`);
} else if (command === 'check' && id && terms) {
    const receipt = JSON.parse(readFileSync(`records/${id}.receipt.json`, 'utf8')) as Receipt;
    const errors = check(readFileSync(`records/${id}.json`), readFileSync(terms), receipt, cliVerify);
    if (errors.length === 0) console.log(`OK: the key named in the file signed an acceptance of these exact terms for ${id}.`);
    for (const e of errors) console.error(`FAIL: ${e}`);
    process.exitCode = errors.length === 0 ? 0 : 1;
} else {
    console.error('accept --terms <file> --terms-version <v> --order <id> --customer <id>\ncheck <order> --terms <file>');
    process.exitCode = 2;
}
