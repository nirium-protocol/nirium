import { mkdirSync, readFileSync, writeFileSync, existsSync } from 'node:fs';
import { join } from 'node:path';
import type { LogbookEntry } from './entry.js';

export interface Receipt {
  taskId: string;
  sha256: string;
  cid: string;
  anchoredAt: string;
  attestedBy?: string;
  tag: string;
}

/** Full entries and receipts live only on this machine, under `dir`. */
export class LocalStore {
  constructor(readonly dir: string) {
    mkdirSync(join(dir, 'entries'), { recursive: true });
  }

  private entryPath(taskId: string): string {
    if (!/^[A-Za-z0-9_-]{1,64}$/.test(taskId)) throw new Error(`invalid task id: ${taskId}`);
    return join(this.dir, 'entries', `${taskId}.json`);
  }

  saveEntry(entry: LogbookEntry): void {
    writeFileSync(this.entryPath(entry.taskId), JSON.stringify(entry, null, 2) + '\n');
  }

  loadEntry(taskId: string): LogbookEntry {
    const p = this.entryPath(taskId);
    if (!existsSync(p)) throw new Error(`no stored entry for task ${taskId}`);
    return JSON.parse(readFileSync(p, 'utf8')) as LogbookEntry;
  }

  receipts(): Receipt[] {
    const p = join(this.dir, 'receipts.json');
    return existsSync(p) ? (JSON.parse(readFileSync(p, 'utf8')) as Receipt[]) : [];
  }

  addReceipt(r: Receipt): void {
    const all = this.receipts().filter((x) => x.taskId !== r.taskId);
    all.push(r);
    writeFileSync(join(this.dir, 'receipts.json'), JSON.stringify(all, null, 2) + '\n');
  }

  receipt(taskId: string): Receipt {
    const r = this.receipts().find((x) => x.taskId === taskId);
    if (!r) throw new Error(`no receipt for task ${taskId}`);
    return r;
  }
}
