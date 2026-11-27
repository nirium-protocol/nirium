import { spawnSync } from 'node:child_process';
import { createRequire } from 'node:module';
import { dirname, join } from 'node:path';
import { computeCommitmentHash, hashReport } from './crypto.js';
import type { LocalStore } from './store.js';
import type { RevealResult } from './types.js';

export interface VerifyOutput {
  ok: boolean;
  output: string;
}

export type Verifier = (cid: string, sha256: string) => VerifyOutput;

/**
 * Runs the standard `nirium-cli verify <cid> --hash <sha256>` from nirium-cli.
 * No custom or modified verifier is introduced.
 */
export const niriumCliVerify: Verifier = (cid: string, sha256: string): VerifyOutput => {
  try {
    const require = createRequire(import.meta.url);
    const binPath = join(dirname(require.resolve('nirium-cli/package.json')), 'bin', 'nirium.js');
    const res = spawnSync(process.execPath, [binPath, 'verify', cid, '--hash', sha256, '--retries', '3'], {
      encoding: 'utf8',
      timeout: 15_000,
    });
    const output = `${res.stdout ?? ''}${res.stderr ?? ''}`.trim();
    return { ok: res.status === 0, output };
  } catch (err) {
    return { ok: false, output: `Verification process error: ${err}` };
  }
};

/**
 * Reveals a previously committed vulnerability report and verifies its proof-of-prior-existence:
 * 1. Retrieves the original commitment record (salt, anchored CID, expected hash).
 * 2. Recomputes reportSha256 and commitmentSha256 using the salt and current report content.
 * 3. Verifies whether recomputed hash matches the tamper-evident IPFS audit receipt anchor.
 */
export function revealReport(
  commitmentId: string,
  currentReportContent: string,
  store: LocalStore,
  verifier: Verifier = niriumCliVerify,
): RevealResult {
  const record = store.get(commitmentId);
  if (!record) {
    throw new Error(`Commitment record not found for ID "${commitmentId}" in ${store.commitmentsPath}`);
  }

  const currentReportSha = hashReport(currentReportContent);
  const recomputedCommitmentSha = computeCommitmentHash(currentReportSha, record.salt);

  const localMatch = recomputedCommitmentSha.toLowerCase() === record.commitmentSha256.toLowerCase();
  const verifyResult = verifier(record.cid, recomputedCommitmentSha);

  const ok = localMatch && verifyResult.ok;
  const tampered = !localMatch || !verifyResult.ok;

  let message = '';
  if (ok) {
    message = `[VERIFIED] Report matches anchored commitment! Proves this exact report existed at ${record.anchoredAt} anchored by ${record.attestedBy}.`;
  } else if (!localMatch) {
    message = `[TAMPERED] Report content has been modified after commitment! Recomputed hash (${recomputedCommitmentSha.slice(0, 16)}...) differs from anchored commitment (${record.commitmentSha256.slice(0, 16)}...).`;
  } else {
    message = `[FAILED] Hash matches local receipt but IPFS anchor verification failed: ${verifyResult.output}`;
  }

  return {
    id: record.id,
    reportName: record.reportName,
    cid: record.cid,
    anchoredCommitmentSha256: record.commitmentSha256,
    recomputedCommitmentSha256: recomputedCommitmentSha,
    ok,
    tampered,
    verifyOutput: verifyResult.output,
    message,
  };
}
