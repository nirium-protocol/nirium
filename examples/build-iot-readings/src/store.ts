import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { serializeBatchFile, sha256Hex, type BatchFile, type ContributingSensor } from './batch.js';

export interface BatchReceipt {
    batchId: string;
    batchFile: string;
    sha256: string;
    cid: string;
    anchoredAt: string;
    attestedBy?: string;
    tag: string;
    readingCount: number;
    contributingSensors: ContributingSensor[];
}

/**
 * Local storage for raw batch files and their anchored Audit Trail receipts.
 * Raw sensor readings remain on this machine; only SHA-256 hashes leave it.
 */
export class BatchStore {
    constructor(readonly dir: string) {
        mkdirSync(join(dir, 'batches'), { recursive: true });
    }

    batchPath(batchId: string): string {
        if (!/^[A-Za-z0-9_-]{1,64}$/.test(batchId)) {
            throw new Error(`Invalid batch id: ${batchId}`);
        }
        return join(this.dir, 'batches', `${batchId}.json`);
    }

    saveBatch(batch: BatchFile): { path: string; sha256: string } {
        const path = this.batchPath(batch.batchId);
        const serialized = serializeBatchFile(batch);
        writeFileSync(path, serialized, 'utf8');
        return { path, sha256: sha256Hex(Buffer.from(serialized, 'utf8')) };
    }

    loadBatchRaw(batchId: string): { batch: BatchFile; rawBytes: Buffer; path: string } {
        const path = this.batchPath(batchId);
        if (!existsSync(path)) {
            throw new Error(`No stored batch file for "${batchId}" at ${path}`);
        }
        const rawBytes = readFileSync(path);
        const batch = JSON.parse(rawBytes.toString('utf8')) as BatchFile;
        return { batch, rawBytes, path };
    }

    receipts(): BatchReceipt[] {
        const p = join(this.dir, 'receipts.json');
        return existsSync(p) ? (JSON.parse(readFileSync(p, 'utf8')) as BatchReceipt[]) : [];
    }

    addReceipt(r: BatchReceipt): void {
        const all = this.receipts().filter((x) => x.batchId !== r.batchId);
        all.push(r);
        writeFileSync(join(this.dir, 'receipts.json'), JSON.stringify(all, null, 2) + '\n', 'utf8');
    }

    receipt(batchId: string): BatchReceipt {
        const found = this.receipts().find((x) => x.batchId === batchId);
        if (!found) {
            throw new Error(`No receipt stored for batch "${batchId}"`);
        }
        return found;
    }
}
