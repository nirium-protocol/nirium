import { createHash } from 'node:crypto';

export interface ToolCall {
  tool: string;
  input: unknown;
  output: unknown;
}

/** One logbook entry: what the agent was asked, which tools it called, what it returned. */
export interface LogbookEntry {
  version: 'agent-logbook-v1';
  taskId: string;
  startedAt: string;
  prompt: string;
  toolCalls: ToolCall[];
  output: string;
}

/** Deterministic JSON: object keys sorted at every level, no whitespace. */
export function canonicalJson(value: unknown): string {
  if (value === null || typeof value !== 'object') {
    return JSON.stringify(value);
  }
  if (Array.isArray(value)) {
    return `[${value.map(canonicalJson).join(',')}]`;
  }
  const obj = value as Record<string, unknown>;
  const keys = Object.keys(obj).filter((k) => obj[k] !== undefined).sort();
  return `{${keys.map((k) => `${JSON.stringify(k)}:${canonicalJson(obj[k])}`).join(',')}}`;
}

/** sha-256 hex of the canonical entry. This hash is the only thing that is anchored. */
export function hashEntry(entry: LogbookEntry): string {
  return createHash('sha256').update(canonicalJson(entry), 'utf8').digest('hex');
}

export function statementFor(sha256: string): string {
  return `nirium-audit-v1:${sha256}`;
}
