import { createHash } from 'node:crypto';

/** Delivery details kept privately by the courier and the shop. Never anchored in clear. */
export interface DeliveryDetails {
  orderId: string;
  deliveredAt: string; // ISO time stated by the courier's app
  lat: number; // rounded (see roundCoord)
  lon: number;
}

/** What gets hashed: the details plus the photo's own sha-256. */
export interface DeliveryRecord extends DeliveryDetails {
  version: 'proof-of-delivery-v1';
  photoSha256: string;
}

/** 2 decimal places ≈ 1.1 km: enough to tell the neighbourhood, not the door. */
export const COORD_DECIMALS = 2;
export function roundCoord(x: number): number {
  if (!Number.isFinite(x)) throw new Error('coordinate must be a number');
  const f = 10 ** COORD_DECIMALS;
  return Math.round(x * f) / f;
}

export function sha256Hex(data: Buffer | string): string {
  return createHash('sha256').update(data).digest('hex');
}

export function canonicalJson(value: unknown): string {
  if (value === null || typeof value !== 'object') return JSON.stringify(value);
  if (Array.isArray(value)) return `[${value.map(canonicalJson).join(',')}]`;
  const obj = value as Record<string, unknown>;
  const keys = Object.keys(obj).filter((k) => obj[k] !== undefined).sort();
  return `{${keys.map((k) => `${JSON.stringify(k)}:${canonicalJson(obj[k])}`).join(',')}}`;
}

export function buildRecord(details: DeliveryDetails, photo: Buffer): DeliveryRecord {
  return {
    version: 'proof-of-delivery-v1',
    orderId: details.orderId,
    deliveredAt: details.deliveredAt,
    lat: roundCoord(details.lat),
    lon: roundCoord(details.lon),
    photoSha256: sha256Hex(photo),
  };
}

/** The only value that is anchored. */
export function hashRecord(r: DeliveryRecord): string {
  return sha256Hex(canonicalJson(r));
}

export function statementFor(sha256: string): string {
  return `nirium-audit-v1:${sha256}`;
}
