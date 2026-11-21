// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 Nirium Protocol Contributors

import fs from 'node:fs';
import path from 'node:path';
import { receiptCid } from './receipt-cid';

// Two real mainnet receipts, byte for byte as the gateway serves them
// (shared with the CLI tests).
const fixtures = path.join(__dirname, '..', '..', 'cli', 'test', 'fixtures', 'receipts');
const CIDS = ['QmSSZdtt3dQ8BqUm62zrKQ85E4BUHYiVfvDgZmHfJsqU1U', 'QmS5q2NvZ2K2StLB3KCWRdkBtnZ5rHAJrQAez2PnKAPwTk'];

describe('receiptCid', () => {
    it.each(CIDS)('gives back the real CID of %s from its bytes', (cid) => {
        const bytes = fs.readFileSync(path.join(fixtures, `${cid}.json`));
        expect(receiptCid(bytes)).toBe(cid);
        expect(receiptCid(bytes.toString('utf8'))).toBe(cid);
    });

    it.each(CIDS)('gives back the same CID from the parsed document of %s', (cid) => {
        const doc = JSON.parse(fs.readFileSync(path.join(fixtures, `${cid}.json`), 'utf8'));
        expect(receiptCid(doc)).toBe(cid);
    });

    it('changes when a single byte changes', () => {
        const bytes = Buffer.from(fs.readFileSync(path.join(fixtures, `${CIDS[0]}.json`)));
        bytes[bytes.length - 2] ^= 1;
        expect(receiptCid(bytes)).not.toBe(CIDS[0]);
    });

    it('refuses empty and multi-block input', () => {
        expect(() => receiptCid('')).toThrow(/empty/);
        expect(() => receiptCid(Buffer.alloc(262145, 0x61))).toThrow(/one IPFS block/);
    });
});
