import { mkdirSync, readFileSync, writeFileSync, existsSync, copyFileSync } from 'node:fs';
import { join } from 'node:path';
import type { DeliveryDetails } from './record.js';

export interface Receipt {
  orderId: string;
  sha256: string;
  cid: string;
  anchoredAt: string;
  attestedBy?: string;
  tag: string;
}

/**
 * Private storage shared by the courier and the shop: photos, delivery
 * details and receipts. Nothing here is ever sent to the node.
 */
export class DeliveryStore {
  constructor(readonly dir: string) {
    mkdirSync(join(dir, 'details'), { recursive: true });
    mkdirSync(join(dir, 'photos'), { recursive: true });
  }

  private safe(orderId: string): string {
    if (!/^[A-Za-z0-9_-]{1,64}$/.test(orderId)) throw new Error(`invalid order id: ${orderId}`);
    return orderId;
  }

  photoPath(orderId: string): string {
    return join(this.dir, 'photos', `${this.safe(orderId)}.png`);
  }

  saveDelivery(details: DeliveryDetails, photo: Buffer | string): void {
    const id = this.safe(details.orderId);
    writeFileSync(join(this.dir, 'details', `${id}.json`), JSON.stringify(details, null, 2) + '\n');
    if (typeof photo === 'string') copyFileSync(photo, this.photoPath(id));
    else writeFileSync(this.photoPath(id), photo);
  }

  loadDetails(orderId: string): DeliveryDetails {
    const p = join(this.dir, 'details', `${this.safe(orderId)}.json`);
    if (!existsSync(p)) throw new Error(`no stored details for order ${orderId}`);
    return JSON.parse(readFileSync(p, 'utf8')) as DeliveryDetails;
  }

  receipts(): Receipt[] {
    const p = join(this.dir, 'receipts.json');
    return existsSync(p) ? (JSON.parse(readFileSync(p, 'utf8')) as Receipt[]) : [];
  }

  addReceipt(r: Receipt): void {
    const all = this.receipts().filter((x) => x.orderId !== r.orderId);
    all.push(r);
    writeFileSync(join(this.dir, 'receipts.json'), JSON.stringify(all, null, 2) + '\n');
  }

  receipt(orderId: string): Receipt {
    const r = this.receipts().find((x) => x.orderId === orderId);
    if (!r) throw new Error(`no receipt for order ${orderId}`);
    return r;
  }
}
