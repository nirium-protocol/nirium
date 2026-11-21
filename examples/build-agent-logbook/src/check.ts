import { spawnSync } from 'node:child_process';
import { createRequire } from 'node:module';
import { dirname, join } from 'node:path';
import { hashEntry } from './entry.js';
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

export interface CheckResult {
  taskId: string;
  cid: string;
  recomputed: string;
  anchored: string;
  ok: boolean;
  verifyOutput: string;
}

/**
 * Recompute the stored entry's hash and hand it to `nirium verify` together
 * with the receipt's CID. If the entry was edited after anchoring, the
 * recomputed hash no longer matches what is on IPFS and verify fails.
 */
export function checkTask(taskId: string, store: LocalStore, verify: Verifier = niriumCliVerify): CheckResult {
  const receipt = store.receipt(taskId);
  const recomputed = hashEntry(store.loadEntry(taskId));
  const v = verify(receipt.cid, recomputed);
  return { taskId, cid: receipt.cid, recomputed, anchored: receipt.sha256, ok: v.ok, verifyOutput: v.output };
}
