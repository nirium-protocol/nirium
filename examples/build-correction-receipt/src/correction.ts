import type { Keypair } from '@stellar/stellar-sdk';
import { sha256, type Anchorer, type Verifier } from './audit.js';

export interface Invoice { schema: 'example.invoice.v1'; invoice: string; total: string; currency: string; issuer: string }

export interface Correction {
    schema: 'example.correction.v1';
    invoice: string;
    /** The exact document being corrected, by CID and hash: this is what links one document to the next. */
    corrects: { cid: string; sha256: string };
    reason: string;
    previousTotal: string;
    newTotal: string;
    currency: string;
    issuer: string;
}

export type Doc = Invoice | Correction;
export interface Receipt { cid: string; sha256: string }
export interface Entry { file: Buffer; receipt: Receipt }

export const serialize = (d: Doc): string => `${JSON.stringify(d, null, 2)}\n`;
const parse = (e: Entry): Doc => JSON.parse(e.file.toString('utf8')) as Doc;
const totalOf = (d: Doc): string => (d.schema === 'example.invoice.v1' ? d.total : d.newTotal);

export async function publish(doc: Doc, issuer: Keypair, anchor: Anchorer): Promise<Entry> {
    if (issuer.publicKey() !== doc.issuer) throw new Error('The issuer must sign with the key named in the document.');
    const file = Buffer.from(serialize(doc));
    const hash = sha256(file);
    return { file, receipt: { cid: await anchor(hash, 'selftest-correction-receipt', issuer), sha256: hash } };
}

/** Builds a correction of the latest document in the chain. The earlier ones stay as they are. */
export function buildCorrection(chain: Entry[], newTotal: string, reason: string): Correction {
    const last = chain.at(-1);
    if (!last) throw new Error('Nothing to correct.');
    const d = parse(last);
    return {
        schema: 'example.correction.v1',
        invoice: d.invoice,
        corrects: { cid: last.receipt.cid, sha256: last.receipt.sha256 },
        reason,
        previousTotal: totalOf(d),
        newTotal,
        currency: d.currency,
        issuer: d.issuer,
    };
}

/** Checks the whole chain. `current` is the last total, or null if anything failed. */
export function check(chain: Entry[], verify: Verifier): { errors: string[]; current: string | null } {
    const errors: string[] = [];
    const first = chain[0];
    const last = chain.at(-1);
    if (!first || !last) return { errors: ['No documents found for this invoice.'], current: null };
    const root = parse(first);
    if (root.schema !== 'example.invoice.v1') errors.push('The first document is not an invoice.');
    let prev: Entry | null = null;
    for (const [i, e] of chain.entries()) {
        const d = parse(e);
        const hash = sha256(e.file);
        if (hash !== e.receipt.sha256) errors.push(`Document ${i} is not the one in its receipt.`);
        const v = verify(e.receipt.cid, hash);
        if (!v.ok) errors.push(`nirium verify did not pass for document ${i}.`);
        else if (v.signer !== root.issuer) errors.push(`Document ${i} is not signed by the issuer of the invoice.`);
        if (prev) {
            const p = parse(prev);
            if (d.schema !== 'example.correction.v1') {
                errors.push(`Document ${i} is not a correction.`);
            } else {
                if (d.corrects.cid !== prev.receipt.cid || d.corrects.sha256 !== prev.receipt.sha256) errors.push(`Document ${i} does not correct the one before it.`);
                if (d.invoice !== p.invoice || d.currency !== p.currency) errors.push(`Document ${i} belongs to another invoice.`);
                if (d.previousTotal !== totalOf(p)) errors.push(`Document ${i} starts from the wrong total.`);
            }
        }
        prev = e;
    }
    return { errors, current: errors.length === 0 ? totalOf(parse(last)) : null };
}
