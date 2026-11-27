import { Keypair } from "@stellar/stellar-sdk";
import { checkAction, niriumCliVerify } from "../src/check.js";
import { logModerationAction, niriumAnchorer } from "../src/moderator.js";
import { ModerationStore } from "../src/store.js";
import type { ModerationInput } from "../src/types.js";

async function main() {
  const store = new ModerationStore();
  const keypair = Keypair.random();
  console.log("Community Moderation Bot Signer Public Key:", keypair.publicKey());

  const actions: ModerationInput[] = [
    {
      action: "warn",
      targetUserId: "discord_usr_849201",
      reason: "Repeated spamming of bot commands in #general",
      messageContent: "!play song !play song !play song",
      moderatorId: "mod_guardian_01",
      serverId: "guild_nirium_community_demo",
      channelId: "chan_general_chat",
    },
    {
      action: "mute",
      targetUserId: "discord_usr_391042",
      reason: "Disruptive acoustic noise and harassment in voice lounge",
      moderatorId: "mod_guardian_02",
      serverId: "guild_nirium_community_demo",
      channelId: "voice_community_lounge",
    },
    {
      action: "message_removal",
      targetUserId: "discord_usr_119284",
      reason: "Posting deceptive phishing links disguised as airdrop",
      messageContent: "Claim 5000 free tokens here: https://airdrop-stealer.xyz",
      moderatorId: "mod_sentinel_bot",
      serverId: "guild_nirium_community_demo",
      channelId: "chan_announcements",
    },
    {
      action: "kick",
      targetUserId: "discord_usr_772019",
      reason: "Unsolicited promotional DM spam sent to 50+ members",
      moderatorId: "mod_lead_admin",
      serverId: "guild_nirium_community_demo",
    },
    {
      action: "ban",
      targetUserId: "discord_usr_994102",
      reason: "Malicious impersonation of Nirium core team administrators",
      messageContent: "I am Nirium Support, send private key to verify wallet",
      moderatorId: "mod_lead_admin",
      serverId: "guild_nirium_community_demo",
      channelId: "chan_helpdesk",
    },
  ];

  const results = [];
  const anchorer = niriumAnchorer();

  for (let i = 0; i < actions.length; i++) {
    const input = actions[i];
    console.log(`\nAnchoring Action ${i + 1}/5: [${input.action.toUpperCase()}] for target ${input.targetUserId}...`);
    const { record, receipt } = await logModerationAction({
      input,
      keypair,
      store,
      anchorer,
      tag: "wave11-moderation-log",
    });

    console.log(`  Action ID:   ${record.actionId}`);
    console.log(`  CID:         ${receipt.cid}`);
    console.log(`  SHA-256:     ${receipt.sha256}`);
    console.log(`  Anchored At: ${receipt.anchoredAt}`);

    // Verify immediately
    const verifyRes = niriumCliVerify(receipt.cid, receipt.sha256);
    console.log(`  Verify Output (status ${verifyRes.ok}):`, verifyRes.output);

    results.push({
      actionId: record.actionId,
      action: record.action,
      targetUserId: record.targetUserId,
      reason: record.reason,
      cid: receipt.cid,
      sha256: receipt.sha256,
      signerKey: receipt.signerKey,
      anchoredAt: receipt.anchoredAt,
      verifyOutput: verifyRes.output,
    });

    // Small pause between anchors
    await new Promise((r) => setTimeout(r, 1500));
  }

  console.log("\n=== 5 Real Testnet Anchors Complete ===");
  console.log(JSON.stringify(results, null, 2));
}

main().catch(console.error);
