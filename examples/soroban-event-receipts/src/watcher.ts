import { rpc, scValToNative, xdr } from "@stellar/stellar-sdk";
import { createHash } from "node:crypto";
import { readFile, writeFile, rename } from "node:fs/promises";
import { existsSync } from "node:fs";

/**
 * Soroban event watcher that selects events from a testnet contract and
 * produces one signed receipt per event. Restarting the watcher never anchors
 * the same event twice: processed event IDs are persisted in a cursor file
 * before the cursor advances, and each receipt is keyed by its event ID.
 */

export interface WatcherConfig {
  rpcUrl: string;
  networkPassphrase: string;
  contractId: string;
  /** Path to the JSON state file holding the paging cursor and anchored IDs. */
  statePath: string;
  /** Optional filter: only events whose first topic (decoded) equals this value. */
  topicFilter?: string;
  pollIntervalMs?: number;
  pageLimit?: number;
}

export interface WatcherState {
  /** Last ledger fully processed; the next poll starts after it. */
  cursorLedger: number;
  /** Event IDs already anchored. Prevents double anchoring across restarts. */
  anchoredEventIds: string[];
}

export interface EventReceipt {
  version: 1;
  network: "stellar:testnet";
  contractId: string;
  eventId: string;
  ledger: number;
  ledgerClosedAt: string;
  txHash: string;
  /** SHA-256 over the canonical XDR of the event data and topics. */
  eventDataHash: string;
  /**
   * Off-chain document this event refers to, identified by content hash.
   * The ledger event only carries the hash of the data; the receipt binds the
   * event to the specific document bytes the watcher resolved for it.
   */
  offchainDocument: { uri: string; sha256: string } | null;
  issuedAt: string;
}

/** Signs a serialized receipt. Implementations hold the key; the watcher never sees it. */
export interface ReceiptSigner {
  publicKey: string;
  sign(payload: Uint8Array): Promise<Uint8Array>;
}

/** Anchors a signed receipt and returns a content identifier (CID). */
export interface ReceiptAnchor {
  anchor(signedReceipt: string): Promise<string>;
}

/** Resolves the off-chain document referenced by an event, if any. */
export type DocumentResolver = (
  event: rpc.Api.EventResponse,
) => Promise<{ uri: string; bytes: Uint8Array } | null>;

export function sha256Hex(data: Uint8Array | string): string {
  return createHash("sha256").update(data).digest("hex");
}

export function canonicalEventDataHash(event: rpc.Api.EventResponse): string {
  const topics = event.topic.map((t) => t.toXDR("base64")).join("|");
  const value = event.value.toXDR("base64");
  return sha256Hex(`${topics}#${value}`);
}

export async function loadState(path: string): Promise<WatcherState> {
  if (!existsSync(path)) {
    return { cursorLedger: 0, anchoredEventIds: [] };
  }
  const raw = JSON.parse(await readFile(path, "utf8")) as WatcherState;
  return { cursorLedger: raw.cursorLedger, anchoredEventIds: raw.anchoredEventIds ?? [] };
}

/** Writes state atomically (temp file + rename) so a crash never leaves a torn file. */
export async function saveState(path: string, state: WatcherState): Promise<void> {
  const tmp = `${path}.tmp`;
  await writeFile(tmp, JSON.stringify(state, null, 2), "utf8");
  await rename(tmp, path);
}

function decodeFirstTopic(event: rpc.Api.EventResponse): string | null {
  if (event.topic.length === 0) return null;
  try {
    const native = scValToNative(event.topic[0]);
    return typeof native === "string" ? native : String(native);
  } catch {
    return null;
  }
}

export function selectEvent(
  event: rpc.Api.EventResponse,
  contractId: string,
  topicFilter?: string,
): boolean {
  if (event.type !== "contract") return false;
  if (event.contractId?.toString() !== contractId) return false;
  if (topicFilter !== undefined && decodeFirstTopic(event) !== topicFilter) return false;
  return true;
}

export function buildReceipt(
  event: rpc.Api.EventResponse,
  contractId: string,
  offchainDocument: { uri: string; sha256: string } | null,
  now: Date = new Date(),
): EventReceipt {
  return {
    version: 1,
    network: "stellar:testnet",
    contractId,
    eventId: event.id,
    ledger: event.ledger,
    ledgerClosedAt: event.ledgerClosedAt,
    txHash: event.txHash,
    eventDataHash: canonicalEventDataHash(event),
    offchainDocument,
    issuedAt: now.toISOString(),
  };
}

export async function signReceipt(
  receipt: EventReceipt,
  signer: ReceiptSigner,
): Promise<string> {
  const body = JSON.stringify(receipt, Object.keys(receipt).sort());
  const sig = await signer.sign(new TextEncoder().encode(body));
  return JSON.stringify({
    receipt,
    signature: Buffer.from(sig).toString("base64"),
    signer: signer.publicKey,
  });
}

/**
 * Processes one batch of events. Returns the number of receipts anchored.
 * Ordering guarantee: a receipt is anchored, then its event ID is recorded and
 * state is saved before the next event is handled, so a crash between steps
 * causes at most a re-check, and the anchoredEventIds check prevents re-anchoring.
 */
export async function processEvents(
  events: rpc.Api.EventResponse[],
  state: WatcherState,
  deps: {
    config: WatcherConfig;
    signer: ReceiptSigner;
    anchor: ReceiptAnchor;
    resolveDocument: DocumentResolver;
    now?: () => Date;
  },
): Promise<number> {
  const seen = new Set(state.anchoredEventIds);
  let anchored = 0;
  for (const event of events) {
    if (!selectEvent(event, deps.config.contractId, deps.config.topicFilter)) continue;
    if (seen.has(event.id)) continue;

    const doc = await deps.resolveDocument(event);
    const offchainDocument = doc
      ? { uri: doc.uri, sha256: sha256Hex(doc.bytes) }
      : null;
    const receipt = buildReceipt(
      event,
      deps.config.contractId,
      offchainDocument,
      deps.now?.() ?? new Date(),
    );
    const signed = await signReceipt(receipt, deps.signer);
    await deps.anchor.anchor(signed);

    seen.add(event.id);
    state.anchoredEventIds.push(event.id);
    await saveState(deps.config.statePath, state);
    anchored++;
  }
  return anchored;
}

export async function runWatcher(
  config: WatcherConfig,
  deps: {
    signer: ReceiptSigner;
    anchor: ReceiptAnchor;
    resolveDocument: DocumentResolver;
    signal?: AbortSignal;
  },
): Promise<void> {
  const server = new rpc.Server(config.rpcUrl);
  const state = await loadState(config.statePath);
  const interval = config.pollIntervalMs ?? 5000;
  const limit = config.pageLimit ?? 100;

  while (!deps.signal?.aborted) {
    const latest = await server.getLatestLedger();
    const startLedger = state.cursorLedger > 0 ? state.cursorLedger + 1 : latest.sequence;
    if (startLedger <= latest.sequence) {
      const res = await server.getEvents({
        startLedger,
        filters: [{ type: "contract", contractIds: [config.contractId] }],
        limit,
      });
      await processEvents(res.events, state, { config, ...deps });
      const highest = res.events.reduce((m, e) => Math.max(m, e.ledger), 0);
      // Advance cursor to the latest fully scanned ledger, not beyond it.
      state.cursorLedger = Math.max(state.cursorLedger, highest, latest.sequence);
      await saveState(config.statePath, state);
    }
    await new Promise((r) => setTimeout(r, interval));
  }
}
