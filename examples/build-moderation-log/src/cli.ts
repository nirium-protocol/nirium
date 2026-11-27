import { Keypair } from "@stellar/stellar-sdk";
import dotenv from "dotenv";
import { checkAction } from "./check.js";
import { logModerationAction } from "./moderator.js";
import { ModerationStore } from "./store.js";
import type { ModerationAction } from "./types.js";

dotenv.config();

function getKeypair(): Keypair {
  const secret = process.env.STELLAR_SECRET_KEY;
  if (!secret) {
    console.warn(
      "[WARN] STELLAR_SECRET_KEY not set in environment. Generating a temporary testnet keypair.",
    );
    return Keypair.random();
  }
  return Keypair.fromSecret(secret);
}

function printUsage(): void {
  console.log(`
Nirium Moderation Log Bot CLI

Usage:
  node --import tsx src/cli.ts log <action> <targetUserId> <reason> [messageContent]
  node --import tsx src/cli.ts check <actionId>
  node --import tsx src/cli.ts list
  node --import tsx src/cli.ts tamper <actionId> <newReason>

Actions:
  warn | mute | ban | message_removal | kick

Examples:
  node --import tsx src/cli.ts log ban user_9981 "Repeated spam in general" "Buy cheap tokens at scam.xyz"
  node --import tsx src/cli.ts check mod-179534-a1b2
  node --import tsx src/cli.ts list
`);
}

async function main(): Promise<void> {
  const args = process.argv.slice(2);
  const command = args[0];
  const store = new ModerationStore();

  if (!command || command === "--help" || command === "-h") {
    printUsage();
    return;
  }

  if (command === "log") {
    const action = args[1] as ModerationAction;
    const targetUserId = args[2];
    const reason = args[3];
    const messageContent = args[4];

    if (!action || !targetUserId || !reason) {
      console.error(
        "Error: Missing required arguments. Expected: log <action> <targetUserId> <reason> [messageContent]",
      );
      process.exit(1);
    }

    const validActions: ModerationAction[] = [
      "warn",
      "mute",
      "ban",
      "message_removal",
      "kick",
    ];
    if (!validActions.includes(action)) {
      console.error(
        `Error: Invalid action "${action}". Allowed: ${validActions.join(", ")}`,
      );
      process.exit(1);
    }

    const keypair = getKeypair();
    console.log(`Logging moderation action [${action.toUpperCase()}]...`);
    console.log(`Signer Public Key: ${keypair.publicKey()}`);

    try {
      const { record, receipt } = await logModerationAction({
        input: {
          action,
          targetUserId,
          reason,
          messageContent,
          moderatorId: "mod_guardian_01",
          serverId: "discord_guild_nirium_alpha",
          channelId: "channel_general_01",
        },
        keypair,
        store,
      });

      console.log("\n[SUCCESS] Action anchored to Nirium Testnet Audit Trail!");
      console.log(`  Action ID:   ${record.actionId}`);
      console.log(`  CID:         ${receipt.cid}`);
      console.log(`  SHA-256:     ${receipt.sha256}`);
      console.log(`  Tag:         ${receipt.tag}`);
      console.log(`  Anchored At: ${receipt.anchoredAt}`);
      console.log(`  Signer:      ${receipt.signerKey}`);
      console.log("\nZero personal data was transmitted to IPFS. Hashes were verified.");
    } catch (err) {
      console.error("Failed to anchor action:", err);
      process.exit(1);
    }
  } else if (command === "check") {
    const actionId = args[1];
    if (!actionId) {
      console.error("Error: Missing actionId. Expected: check <actionId>");
      process.exit(1);
    }

    console.log(`Checking action "${actionId}" against anchored receipt...`);
    const result = checkAction(actionId, store);

    if (result.valid) {
      console.log(`\n[VERIFIED] Moderation decision is genuine and unmodified!`);
      console.log(`  Action ID:   ${result.actionId}`);
      console.log(`  Action:      ${result.action.toUpperCase()}`);
      console.log(`  Reason:      ${result.reason}`);
      console.log(`  CID:         ${result.cid}`);
      console.log(`  Signer:      ${result.signerKey}`);
      console.log(`  Hash Match:  ${result.hashMatch}`);
    } else {
      console.error(`\n[CHECK FAILED / TAMPERED] Action does not match receipt!`);
      console.error(`  Action ID:  ${result.actionId}`);
      console.error(`  Error:      ${result.error}`);
      process.exit(1);
    }
  } else if (command === "list") {
    const records = store.loadRecords();
    const receipts = store.loadReceipts();
    console.log(`\n=== Stored Moderation Actions (${records.length}) ===\n`);

    if (records.length === 0) {
      console.log("No actions recorded yet. Use 'log' to record one.");
      return;
    }

    for (const r of records) {
      const rcpt = receipts.find((x) => x.actionId === r.actionId);
      console.log(`[${r.actionId}] ${r.action.toUpperCase()} - ${r.reason}`);
      console.log(`  Server:    ${r.serverId} | Date: ${r.timestamp}`);
      console.log(`  CID:       ${rcpt?.cid ?? "Pending / None"}`);
      console.log(`  Hash:      ${rcpt?.sha256 ?? "N/A"}`);
      console.log(`  Signer:    ${rcpt?.signerKey ?? "N/A"}`);
      console.log("------------------------------------------------------------");
    }
  } else if (command === "tamper") {
    const actionId = args[1];
    const newReason = args[2] ?? "Altered reason after the fact!";
    if (!actionId) {
      console.error("Error: Missing actionId. Expected: tamper <actionId> [newReason]");
      process.exit(1);
    }

    const records = store.loadRecords();
    const rec = records.find((r) => r.actionId === actionId);
    if (!rec) {
      console.error(`Error: Record "${actionId}" not found.`);
      process.exit(1);
    }

    const oldReason = rec.reason;
    rec.reason = newReason;
    store.saveRecords(records);

    console.log(`[TAMPERED] Modified reason for "${actionId}":`);
    console.log(`  Old Reason: "${oldReason}"`);
    console.log(`  New Reason: "${newReason}"`);
    console.log(`Run 'check ${actionId}' to demonstrate tamper detection!`);
  } else {
    console.error(`Unknown command: ${command}`);
    printUsage();
    process.exit(1);
  }
}

main().catch((err) => {
  console.error("Fatal error:", err);
  process.exit(1);
});
