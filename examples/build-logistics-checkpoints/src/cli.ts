import 'dotenv/config';
import { Keypair } from '@stellar/stellar-sdk';
import { verifyShipmentChain } from './chain.js';
import { niriumAnchorer, recordHandoff } from './checkpoint.js';
import { createDemoParties, runBrokenChainDemoMissingHandoff, runValidShipmentDemo } from './demo.js';
import { sha256Hex } from './record.js';
import { CheckpointStore } from './store.js';

const env = (k: string, d = '') => (process.env[k] ?? d).trim();
const store = new CheckpointStore(env('CHECKPOINT_DIR', '.checkpoints'));

function flag(args: string[], name: string): string | undefined {
  const i = args.indexOf(name);
  return i >= 0 ? args[i + 1] : undefined;
}

function getAnchorer() {
  return niriumAnchorer(
    env('NIRIUM_API_URL', 'https://nirium-agent.fly.dev'),
    env('NIRIUM_API_KEY'),
  );
}

const DEFAULT_TAG = env('LOGISTICS_TAG', 'wave11-logistics-checkpoints');

async function main(argv: string[]): Promise<number> {
  const [cmd, ...rest] = argv;

  if (cmd === 'demo') {
    console.log('=== NIRIUM LOGISTICS CHECKPOINTS: MULTI-PARTY DEMO ===\n');
    const parties = createDemoParties();
    console.log('Participating Logistics Parties:');
    for (const p of parties) {
      console.log(`- ${p.id.padEnd(24)} (${p.name}): ${p.keypair.publicKey()}`);
    }
    console.log(`\nAudit Trail Tag: ${DEFAULT_TAG}\n`);

    // 1. Run Valid 4-Party Shipment Chain
    const validShipmentId = `SHP-VALID-${Date.now().toString().slice(-4)}`;
    console.log(`--- Scenario 1: Valid 4-Party Chain (${validShipmentId}) ---`);
    const validReceipts = await runValidShipmentDemo(validShipmentId, {
      store,
      anchorer: getAnchorer(),
      tag: DEFAULT_TAG,
      parties,
    });

    for (const r of validReceipts) {
      console.log(
        `[Handoff ${r.handoffIndex}] ${r.partyId.padEnd(22)} @ ${r.locationLabel.padEnd(30)} -> CID: ${r.cid}`,
      );
    }

    console.log(`\nVerifying chain integrity with 'nirium-cli verify' & provenance rules...`);
    const validResult = await verifyShipmentChain(validShipmentId, store);
    console.log(`Chain Valid: ${validResult.valid ? 'YES (PASSED)' : 'NO (FAILED)'}`);
    if (validResult.errors.length > 0) {
      console.error('Errors:', validResult.errors);
    }

    // 2. Run Broken Chain Demo (Missing Handoff)
    const brokenShipmentId = `SHP-BROKEN-${Date.now().toString().slice(-4)}`;
    console.log(`\n--- Scenario 2: Broken Chain - Missing Handoff (${brokenShipmentId}) ---`);
    await runBrokenChainDemoMissingHandoff(brokenShipmentId, {
      store,
      anchorer: getAnchorer(),
      tag: DEFAULT_TAG,
      parties,
    });

    console.log(`Verifying broken chain integrity...`);
    const brokenResult = await verifyShipmentChain(brokenShipmentId, store);
    console.log(`Chain Valid: ${brokenResult.valid ? 'PASSED (UNEXPECTED)' : 'CAUGHT & FLAGGED (EXPECTED)'}`);
    console.log(`Flagged Integrity Errors:`);
    for (const err of brokenResult.errors) {
      console.log(` ❌ ${err}`);
    }

    return validResult.valid && !brokenResult.valid ? 0 : 1;
  }

  if (cmd === 'check-chain') {
    const [shipmentId] = rest;
    if (!shipmentId) {
      console.error('usage: check-chain <shipment-id>');
      return 2;
    }
    console.log(`Verifying logistics chain for shipment '${shipmentId}'...`);
    const result = await verifyShipmentChain(shipmentId, store);

    console.log(`\n=== Verification Report: ${shipmentId} ===`);
    console.log(`Total Handoffs: ${result.totalHandoffs}`);
    console.log(`Overall Status: ${result.valid ? 'PASSED' : 'FAILED'}\n`);

    for (const h of result.handoffs) {
      console.log(`Handoff [${h.index}] - Party: ${h.partyId}`);
      console.log(`  CID:        ${h.cid}`);
      console.log(`  SHA-256:    ${h.sha256}`);
      console.log(`  AttestedBy: ${h.attestedBy}`);
      console.log(`  Status:     ${h.verified ? 'VERIFIED' : `FAILED: ${h.error}`}`);
      console.log();
    }

    if (!result.valid) {
      console.error('Violations caught:');
      for (const e of result.errors) console.error(`- ${e}`);
      return 1;
    }
    return 0;
  }

  if (cmd === 'record-handoff') {
    const shipmentId = flag(rest, '--shipment');
    const index = Number(flag(rest, '--index') ?? 0);
    const party = flag(rest, '--party') ?? 'origin';
    const location = flag(rest, '--location') ?? 'Facility';
    const secret = flag(rest, '--secret') ?? env('ORIGIN_SECRET');
    const prevCid = flag(rest, '--prev-cid') ?? null;
    const barcode = flag(rest, '--barcode') ?? `${shipmentId}-payload`;

    if (!shipmentId || !secret) {
      console.error('usage: record-handoff --shipment <id> --index <n> --party <id> --location <loc> --secret <sec> [--prev-cid <cid>]');
      return 2;
    }

    const keypair = Keypair.fromSecret(secret);
    const receipt = await recordHandoff(
      {
        shipmentId,
        handoffIndex: index,
        partyId: party,
        locationLabel: location,
        timestamp: new Date().toISOString(),
        scanHash: sha256Hex(barcode),
        previousHandoffCid: prevCid,
      },
      {
        store,
        anchorer: getAnchorer(),
        keypair,
        tag: DEFAULT_TAG,
      },
    );

    console.log(`Recorded handoff ${receipt.handoffIndex} for ${receipt.shipmentId}:`);
    console.log(`CID: ${receipt.cid}`);
    console.log(`SHA-256: ${receipt.sha256}`);
    console.log(`Attested by: ${receipt.attestedBy}`);
    return 0;
  }

  if (cmd === 'receipts') {
    if (rest.includes('--new-key')) {
      const parties = ['Origin', 'Carrier', 'Distributor', 'Destination'];
      console.log('Generated fresh Stellar testnet keypairs:\n');
      for (const p of parties) {
        const kp = Keypair.random();
        console.log(`[${p}]`);
        console.log(`Public:  ${kp.publicKey()}`);
        console.log(`Secret:  ${kp.secret()}\n`);
      }
      return 0;
    }
    const all = store.allReceipts();
    console.log(`Total stored receipts: ${all.length}`);
    for (const r of all) {
      console.log(`[${r.shipmentId} #${r.handoffIndex}] ${r.partyId} -> CID: ${r.cid}`);
    }
    return 0;
  }

  console.error('usage: demo | check-chain <shipment-id> | record-handoff ... | receipts [--new-key]');
  return 2;
}

main(process.argv.slice(2)).then(
  (code) => {
    process.exitCode = code;
  },
  (err) => {
    console.error(String(err?.message ?? err));
    process.exitCode = 1;
  },
);
