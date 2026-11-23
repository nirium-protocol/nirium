import { Keypair } from "@stellar/stellar-sdk";
import { Agent as NiriumAgent, type AgentAttestationInput, type AuditAnchor } from "nirium";
import {
  canonicalJson,
  generateSalt,
  hashWithSalt,
  sha256Hex,
  statementFor,
} from "./crypto.js";
import type { ModerationStore } from "./store.js";
import type {
  AnchoredModerationPayload,
  ModerationInput,
  ModerationReceipt,
  ModerationStoreRecord,
} from "./types.js";

export interface Anchorer {
  anchor(hash: string, agent: AgentAttestationInput, tag: string): Promise<AuditAnchor>;
}

/**
 * Anchors through the published Nirium SDK client against the testnet node.
 * Sends ONLY hash, tag, and agent signature; zero raw PII is ever sent.
 */
export function niriumAnchorer(
  baseUrl = "https://nirium-agent.fly.dev",
  apiKey = "",
): Anchorer {
  const client = new NiriumAgent({ apiKey, baseUrl });
  return {
    anchor: (hash, agent, tag) => client.anchorAuditRecord({ hash, tag, agent }),
  };
}

export function attest(
  sha256: string,
  keypair: Keypair,
  id = "moderation-log-bot",
): AgentAttestationInput {
  return {
    key: keypair.publicKey(),
    signature: keypair
      .sign(Buffer.from(statementFor(sha256), "utf-8"))
      .toString("base64"),
    id,
  };
}

export interface LogModerationOptions {
  input: ModerationInput;
  keypair: Keypair;
  store: ModerationStore;
  anchorer?: Anchorer;
  tag?: string;
  customSalt?: string;
  customActionId?: string;
  timestamp?: string;
}

/**
 * Logs a moderation action with cryptographic audit trail guarantees:
 * 1. Hashes user IDs and message content with a secret salt so zero personal data is anchored.
 * 2. Prepares AnchoredModerationPayload containing hashed identifiers and action details.
 * 3. Computes deterministic SHA-256 of the canonical JSON payload.
 * 4. Signs statement `nirium-audit-v1:<sha256>` with community's Stellar key.
 * 5. Anchors hash to Nirium audit trail testnet node with a `wave11-` tag.
 * 6. Stores private record in local store and public receipt for verification.
 */
export async function logModerationAction(
  options: LogModerationOptions,
): Promise<{ record: ModerationStoreRecord; receipt: ModerationReceipt }> {
  const {
    input,
    keypair,
    store,
    anchorer = niriumAnchorer(),
    tag = "wave11-moderation-log",
    customSalt,
    customActionId,
    timestamp = new Date().toISOString(),
  } = options;

  if (!tag.startsWith("wave11-")) {
    throw new Error(
      'Anchor tag must start with "wave11-" as required by Nirium Wave 11 standard',
    );
  }

  const salt = customSalt ?? generateSalt(32);
  const actionId =
    customActionId ??
    `mod-${Date.now().toString(36)}-${Math.random().toString(36).substring(2, 6)}`;

  // Salt and hash PII: moderator ID, target user ID, and message content
  const moderatorIdHash = hashWithSalt(input.moderatorId, salt);
  const targetUserIdHash = hashWithSalt(input.targetUserId, salt);
  const messageContentHash = input.messageContent
    ? hashWithSalt(input.messageContent, salt)
    : undefined;

  const payload: AnchoredModerationPayload = {
    actionId,
    action: input.action,
    reason: input.reason,
    moderatorIdHash,
    targetUserIdHash,
    ...(messageContentHash ? { messageContentHash } : {}),
    ...(input.channelId ? { channelId: input.channelId } : {}),
    serverId: input.serverId,
    timestamp,
  };

  const canonicalPayloadStr = canonicalJson(payload);
  const payloadSha256 = sha256Hex(canonicalPayloadStr);

  const attestation = attest(payloadSha256, keypair);
  const anchorResult = await anchorer.anchor(payloadSha256, attestation, tag);

  const returnedHash = String(
    anchorResult.contentSha256 ??
      (anchorResult as Record<string, unknown>).content_sha256 ??
      "",
  ).toLowerCase();

  if (returnedHash && returnedHash !== payloadSha256.toLowerCase()) {
    throw new Error(
      `Node anchored ${returnedHash}, but expected ${payloadSha256}`,
    );
  }

  const record: ModerationStoreRecord = {
    actionId,
    action: input.action,
    reason: input.reason,
    moderatorId: input.moderatorId,
    targetUserId: input.targetUserId,
    messageContent: input.messageContent,
    channelId: input.channelId,
    serverId: input.serverId,
    salt,
    timestamp,
  };

  const receipt: ModerationReceipt = {
    actionId,
    cid: anchorResult.cid,
    sha256: payloadSha256,
    signerKey: keypair.publicKey(),
    tag,
    anchoredAt: anchorResult.anchoredAt,
    payload,
  };

  store.addRecord(record);
  store.addReceipt(receipt);

  return { record, receipt };
}
