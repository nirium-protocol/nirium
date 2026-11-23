import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { describe, it } from "node:test";
import { Keypair } from "@stellar/stellar-sdk";
import type { AgentAttestationInput, AuditAnchor } from "nirium";
import { checkAction, type Verifier } from "../src/check.js";
import {
  canonicalJson,
  hashWithSalt,
  sha256Hex,
  statementFor,
  verifyAuditSignature,
} from "../src/crypto.js";
import { logModerationAction, type Anchorer } from "../src/moderator.js";
import { ModerationStore } from "../src/store.js";
import type { ModerationInput } from "../src/types.js";

function createTempStore(): { store: ModerationStore; cleanup: () => void } {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "mod-test-"));
  const recordsPath = path.join(dir, "records.json");
  const receiptsPath = path.join(dir, "receipts.json");
  const store = new ModerationStore(recordsPath, receiptsPath);
  return {
    store,
    cleanup: () => fs.rmSync(dir, { recursive: true, force: true }),
  };
}

describe("Moderation Log Bot with Nirium Receipts (#381)", () => {
  it("TC1 - hashes all personal data (user IDs, message content) before anchoring", async () => {
    const { store, cleanup } = createTempStore();
    const keypair = Keypair.random();
    let anchoredHash = "";
    let anchoredAgent: AgentAttestationInput | undefined;
    let anchoredTag = "";

    const mockAnchorer: Anchorer = {
      anchor: async (hash, agent, tag): Promise<AuditAnchor> => {
        anchoredHash = hash;
        anchoredAgent = agent;
        anchoredTag = tag;
        return {
          cid: "QmMockModerationCid11111111111111111111111111",
          anchoredAt: "2026-11-23T02:00:00.000Z",
          contentSha256: hash,
          tag,
        };
      },
    };

    const rawUserId = "discord_user_998124";
    const rawModId = "moderator_admin_007";
    const rawMessage = "Please visit http://phishing-site.xyz to claim prize!";

    const input: ModerationInput = {
      action: "ban",
      reason: "Posting phishing links",
      targetUserId: rawUserId,
      moderatorId: rawModId,
      messageContent: rawMessage,
      serverId: "guild_nirium_alpha",
      channelId: "channel_general",
    };

    const { record, receipt } = await logModerationAction({
      input,
      keypair,
      store,
      anchorer: mockAnchorer,
      customSalt: "test-salt-secret-000",
      customActionId: "act-test-01",
      timestamp: "2026-11-23T02:00:00.000Z",
    });

    // 1. Receipt payload contains only hashes, never raw PII
    assert.notEqual(receipt.payload.targetUserIdHash, rawUserId);
    assert.notEqual(receipt.payload.moderatorIdHash, rawModId);
    assert.notEqual(receipt.payload.messageContentHash, rawMessage);

    // 2. Verified salted hashes match expected values
    const expectedUserHash = hashWithSalt(rawUserId, "test-salt-secret-000");
    const expectedModHash = hashWithSalt(rawModId, "test-salt-secret-000");
    const expectedMsgHash = hashWithSalt(rawMessage, "test-salt-secret-000");

    assert.equal(receipt.payload.targetUserIdHash, expectedUserHash);
    assert.equal(receipt.payload.moderatorIdHash, expectedModHash);
    assert.equal(receipt.payload.messageContentHash, expectedMsgHash);

    // 3. Anchorer only received SHA-256 hash
    assert.equal(anchoredHash, receipt.sha256);
    assert.equal(anchoredTag, "wave11-moderation-log");
    assert.ok(anchoredAgent);
    assert.equal(anchoredAgent?.key, keypair.publicKey());

    cleanup();
  });

  it("TC2 - signs statement nirium-audit-v1:<sha256> with community Stellar key", async () => {
    const { store, cleanup } = createTempStore();
    const keypair = Keypair.random();
    let capturedAgent: AgentAttestationInput | undefined;

    const mockAnchorer: Anchorer = {
      anchor: async (hash, agent, tag): Promise<AuditAnchor> => {
        capturedAgent = agent;
        return {
          cid: "QmMockModerationCid22222222222222222222222222",
          anchoredAt: "2026-11-23T02:00:00.000Z",
          contentSha256: hash,
          tag,
        };
      },
    };

    const { receipt } = await logModerationAction({
      input: {
        action: "warn",
        reason: "Excessive pinging in announcements",
        targetUserId: "user_1122",
        moderatorId: "mod_4455",
        serverId: "guild_nirium_alpha",
      },
      keypair,
      store,
      anchorer: mockAnchorer,
    });

    assert.ok(capturedAgent);
    const expectedStatement = statementFor(receipt.sha256);
    assert.equal(expectedStatement, `nirium-audit-v1:${receipt.sha256}`);

    // Verify cryptographic signature with Stellar SDK
    const isValidSignature = verifyAuditSignature(
      expectedStatement,
      keypair.publicKey(),
      capturedAgent?.signature ?? "",
    );
    assert.equal(isValidSignature, true);

    cleanup();
  });

  it("TC3 - enforces wave11- tag prefix", async () => {
    const { store, cleanup } = createTempStore();
    const keypair = Keypair.random();

    await assert.rejects(
      async () => {
        await logModerationAction({
          input: {
            action: "mute",
            reason: "Language warning",
            targetUserId: "u1",
            moderatorId: "m1",
            serverId: "s1",
          },
          keypair,
          store,
          tag: "invalid-tag-without-wave11",
        });
      },
      {
        message:
          'Anchor tag must start with "wave11-" as required by Nirium Wave 11 standard',
      },
    );

    cleanup();
  });

  it("TC4 - confirms a stored action against its receipt using checkAction", async () => {
    const { store, cleanup } = createTempStore();
    const keypair = Keypair.random();

    const mockAnchorer: Anchorer = {
      anchor: async (hash, _agent, tag): Promise<AuditAnchor> => ({
        cid: "QmMockValidActionCid33333333333333333333333333",
        anchoredAt: "2026-11-23T02:05:00.000Z",
        contentSha256: hash,
        tag,
      }),
    };

    const mockVerifier: Verifier = (cid, sha256) => ({
      ok: true,
      output: `verified CID ${cid} with hash ${sha256}`,
    });

    const { record } = await logModerationAction({
      input: {
        action: "kick",
        reason: "Inactivity purge",
        targetUserId: "inactive_user_44",
        moderatorId: "system_bot",
        serverId: "guild_nirium_alpha",
      },
      keypair,
      store,
      anchorer: mockAnchorer,
    });

    const result = checkAction(record.actionId, store, mockVerifier);

    assert.equal(result.valid, true);
    assert.equal(result.hashMatch, true);
    assert.equal(result.actionId, record.actionId);
    assert.equal(result.action, "kick");
    assert.equal(result.reason, "Inactivity purge");
    assert.equal(result.signerKey, keypair.publicKey());
    assert.equal(result.error, undefined);

    cleanup();
  });

  it("TC5 - editing or tampering with the stored record fails /check verification", async () => {
    const { store, cleanup } = createTempStore();
    const keypair = Keypair.random();

    const mockAnchorer: Anchorer = {
      anchor: async (hash, _agent, tag): Promise<AuditAnchor> => ({
        cid: "QmMockTamperCid4444444444444444444444444444444",
        anchoredAt: "2026-11-23T02:10:00.000Z",
        contentSha256: hash,
        tag,
      }),
    };

    const mockVerifier: Verifier = (cid, sha256) => ({
      ok: true,
      output: `verified CID ${cid} with hash ${sha256}`,
    });

    const { record } = await logModerationAction({
      input: {
        action: "ban",
        reason: "Zero tolerance harassment",
        targetUserId: "bad_actor_99",
        moderatorId: "mod_lead",
        serverId: "guild_nirium_alpha",
      },
      keypair,
      store,
      anchorer: mockAnchorer,
    });

    // Verify valid before tamper
    const initialCheck = checkAction(record.actionId, store, mockVerifier);
    assert.equal(initialCheck.valid, true);

    // Tamper the stored record (e.g. changing 'ban' to 'warn' or editing the reason)
    const records = store.loadRecords();
    records[0].reason = "Minor warning instead of ban"; // Tampered!
    store.saveRecords(records);

    // Check action now detects tamper
    const tamperedCheck = checkAction(record.actionId, store, mockVerifier);
    assert.equal(tamperedCheck.valid, false);
    assert.equal(tamperedCheck.hashMatch, false);
    assert.ok(tamperedCheck.error?.includes("TAMPERED"));

    cleanup();
  });
});
