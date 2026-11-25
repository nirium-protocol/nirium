import { Horizon, Keypair, Networks, Operation, TransactionBuilder } from '@stellar/stellar-sdk';
import { verifyShipmentChain } from './chain.js';
import { niriumAnchorer, recordHandoff } from './checkpoint.js';
import { sha256Hex } from './record.js';
import { CheckpointStore, type CheckpointReceipt } from './store.js';

const HORIZON_URL = 'https://horizon-testnet.stellar.org';
const server = new Horizon.Server(HORIZON_URL);
const TAG = 'wave11-logistics-checkpoints';

async function fundWithFriendbot(publicKey: string): Promise<void> {
  console.log(`Funding ${publicKey} via Friendbot...`);
  const res = await fetch(`https://friendbot.stellar.org?addr=${encodeURIComponent(publicKey)}`);
  if (!res.ok) {
    const text = await res.text();
    throw new Error(`Friendbot failed for ${publicKey} (${res.status}): ${text}`);
  }
}

async function submitTestnetCheckpointTx(
  keypair: Keypair,
  shipmentId: string,
  index: number,
  scanHash: string,
): Promise<string> {
  const account = await server.loadAccount(keypair.publicKey());
  const tx = new TransactionBuilder(account, {
    fee: '10000',
    networkPassphrase: Networks.TESTNET,
  })
    .addOperation(
      Operation.manageData({
        name: `chk_${index}`.slice(0, 64),
        value: scanHash.slice(0, 64),
      }),
    )
    .setTimeout(60)
    .build();

  tx.sign(keypair);
  const resp = await server.submitTransaction(tx);
  return resp.hash;
}

async function main() {
  console.log('=== GENERATING TESTNET EVIDENCE FOR NIRIUM LOGISTICS CHECKPOINTS ===\n');

  const parties = [
    {
      id: 'origin-manufacturer',
      name: 'Austin Electronics Fab',
      location: 'Austin, TX Facility (Bay 4)',
      keypair: Keypair.random(),
    },
    {
      id: 'freight-carrier',
      name: 'Midwest Intermodal Carrier',
      location: 'Chicago Hub (Dock 12)',
      keypair: Keypair.random(),
    },
    {
      id: 'distribution-depot',
      name: 'Coastal Distribution Center',
      location: 'Newark Logistics Park (Bldg C)',
      keypair: Keypair.random(),
    },
    {
      id: 'destination-retailer',
      name: 'Metro Flagship Store #42',
      location: 'Brooklyn, NY Storefront',
      keypair: Keypair.random(),
    },
  ];

  // 1. Fund all parties via Friendbot
  for (const p of parties) {
    await fundWithFriendbot(p.keypair.publicKey());
  }
  console.log('All 4 party keypairs funded successfully on testnet!\n');

  const store = new CheckpointStore('.checkpoints');
  const anchorer = niriumAnchorer('https://nirium-agent.fly.dev');
  const shipmentId = `SHP-LIVE-${Date.now().toString().slice(-4)}`;
  const receipts: CheckpointReceipt[] = [];
  const txHashes: string[] = [];

  let previousCid: string | null = null;
  const baseTime = Date.now() - 4 * 3600 * 1000;

  for (let i = 0; i < parties.length; i++) {
    const party = parties[i];
    const timestamp = new Date(baseTime + i * 3600 * 1000).toISOString();
    const scanHash = sha256Hex(`SCAN-${shipmentId}-STEP-${i}`);

    console.log(`Submitting on-chain Stellar testnet transaction for [${party.id}]...`);
    const txHash = await submitTestnetCheckpointTx(party.keypair, shipmentId, i, scanHash);
    txHashes.push(txHash);
    console.log(`-> Tx: ${txHash}`);
    console.log(`-> Explorer: https://stellar.expert/explorer/testnet/tx/${txHash}`);

    console.log(`Anchoring handoff ${i} to Nirium Audit Trail...`);
    const receipt = await recordHandoff(
      {
        shipmentId,
        handoffIndex: i,
        partyId: party.id,
        locationLabel: party.location,
        timestamp,
        scanHash,
        previousHandoffCid: previousCid,
      },
      {
        store,
        anchorer,
        keypair: party.keypair,
        tag: TAG,
      },
    );

    receipts.push(receipt);
    previousCid = receipt.cid;
    console.log(`-> CID: ${receipt.cid}\n`);
  }

  console.log(`\nVerifying live shipment chain for ${shipmentId}...`);
  const verifyResult = await verifyShipmentChain(shipmentId, store);
  console.log(`Verification Status: ${verifyResult.valid ? 'PASSED (ALL VERIFIED)' : 'FAILED'}`);

  console.log('\n================ EVIDENCE SUMMARY ================');
  console.log(`Shipment ID: ${shipmentId}\n`);
  console.log('| Step | Party | Public Key | Transaction Hash | Stellar Expert Link | Nirium CID |');
  console.log('|---|---|---|---|---|---|');
  for (let i = 0; i < parties.length; i++) {
    const p = parties[i];
    const tx = txHashes[i];
    const cid = receipts[i].cid;
    console.log(
      `| Handoff ${i} | ${p.id} | \`${p.keypair.publicKey()}\` | \`${tx}\` | https://stellar.expert/explorer/testnet/tx/${tx} | \`${cid}\` |`,
    );
  }
}

main().catch((err) => {
  console.error('Error generating evidence:', err);
  process.exit(1);
});
