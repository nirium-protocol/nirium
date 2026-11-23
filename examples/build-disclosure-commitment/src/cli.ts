import { existsSync, readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { Keypair } from '@stellar/stellar-sdk';
import 'dotenv/config';
import { commitReport, niriumAnchorer } from './anchor.js';
import { createLocalStore } from './store.js';
import { revealReport } from './verify.js';

function getSignerKeypair(): Keypair {
  const secret = process.env.RESEARCHER_SECRET_KEY;
  if (!secret) {
    console.error('Error: RESEARCHER_SECRET_KEY environment variable is required.');
    console.error('Provide a Stellar testnet secret key starting with S (or create one using Keypair.random()).');
    process.exit(1);
  }
  try {
    return Keypair.fromSecret(secret);
  } catch (err) {
    console.error('Error: Invalid RESEARCHER_SECRET_KEY format:', err);
    process.exit(1);
  }
}

async function main() {
  const args = process.argv.slice(2);
  const command = args[0];
  const store = createLocalStore();

  if (command === 'commit') {
    const reportPath = args[1];
    if (!reportPath) {
      console.error('Usage: npm run commit <path-to-report>');
      process.exit(1);
    }

    const fullPath = resolve(process.cwd(), reportPath);
    if (!existsSync(fullPath)) {
      console.error(`Error: Report file not found at ${fullPath}`);
      process.exit(1);
    }

    const reportContent = readFileSync(fullPath, 'utf8');
    const keypair = getSignerKeypair();
    const tag = process.env.NIRIUM_AUDIT_TAG ?? 'wave11-disclosure-commitment';
    const auditUrl = process.env.NIRIUM_AUDIT_URL ?? 'https://nirium-agent.fly.dev';

    console.log(`\nAnchoring vulnerability disclosure commitment on Nirium Audit Trail...`);
    console.log(`- Report: ${reportPath}`);
    console.log(`- Signer: ${keypair.publicKey()}`);
    console.log(`- Tag:    ${tag}`);
    console.log(`- Node:   ${auditUrl}\n`);

    try {
      const record = await commitReport({
        reportContent,
        reportName: reportPath,
        keypair,
        store,
        anchorer: niriumAnchorer(auditUrl),
        tag,
      });

      console.log('✅ Commitment Anchored Successfully!\n');
      console.log(`Commitment ID:   ${record.id}`);
      console.log(`Report SHA-256:  ${record.reportSha256}`);
      console.log(`Random Salt:     ${record.salt}`);
      console.log(`Commitment Hash: ${record.commitmentSha256}`);
      console.log(`IPFS CID:        ${record.cid}`);
      console.log(`Anchored At:     ${record.anchoredAt}`);
      console.log(`Attested By:     ${record.attestedBy}`);
      console.log(`Verify Online:   https://nirium.xyz/verify?cid=${record.cid}&hash=${record.commitmentSha256}\n`);
      console.log(`To reveal and verify later, run:`);
      console.log(`  npm run reveal ${record.id} ${reportPath}\n`);
    } catch (err) {
      console.error('Error committing report:', err);
      process.exit(1);
    }
  } else if (command === 'reveal') {
    const commitmentId = args[1];
    if (!commitmentId) {
      console.error('Usage: npm run reveal <commitment-id> [path-to-report]');
      process.exit(1);
    }

    const record = store.get(commitmentId);
    if (!record) {
      console.error(`Error: Commitment record "${commitmentId}" not found in ${store.commitmentsPath}`);
      process.exit(1);
    }

    const reportPath = args[2] ?? record.reportName;
    const fullPath = resolve(process.cwd(), reportPath);
    if (!existsSync(fullPath)) {
      console.error(`Error: Report file not found at ${fullPath}`);
      process.exit(1);
    }

    const currentContent = readFileSync(fullPath, 'utf8');
    console.log(`\nRevealing and verifying commitment for "${record.id}"...`);
    console.log(`- Target CID:     ${record.cid}`);
    console.log(`- Anchored Hash:  ${record.commitmentSha256}`);
    console.log(`- Checking File:  ${reportPath}\n`);

    const result = revealReport(record.id, currentContent, store);

    if (result.ok) {
      console.log('🎉 VERIFICATION PASSED: Genuine Pre-Disclosure Commitment Confirmed!');
      console.log(result.message);
      console.log(`\nnirium-cli output:\n${result.verifyOutput}\n`);
    } else {
      console.error('❌ VERIFICATION FAILED: Tampering or mismatch detected!');
      console.error(result.message);
      if (result.verifyOutput) {
        console.error(`\nnirium-cli output:\n${result.verifyOutput}\n`);
      }
      process.exit(1);
    }
  } else if (command === 'list') {
    const commitments = store.load();
    if (commitments.length === 0) {
      console.log('No commitments stored yet. Use "npm run commit <report>" to create one.');
      return;
    }
    console.log(`\nStored Disclosure Commitments (${commitments.length}):\n`);
    for (const c of commitments) {
      console.log(`[${c.id}] ${c.reportName}`);
      console.log(`  CID:        ${c.cid}`);
      console.log(`  Hash:       ${c.commitmentSha256}`);
      console.log(`  AnchoredAt: ${c.anchoredAt}`);
      console.log(`  Signer:     ${c.attestedBy}`);
      console.log('');
    }
  } else {
    console.log(`Nirium Disclosure Commitment Tool\n`);
    console.log(`Usage:`);
    console.log(`  npm run commit <report-file>           Commit and anchor a report`);
    console.log(`  npm run reveal <commitment-id> [file]  Reveal and verify a report`);
    console.log(`  npm run commitments                    List all recorded commitments\n`);
  }
}

main().catch((err) => {
  console.error('Fatal CLI error:', err);
  process.exit(1);
});
