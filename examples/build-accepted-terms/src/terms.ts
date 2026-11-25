import { randomBytes } from 'node:crypto';
import type { Keypair } from '@stellar/stellar-sdk';
import { sha256, type Anchorer, type Verifier } from './audit.js';

export interface Acceptance {
    schema: 'example.terms-acceptance.v1';
    termsVersion: string;
    termsSha256: string;
    order: string;
    /** sha256(salt + ':' + customer id): the id itself is not stored here. */
    customerRef: string;
    salt: string;
    /** Key of the person who accepts. The receipt must be signed with it. */
    customerKey: string;
    /** Declared by the customer. It is not a ledger time. */
    acceptedAt: string;
}

export interface Receipt { cid: string; sha256: string }

export function buildAcceptance(p: {
    terms: Buffer; termsVersion: string; order: string; customerId: string; customerKey: string;
}): Acceptance {
    const salt = randomBytes(32).toString('hex');
    return {
        schema: 'example.terms-acceptance.v1',
        termsVersion: p.termsVersion,
        termsSha256: sha256(p.terms),
        order: p.order,
        customerRef: sha256(`${salt}:${p.customerId}`),
        salt,
        customerKey: p.customerKey,
        acceptedAt: new Date().toISOString(),
    };
}

/** The anchored hash is the hash of these exact bytes, so anyone holding the file can compare it. */
export const serialize = (a: Acceptance): string => `${JSON.stringify(a, null, 2)}\n`;

export async function accept(acceptance: Acceptance, customer: Keypair, anchor: Anchorer): Promise<{ file: string; receipt: Receipt }> {
    if (customer.publicKey() !== acceptance.customerKey) throw new Error('The customer must sign with the key named in the acceptance.');
    const file = serialize(acceptance);
    const hash = sha256(file);
    return { file, receipt: { cid: await anchor(hash, 'selftest-accepted-terms', customer), sha256: hash } };
}

/** Returns the reasons it fails; an empty list means it passed. */
export function check(file: Buffer, terms: Buffer, receipt: Receipt, verify: Verifier): string[] {
    const errors: string[] = [];
    const hash = sha256(file);
    if (hash !== receipt.sha256) errors.push('The acceptance file is not the one in the receipt: it changed, or it belongs to another receipt.');
    const a = JSON.parse(file.toString('utf8')) as Acceptance;
    if (sha256(terms) !== a.termsSha256) errors.push(`These are not the terms that were accepted (version ${a.termsVersion}).`);
    const v = verify(receipt.cid, hash);
    if (!v.ok) errors.push('nirium verify did not pass for this file and CID.');
    else if (v.signer !== a.customerKey) errors.push('The receipt is signed with a key that is not the one named in the acceptance.');
    return errors;
}
