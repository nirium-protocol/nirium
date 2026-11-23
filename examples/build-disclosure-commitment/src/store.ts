import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';
import type { CommitmentRecord } from './types.js';

export interface LocalStore {
  commitmentsPath: string;
  load(): CommitmentRecord[];
  get(id: string): CommitmentRecord | undefined;
  save(record: CommitmentRecord): void;
}

export function createLocalStore(filePath = resolve(process.cwd(), 'commitments.json')): LocalStore {
  function load(): CommitmentRecord[] {
    if (!existsSync(filePath)) {
      return [];
    }
    try {
      const data = readFileSync(filePath, 'utf8').trim();
      return data ? (JSON.parse(data) as CommitmentRecord[]) : [];
    } catch {
      return [];
    }
  }

  function get(id: string): CommitmentRecord | undefined {
    const list = load();
    return list.find((r) => r.id === id || r.reportName === id);
  }

  function save(record: CommitmentRecord): void {
    const list = load();
    const existingIndex = list.findIndex((r) => r.id === record.id);
    if (existingIndex >= 0) {
      list[existingIndex] = record;
    } else {
      list.push(record);
    }
    writeFileSync(filePath, JSON.stringify(list, null, 2) + '\n', 'utf8');
  }

  return {
    commitmentsPath: filePath,
    load,
    get,
    save,
  };
}
