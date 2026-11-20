import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

export interface Receipt {
  batchId: string;
  /** sha-256 of the batch file's exact bytes: the only thing anchored. */
  sha256: string;
  cid: string;
  anchoredAt: string;
  tag: string;
  attestedBy?: string;
  /** Which sensors contributed to the batch (also inside the hashed batch file). */
  sensors: string[];
  readings: number;
}

/** Sensor id -> ed25519 public key (hex). Pinned the first time a sensor is seen. */
export type Registry = Record<string, string>;

export interface SimSensorState {
  id: string;
  seedHex: string;
  seq: number;
}

/** Batch files, receipts and the key registry live only on this machine, under `dir`. */
export class LocalStore {
  constructor(readonly dir: string) {
    mkdirSync(join(dir, 'batches'), { recursive: true });
  }

  private batchPath(batchId: string): string {
    if (!/^[A-Za-z0-9_-]{1,64}$/.test(batchId)) throw new Error(`invalid batch id: ${batchId}`);
    return join(this.dir, 'batches', `${batchId}.json`);
  }

  nextBatchId(): string {
    return `batch-${String(this.receipts().length + 1).padStart(4, '0')}`;
  }

  /** Writes the batch file; returns the exact bytes that were stored (these are what get hashed). */
  saveBatch(batchId: string, batch: unknown): Buffer {
    const bytes = Buffer.from(JSON.stringify(batch, null, 2) + '\n', 'utf8');
    writeFileSync(this.batchPath(batchId), bytes);
    return bytes;
  }

  loadBatchBytes(batchId: string): Buffer {
    const p = this.batchPath(batchId);
    if (!existsSync(p)) throw new Error(`no stored batch ${batchId}`);
    return readFileSync(p);
  }

  receipts(): Receipt[] {
    const p = join(this.dir, 'receipts.json');
    return existsSync(p) ? (JSON.parse(readFileSync(p, 'utf8')) as Receipt[]) : [];
  }

  addReceipt(r: Receipt): void {
    const all = this.receipts().filter((x) => x.batchId !== r.batchId);
    all.push(r);
    writeFileSync(join(this.dir, 'receipts.json'), JSON.stringify(all, null, 2) + '\n');
  }

  receipt(batchId: string): Receipt {
    const r = this.receipts().find((x) => x.batchId === batchId);
    if (!r) throw new Error(`no receipt for ${batchId}`);
    return r;
  }

  registry(): Registry {
    const p = join(this.dir, 'registry.json');
    return existsSync(p) ? (JSON.parse(readFileSync(p, 'utf8')) as Registry) : {};
  }

  /** Pin a sensor's public key. Re-registering the same key is fine; a different key is refused. */
  register(sensorId: string, publicKeyHex: string): void {
    const reg = this.registry();
    if (reg[sensorId] && reg[sensorId] !== publicKeyHex) {
      throw new Error(`sensor ${sensorId} is already pinned to a different key`);
    }
    reg[sensorId] = publicKeyHex;
    writeFileSync(join(this.dir, 'registry.json'), JSON.stringify(reg, null, 2) + '\n');
  }

  /** Simulation only: a real sensor keeps its private key on the device. */
  simState(): SimSensorState[] {
    const p = join(this.dir, 'sim-sensors.json');
    return existsSync(p) ? (JSON.parse(readFileSync(p, 'utf8')) as SimSensorState[]) : [];
  }

  saveSimState(s: SimSensorState[]): void {
    writeFileSync(join(this.dir, 'sim-sensors.json'), JSON.stringify(s, null, 2) + '\n', { mode: 0o600 });
  }
}
