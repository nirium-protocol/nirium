import { promises as fs } from "node:fs";
import * as path from "node:path";

/**
 * Persistent cursor for the Soroban event watcher.
 *
 * Stores the last processed event id (and the set of event ids already
 * anchored for the current ledger window) on disk so that restarting the
 * watcher never anchors the same event twice.
 *
 * The file is written atomically (write to a temp file, then rename) so a
 * crash mid-write cannot leave a corrupted cursor behind.
 */

export interface CursorState {
  /** Contract ID being watched (C...). */
  contractId: string;
  /** Stellar RPC event pagination cursor to resume from, if any. */
  pagingToken: string | null;
  /** Highest ledger sequence whose events have been fully anchored. */
  lastLedger: number;
  /** Event ids anchored within `lastLedger` (guards against re-anchoring on resume). */
  anchoredIdsInLastLedger: string[];
}

export function emptyCursor(contractId: string): CursorState {
  return {
    contractId,
    pagingToken: null,
    lastLedger: 0,
    anchoredIdsInLastLedger: [],
  };
}

export class CursorStore {
  constructor(private readonly filePath: string) {}

  async load(contractId: string): Promise<CursorState> {
    let raw: string;
    try {
      raw = await fs.readFile(this.filePath, "utf8");
    } catch (err) {
      if ((err as NodeJS.ErrnoException).code === "ENOENT") {
        return emptyCursor(contractId);
      }
      throw err;
    }

    const parsed = JSON.parse(raw) as Partial<CursorState>;
    if (parsed.contractId !== contractId) {
      // A cursor for a different contract must never be reused.
      return emptyCursor(contractId);
    }
    return {
      contractId,
      pagingToken: parsed.pagingToken ?? null,
      lastLedger: parsed.lastLedger ?? 0,
      anchoredIdsInLastLedger: parsed.anchoredIdsInLastLedger ?? [],
    };
  }

  async save(state: CursorState): Promise<void> {
    await fs.mkdir(path.dirname(this.filePath), { recursive: true });
    const tmp = `${this.filePath}.tmp`;
    await fs.writeFile(tmp, JSON.stringify(state, null, 2), "utf8");
    await fs.rename(tmp, this.filePath);
  }
}

/**
 * Returns true if the event has already been anchored according to the cursor.
 * An event is considered anchored if its ledger is before the cursor's ledger,
 * or it is in the cursor's ledger and its id was recorded as anchored.
 */
export function isAlreadyAnchored(
  state: CursorState,
  eventId: string,
  eventLedger: number,
): boolean {
  if (eventLedger < state.lastLedger) return true;
  if (eventLedger === state.lastLedger) {
    return state.anchoredIdsInLastLedger.includes(eventId);
  }
  return false;
}

/** Advances the cursor after an event has been successfully anchored. */
export function recordAnchored(
  state: CursorState,
  eventId: string,
  eventLedger: number,
  pagingToken: string,
): CursorState {
  if (eventLedger > state.lastLedger) {
    return {
      ...state,
      pagingToken,
      lastLedger: eventLedger,
      anchoredIdsInLastLedger: [eventId],
    };
  }
  return {
    ...state,
    pagingToken,
    anchoredIdsInLastLedger: [...state.anchoredIdsInLastLedger, eventId],
  };
}
