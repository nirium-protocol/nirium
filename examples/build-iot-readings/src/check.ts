import { spawnSync } from 'node:child_process';
import { createRequire } from 'node:module';
import { dirname, join } from 'node:path';
import { sha256Hex } from './canonical.js';
import { verifyReading, type SignedReading } from './sensor.js';
import type { LocalStore } from './store.js';

export interface VerifyResult { ok: boolean; output: string }
export type Verifier = (cid: string, sha256: string) => VerifyResult;

/** Runs the existing `nirium verify <cid> --hash <sha256>` from nirium-cli; no new verifier. */
export const niriumCliVerify: Verifier = (cid, sha256) => {
  const require = createRequire(import.meta.url);
  const bin = join(dirname(require.resolve('nirium-cli/package.json')), 'bin', 'nirium.js');
  const r = spawnSync(process.execPath, [bin, 'verify', cid, '--hash', sha256, '--retries', '3'], { encoding: 'utf8' });
  return { ok: r.status === 0, output: `${r.stdout ?? ''}${r.stderr ?? ''}`.trim() };
};

export interface BatchCheck {
  batchId: string;
  cid: string;
  /** Layer 1: every reading's sensor signature, checked against the pinned key registry. */
  readingsChecked: number;
  /** Readings that failed layer 1, named as `<sensorId>#<seq>`. */
  badReadings: string[];
  /** Other structural problems (unknown sensor, wrong contributor list, key mismatch). */
  problems: string[];
  /** Layer 2: the stored file's hash vs the anchored receipt. */
  recomputed: string;
  anchored: string;
  receiptOk: boolean;
  verifyOutput: string;
  ok: boolean;
}

/**
 * Check both layers of a stored batch.
 * 1. Each reading's ed25519 signature, against the key pinned for that sensor
 *    (never against a key the batch file claims, which an editor could swap).
 * 2. The batch file's sha-256 against the anchored receipt via `nirium verify`.
 */
export function checkBatch(batchId: string, store: LocalStore, verify: Verifier = niriumCliVerify): BatchCheck {
  const receipt = store.receipt(batchId);
  const bytes = store.loadBatchBytes(batchId);
  const recomputed = sha256Hex(bytes);
  const badReadings: string[] = [];
  const problems: string[] = [];
  let readingsChecked = 0;

  try {
    const batch = JSON.parse(bytes.toString('utf8')) as {
      sensors?: { id: string; publicKey: string }[];
      readings?: SignedReading[];
    };
    const registry = store.registry();
    const readings = Array.isArray(batch.readings) ? batch.readings : [];
    for (const r of readings) {
      readingsChecked++;
      const name = `${r?.sensorId}#${r?.seq}`;
      const key = registry[r?.sensorId];
      if (!key) {
        problems.push(`reading ${name}: sensor is not in the pinned registry`);
        badReadings.push(name);
      } else if (!verifyReading(r, key)) {
        badReadings.push(name);
      }
    }
    const listed = new Map((batch.sensors ?? []).map((s) => [s.id, s.publicKey]));
    const contributed = new Set(readings.map((r) => r?.sensorId));
    for (const id of contributed) if (!listed.has(id)) problems.push(`sensor ${id} has readings but is not listed as a contributor`);
    for (const id of listed.keys()) if (!contributed.has(id)) problems.push(`sensor ${id} is listed but contributed no reading`);
    for (const [id, key] of listed) if (registry[id] && registry[id] !== key) problems.push(`sensor ${id}: listed key differs from the pinned key`);
  } catch {
    problems.push('batch file is not valid JSON');
  }

  const v = verify(receipt.cid, recomputed);
  const ok = badReadings.length === 0 && problems.length === 0 && v.ok && recomputed === receipt.sha256;
  return {
    batchId, cid: receipt.cid, readingsChecked, badReadings, problems,
    recomputed, anchored: receipt.sha256, receiptOk: v.ok, verifyOutput: v.output, ok,
  };
}
