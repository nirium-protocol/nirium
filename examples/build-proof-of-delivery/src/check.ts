import { spawnSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { dirname, join } from 'node:path';
import { buildRecord, hashRecord } from './record.js';
import type { DeliveryStore } from './store.js';

export interface VerifyResult { ok: boolean; output: string }
export type Verifier = (cid: string, sha256: string) => VerifyResult;

/** Runs the existing `nirium verify <cid> --hash <sha256>` from nirium-cli; no new verifier. */
export const niriumCliVerify: Verifier = (cid, sha256) => {
  const require = createRequire(import.meta.url);
  const bin = join(dirname(require.resolve('nirium-cli/package.json')), 'bin', 'nirium.js');
  const r = spawnSync(process.execPath, [bin, 'verify', cid, '--hash', sha256, '--retries', '3'], { encoding: 'utf8' });
  return { ok: r.status === 0, output: `${r.stdout ?? ''}${r.stderr ?? ''}`.trim() };
};

export interface CheckResult {
  orderId: string;
  cid: string;
  recomputed: string;
  anchored: string;
  ok: boolean;
  verifyOutput: string;
}

/**
 * The shop's check: hash the photo it was given together with the stored
 * delivery details, and ask `nirium verify` whether that is the hash the
 * courier anchored. A different photo, or edited details, fail.
 */
export function checkDelivery(orderId: string, photoFile: string, store: DeliveryStore, verify: Verifier = niriumCliVerify): CheckResult {
  const receipt = store.receipt(orderId);
  const recomputed = hashRecord(buildRecord(store.loadDetails(orderId), readFileSync(photoFile)));
  const v = verify(receipt.cid, recomputed);
  return { orderId, cid: receipt.cid, recomputed, anchored: receipt.sha256, ok: v.ok && recomputed === receipt.sha256, verifyOutput: v.output };
}
