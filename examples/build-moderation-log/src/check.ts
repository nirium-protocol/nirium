import { spawnSync } from "node:child_process";
import { createRequire } from "node:module";
import { dirname, join } from "node:path";
import { canonicalJson, hashWithSalt, sha256Hex } from "./crypto.js";
import type { ModerationStore } from "./store.js";
import type {
  AnchoredModerationPayload,
  CheckResult,
} from "./types.js";

export interface VerifyOutput {
  ok: boolean;
  output: string;
}

export type Verifier = (cid: string, sha256: string) => VerifyOutput;

/**
 * Runs the standard `nirium-cli verify <cid> --hash <sha256>` from nirium-cli.
 * No custom verifier is built.
 */
export const niriumCliVerify: Verifier = (
  cid: string,
  sha256: string,
): VerifyOutput => {
  try {
    const require = createRequire(import.meta.url);
    const binPath = join(
      dirname(require.resolve("nirium-cli/package.json")),
      "bin",
      "nirium.js",
    );
    const res = spawnSync(
      process.execPath,
      [binPath, "verify", cid, "--hash", sha256, "--retries", "3"],
      {
        encoding: "utf8",
        timeout: 15_000,
      },
    );
    const output = `${res.stdout ?? ""}${res.stderr ?? ""}`.trim();
    return { ok: res.status === 0, output };
  } catch (err) {
    return { ok: false, output: `Verification process error: ${err}` };
  }
};

/**
 * Checks a stored moderation action against its anchored Nirium receipt:
 * 1. Retrieves stored record and receipt by actionId.
 * 2. Reconstructs AnchoredModerationPayload from stored record using its secret salt.
 * 3. Recomputes payload SHA-256 and compares with receipt hash.
 * 4. Runs `nirium-cli verify <cid> --hash <recomputedHash>` against the testnet node.
 * 5. Fails if the stored record was modified or rewritten.
 */
export function checkAction(
  actionId: string,
  store: ModerationStore,
  verifier: Verifier = niriumCliVerify,
): CheckResult {
  const record = store.getRecord(actionId);
  const receipt = store.getReceipt(actionId);

  if (!record) {
    return {
      valid: false,
      actionId,
      action: "warn",
      reason: "",
      cid: "",
      signerKey: "",
      hashMatch: false,
      error: `Record not found for actionId "${actionId}"`,
    };
  }

  if (!receipt) {
    return {
      valid: false,
      actionId,
      action: record.action,
      reason: record.reason,
      cid: "",
      signerKey: "",
      hashMatch: false,
      error: `Receipt not found for actionId "${actionId}"`,
    };
  }

  // Reconstruct payload using stored record and salt
  const moderatorIdHash = hashWithSalt(record.moderatorId, record.salt);
  const targetUserIdHash = hashWithSalt(record.targetUserId, record.salt);
  const messageContentHash = record.messageContent
    ? hashWithSalt(record.messageContent, record.salt)
    : undefined;

  const recomputedPayload: AnchoredModerationPayload = {
    actionId: record.actionId,
    action: record.action,
    reason: record.reason,
    moderatorIdHash,
    targetUserIdHash,
    ...(messageContentHash ? { messageContentHash } : {}),
    ...(record.channelId ? { channelId: record.channelId } : {}),
    serverId: record.serverId,
    timestamp: record.timestamp,
  };

  const recomputedCanonical = canonicalJson(recomputedPayload);
  const recomputedSha256 = sha256Hex(recomputedCanonical);

  const hashMatch =
    recomputedSha256.toLowerCase() === receipt.sha256.toLowerCase();

  if (!hashMatch) {
    return {
      valid: false,
      actionId,
      action: record.action,
      reason: record.reason,
      cid: receipt.cid,
      signerKey: receipt.signerKey,
      hashMatch: false,
      error: `TAMPERED: Stored record hash (${recomputedSha256.slice(0, 16)}...) differs from anchored receipt hash (${receipt.sha256.slice(0, 16)}...)`,
    };
  }

  // Verify against IPFS / Nirium testnet node
  const verifyResult = verifier(receipt.cid, recomputedSha256);

  return {
    valid: verifyResult.ok,
    actionId,
    action: record.action,
    reason: record.reason,
    cid: receipt.cid,
    signerKey: receipt.signerKey,
    hashMatch: true,
    error: verifyResult.ok ? undefined : verifyResult.output,
  };
}
