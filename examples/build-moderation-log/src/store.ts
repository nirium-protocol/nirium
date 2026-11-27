import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import type { ModerationStoreRecord, ModerationReceipt } from "./types.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT_DIR = path.resolve(__dirname, "..");
const DEFAULT_RECORDS_PATH = path.join(ROOT_DIR, "records.json");
const DEFAULT_RECEIPTS_PATH = path.join(ROOT_DIR, "receipts.json");

export class ModerationStore {
  constructor(
    private recordsPath: string = DEFAULT_RECORDS_PATH,
    private receiptsPath: string = DEFAULT_RECEIPTS_PATH,
  ) {}

  loadRecords(): ModerationStoreRecord[] {
    if (!fs.existsSync(this.recordsPath)) return [];
    try {
      return JSON.parse(fs.readFileSync(this.recordsPath, "utf-8"));
    } catch {
      return [];
    }
  }

  saveRecords(records: ModerationStoreRecord[]): void {
    fs.writeFileSync(this.recordsPath, JSON.stringify(records, null, 2), "utf-8");
  }

  loadReceipts(): ModerationReceipt[] {
    if (!fs.existsSync(this.receiptsPath)) return [];
    try {
      return JSON.parse(fs.readFileSync(this.receiptsPath, "utf-8"));
    } catch {
      return [];
    }
  }

  saveReceipts(receipts: ModerationReceipt[]): void {
    fs.writeFileSync(this.receiptsPath, JSON.stringify(receipts, null, 2), "utf-8");
  }

  addRecord(record: ModerationStoreRecord): void {
    const records = this.loadRecords();
    const existingIndex = records.findIndex((r) => r.actionId === record.actionId);
    if (existingIndex >= 0) {
      records[existingIndex] = record;
    } else {
      records.push(record);
    }
    this.saveRecords(records);
  }

  addReceipt(receipt: ModerationReceipt): void {
    const receipts = this.loadReceipts();
    const existingIndex = receipts.findIndex((r) => r.actionId === receipt.actionId);
    if (existingIndex >= 0) {
      receipts[existingIndex] = receipt;
    } else {
      receipts.push(receipt);
    }
    this.saveReceipts(receipts);
  }

  getRecord(actionId: string): ModerationStoreRecord | undefined {
    return this.loadRecords().find((r) => r.actionId === actionId);
  }

  getReceipt(actionId: string): ModerationReceipt | undefined {
    return this.loadReceipts().find((r) => r.actionId === actionId);
  }
}
