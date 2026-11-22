import { spawnSync } from 'node:child_process';
import { createRequire } from 'node:module';
import { dirname, join } from 'node:path';
import { sha256Hex, summarizeContributors } from './batch.js';
import { verifySensorReading, type ReadingVerification } from './sensor.js';
import type { BatchStore } from './store.js';

export interface VerifyResult {
    ok: boolean;
    output: string;
}

export type Verifier = (cid: string, sha256: string) => VerifyResult;

/**
 * Runs the existing `nirium verify <cid> --hash <sha256>` from `nirium-cli`.
 * Does not implement a custom verifier.
 */
export const niriumCliVerify: Verifier = (cid, sha256) => {
    const require = createRequire(import.meta.url);
    const bin = join(dirname(require.resolve('nirium-cli/package.json')), 'bin', 'nirium.js');
    const res = spawnSync(
        process.execPath,
        [bin, 'verify', cid, '--hash', sha256, '--require-signature', '--retries', '3'],
        { encoding: 'utf8' },
    );
    return {
        ok: res.status === 0,
        output: `${res.stdout ?? ''}${res.stderr ?? ''}`.trim(),
    };
};

export interface BatchCheckResult {
    batchId: string;
    cid: string;
    recomputedSha256: string;
    anchoredSha256: string;
    sensorChecks: ReadingVerification[];
    failedReadings: ReadingVerification[];
    contributorsMatch: boolean;
    receiptVerified: boolean;
    verifyOutput: string;
    ok: boolean;
    failureReasons: string[];
}

/**
 * Verify BOTH layers for a stored batch:
 *   1. Every individual reading's ed25519 sensor signature (and contributor manifest).
 *   2. The batch Audit Trail receipt via `nirium-cli verify <cid> --hash <sha256>`.
 */
export function checkBatch(
    batchId: string,
    store: BatchStore,
    verify: Verifier = niriumCliVerify,
): BatchCheckResult {
    const receipt = store.receipt(batchId);
    const { batch, rawBytes } = store.loadBatchRaw(batchId);

    const sensorChecks = batch.readings.map((entry) => verifySensorReading(entry));
    const failedReadings = sensorChecks.filter((r) => !r.valid);

    let contributorsMatch = true;
    let contributorError: string | undefined;
    try {
        const recomputedContributors = summarizeContributors(batch.readings);
        contributorsMatch =
            JSON.stringify(recomputedContributors) === JSON.stringify(batch.contributingSensors);
        if (!contributorsMatch) {
            contributorError = 'contributingSensors manifest does not match readings in batch file';
        }
    } catch (err) {
        contributorsMatch = false;
        contributorError = err instanceof Error ? err.message : String(err);
    }

    const recomputedSha256 = sha256Hex(rawBytes);
    const v = verify(receipt.cid, recomputedSha256);

    const failureReasons: string[] = [];
    for (const bad of failedReadings) {
        failureReasons.push(
            `Reading ${bad.readingId} (sensor ${bad.sensorId}) failed ed25519 verification: ${bad.reason}`,
        );
    }
    if (contributorError) {
        failureReasons.push(contributorError);
    }
    if (!v.ok) {
        failureReasons.push(
            `Batch receipt verification failed for CID ${receipt.cid} ` +
                `(recomputed ${recomputedSha256}, anchored ${receipt.sha256})`,
        );
    }

    const ok = failedReadings.length === 0 && contributorsMatch && v.ok;

    return {
        batchId,
        cid: receipt.cid,
        recomputedSha256,
        anchoredSha256: receipt.sha256,
        sensorChecks,
        failedReadings,
        contributorsMatch,
        receiptVerified: v.ok,
        verifyOutput: v.output,
        ok,
        failureReasons,
    };
}
