import { existsSync, mkdirSync, readFileSync, readdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import type { HandoffRecord } from './record.js';

export interface CheckpointReceipt {
  shipmentId: string;
  handoffIndex: number;
  partyId: string;
  locationLabel: string;
  timestamp: string;
  scanHash: string;
  previousHandoffCid: string | null;
  sha256: string;
  cid: string;
  anchoredAt: string;
  attestedBy: string;
  tag: string;
  record: HandoffRecord;
}

export class CheckpointStore {
  readonly rootDir: string;
  readonly shipmentsDir: string;
  readonly receiptsFile: string;

  constructor(rootDir = '.checkpoints') {
    this.rootDir = rootDir;
    this.shipmentsDir = join(rootDir, 'shipments');
    this.receiptsFile = join(rootDir, 'receipts.json');
    if (!existsSync(this.shipmentsDir)) {
      mkdirSync(this.shipmentsDir, { recursive: true });
    }
  }

  saveReceipt(receipt: CheckpointReceipt): void {
    // 1. Save shipment-specific handoff file
    const shipmentDir = join(this.shipmentsDir, receipt.shipmentId);
    if (!existsSync(shipmentDir)) {
      mkdirSync(shipmentDir, { recursive: true });
    }
    const handoffPath = join(shipmentDir, `handoff-${receipt.handoffIndex}.json`);
    writeFileSync(handoffPath, JSON.stringify(receipt, null, 2), 'utf8');

    // 2. Append to all receipts index
    const all = this.allReceipts();
    const existingIndex = all.findIndex(
      (r) => r.shipmentId === receipt.shipmentId && r.handoffIndex === receipt.handoffIndex,
    );
    if (existingIndex >= 0) {
      all[existingIndex] = receipt;
    } else {
      all.push(receipt);
    }
    writeFileSync(this.receiptsFile, JSON.stringify(all, null, 2), 'utf8');
  }

  loadShipmentReceipts(shipmentId: string): CheckpointReceipt[] {
    const shipmentDir = join(this.shipmentsDir, shipmentId);
    if (!existsSync(shipmentDir)) {
      return [];
    }
    const receipts: CheckpointReceipt[] = [];
    const files = readdirSync(shipmentDir).filter((f) => f.startsWith('handoff-') && f.endsWith('.json'));
    for (const f of files) {
      try {
        receipts.push(JSON.parse(readFileSync(join(shipmentDir, f), 'utf8')));
      } catch {
        // ignore malformed
      }
    }
    receipts.sort((a, b) => a.handoffIndex - b.handoffIndex);
    return receipts;
  }

  allReceipts(): CheckpointReceipt[] {
    if (!existsSync(this.receiptsFile)) {
      return [];
    }
    try {
      return JSON.parse(readFileSync(this.receiptsFile, 'utf8'));
    } catch {
      return [];
    }
  }
}
