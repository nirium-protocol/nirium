// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 Nirium Protocol Contributors

import { createHash } from 'node:crypto';

/**
 * CIDv0 of an Audit Trail receipt, computed locally (no IPFS node, no library).
 *
 * A receipt is one IPFS block: a dag-pb node wrapping a UnixFS File whose data
 * is the whole document (anything up to 256 KiB fits in one block). Its CIDv0
 * is base58btc(0x12 0x20 || sha256(node)), the same result `ipfs add` gives with
 * its defaults. Checked on 21 Nov 2026 against three real mainnet receipts.
 *
 * Use it to show that a copy you kept is the original: pass the exact bytes you
 * saved, or the `document` object from `anchorAuditRecord()` (it is serialized
 * with `JSON.stringify`, which is what the node pinned).
 */
export function receiptCid(document: string | Uint8Array | Record<string, unknown>): string {
    const bytes = typeof document === 'string'
        ? Buffer.from(document, 'utf8')
        : document instanceof Uint8Array
            ? Buffer.from(document)
            : Buffer.from(JSON.stringify(document), 'utf8');
    if (bytes.length === 0) throw new Error('receiptCid: the document is empty');
    if (bytes.length > UNIXFS_BLOCK_BYTES) {
        throw new Error(`receiptCid: ${bytes.length} bytes is more than one IPFS block (${UNIXFS_BLOCK_BYTES}); every Audit Trail receipt fits`);
    }
    const unixfs = Buffer.concat([Buffer.from([0x08, 0x02]), bytesField(0x12, bytes), Buffer.from([0x18]), varint(bytes.length)]);
    const node = bytesField(0x0a, unixfs);
    const digest = createHash('sha256').update(node).digest();
    return base58btc(Buffer.concat([Buffer.from([0x12, 0x20]), digest]));
}

const UNIXFS_BLOCK_BYTES = 262144;
const BASE58_ALPHABET = '123456789ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz';

function varint(n: number): Buffer {
    const out: number[] = [];
    while (n >= 0x80) { out.push((n & 0x7f) | 0x80); n = Math.floor(n / 128); }
    out.push(n);
    return Buffer.from(out);
}

function bytesField(tag: number, buf: Buffer): Buffer {
    return Buffer.concat([Buffer.from([tag]), varint(buf.length), buf]);
}

function base58btc(buf: Buffer): string {
    let n = BigInt('0x' + buf.toString('hex'));
    let out = '';
    while (n > 0n) { out = BASE58_ALPHABET[Number(n % 58n)] + out; n /= 58n; }
    for (const b of buf) { if (b !== 0) break; out = '1' + out; }
    return out;
}
