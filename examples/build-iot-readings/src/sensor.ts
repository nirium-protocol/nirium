import { createPrivateKey, createPublicKey, generateKeyPairSync, sign, verify, type KeyObject } from 'node:crypto';
import { canonicalJson } from './canonical.js';

/** What a sensor measured. This exact object (canonical JSON) is what the sensor signs. */
export interface Reading {
  sensorId: string;
  /** Per-sensor counter, so a dropped or replayed reading is visible. */
  seq: number;
  /** ISO 8601 time the sensor claims for the measurement. */
  ts: string;
  metric: string;
  value: number;
  unit: string;
}

export interface SignedReading extends Reading {
  /** base64 ed25519 signature over canonicalJson(Reading), by the sensor's own key. */
  signature: string;
}

// SPKI / PKCS8 DER prefixes for raw 32-byte ed25519 keys.
const SPKI_PREFIX = Buffer.from('302a300506032b6570032100', 'hex');
const PKCS8_PREFIX = Buffer.from('302e020100300506032b657004220420', 'hex');

export function publicKeyObject(publicKeyHex: string): KeyObject {
  return createPublicKey({ key: Buffer.concat([SPKI_PREFIX, Buffer.from(publicKeyHex, 'hex')]), format: 'der', type: 'spki' });
}

export function readingPayload(r: Reading): string {
  return canonicalJson({ sensorId: r.sensorId, seq: r.seq, ts: r.ts, metric: r.metric, value: r.value, unit: r.unit });
}

/** True only if `signature` is a valid signature of the reading by `publicKeyHex`. */
export function verifyReading(r: SignedReading, publicKeyHex: string): boolean {
  try {
    if (typeof r.signature !== 'string') return false;
    return verify(null, Buffer.from(readingPayload(r), 'utf8'), publicKeyObject(publicKeyHex), Buffer.from(r.signature, 'base64'));
  } catch {
    return false;
  }
}

/** A simulated sensor. On a real device the private key never leaves the device. */
export class Sensor {
  readonly publicKeyHex: string;
  private readonly priv: KeyObject;
  private seq = 0;

  constructor(readonly id: string, readonly metric: string, readonly unit: string, seedHex?: string) {
    if (seedHex) {
      this.priv = createPrivateKey({ key: Buffer.concat([PKCS8_PREFIX, Buffer.from(seedHex, 'hex')]), format: 'der', type: 'pkcs8' });
    } else {
      this.priv = generateKeyPairSync('ed25519').privateKey;
    }
    const spki = createPublicKey(this.priv).export({ format: 'der', type: 'spki' });
    this.publicKeyHex = Buffer.from(spki).subarray(SPKI_PREFIX.length).toString('hex');
  }

  /** Raw 32-byte seed, hex. Only used so the demo keeps the same sensors between runs. */
  seedHex(): string {
    const pkcs8 = this.priv.export({ format: 'der', type: 'pkcs8' });
    return Buffer.from(pkcs8).subarray(PKCS8_PREFIX.length).toString('hex');
  }

  /** Continue the counter after a restart. */
  setSeq(next: number): void {
    this.seq = next;
  }

  read(value: number, ts: Date): SignedReading {
    const reading: Reading = { sensorId: this.id, seq: this.seq++, ts: ts.toISOString(), metric: this.metric, value, unit: this.unit };
    const signature = sign(null, Buffer.from(readingPayload(reading), 'utf8'), this.priv).toString('base64');
    return { ...reading, signature };
  }
}

/** Small deterministic PRNG so demo values (and tests) are reproducible. */
export function mulberry32(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}
