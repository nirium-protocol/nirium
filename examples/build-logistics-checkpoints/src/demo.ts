import { Keypair } from '@stellar/stellar-sdk';
import { verifyShipmentChain } from './chain.js';
import { recordHandoff, type Anchorer } from './checkpoint.js';
import { sha256Hex } from './record.js';
import { CheckpointStore, type CheckpointReceipt } from './store.js';

export interface DemoParty {
  id: string;
  name: string;
  location: string;
  keypair: Keypair;
}

export function createDemoParties(): DemoParty[] {
  return [
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
}

export interface DemoRunOptions {
  store: CheckpointStore;
  anchorer: Anchorer;
  tag: string;
  parties?: DemoParty[];
}

/**
 * Executes a full 4-party delivery chain and records receipts.
 */
export async function runValidShipmentDemo(
  shipmentId: string,
  options: DemoRunOptions,
): Promise<CheckpointReceipt[]> {
  const parties = options.parties ?? createDemoParties();
  const receipts: CheckpointReceipt[] = [];
  const baseTime = Date.now() - 4 * 3600 * 1000; // 4 hours ago

  let previousCid: string | null = null;

  for (let i = 0; i < parties.length; i++) {
    const party = parties[i];
    const timestamp = new Date(baseTime + i * 3600 * 1000).toISOString();
    const scanHash = sha256Hex(`BARCODE-${shipmentId}-STEP-${i}`);

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
        store: options.store,
        anchorer: options.anchorer,
        keypair: party.keypair,
        tag: options.tag,
      },
    );

    receipts.push(receipt);
    previousCid = receipt.cid;
  }

  return receipts;
}

/**
 * Demonstrates catching a broken chain with a missing handoff (index 1 missing).
 */
export async function runBrokenChainDemoMissingHandoff(
  shipmentId: string,
  options: DemoRunOptions,
): Promise<CheckpointReceipt[]> {
  const parties = options.parties ?? createDemoParties();
  const receipts: CheckpointReceipt[] = [];
  const baseTime = Date.now() - 3 * 3600 * 1000;

  // Step 0: Origin
  const r0 = await recordHandoff(
    {
      shipmentId,
      handoffIndex: 0,
      partyId: parties[0].id,
      locationLabel: parties[0].location,
      timestamp: new Date(baseTime).toISOString(),
      scanHash: sha256Hex(`SCAN-${shipmentId}-0`),
      previousHandoffCid: null,
    },
    {
      store: options.store,
      anchorer: options.anchorer,
      keypair: parties[0].keypair,
      tag: options.tag,
    },
  );
  receipts.push(r0);

  // SKIP STEP 1 (Freight Carrier missing!) -> directly Step 2 (Distribution Depot)
  const r2 = await recordHandoff(
    {
      shipmentId,
      handoffIndex: 2, // Out-of-order / missing index 1!
      partyId: parties[2].id,
      locationLabel: parties[2].location,
      timestamp: new Date(baseTime + 2 * 3600 * 1000).toISOString(),
      scanHash: sha256Hex(`SCAN-${shipmentId}-2`),
      previousHandoffCid: r0.cid, // Note: previous was 0, but index says 2
    },
    {
      store: options.store,
      anchorer: options.anchorer,
      keypair: parties[2].keypair,
      tag: options.tag,
    },
  );
  receipts.push(r2);

  return receipts;
}
