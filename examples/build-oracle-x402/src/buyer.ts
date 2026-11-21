import { Agent } from "nirium";

import type { ReadLatest } from "./contract.js";

export interface PaidAnswer {
  value: number;
  timestamp: number;
  celsius: number;
  contractId: string;
}

export interface CheckResult {
  ok: boolean;
  reasons: string[];
}

/** The paid answer must equal the contract state it claims to come from. */
export function checkAgainstChain(
  paid: PaidAnswer,
  chain: { value: number; timestamp: number },
  expectedContractId: string,
): CheckResult {
  const reasons: string[] = [];
  if (paid.contractId !== expectedContractId) reasons.push("answer names a different contract");
  if (paid.value !== chain.value) reasons.push(`value ${paid.value} != on-chain ${chain.value}`);
  if (paid.timestamp !== chain.timestamp) reasons.push(`timestamp ${paid.timestamp} != on-chain ${chain.timestamp}`);
  return { ok: reasons.length === 0, reasons };
}

export function parsePaidAnswer(json: unknown): PaidAnswer {
  const j = json as Record<string, unknown> | null;
  if (
    !j ||
    typeof j.value !== "number" ||
    typeof j.timestamp !== "number" ||
    typeof j.celsius !== "number" ||
    typeof j.contractId !== "string"
  ) {
    throw new Error("unexpected paid answer shape");
  }
  return { value: j.value, timestamp: j.timestamp, celsius: j.celsius, contractId: j.contractId };
}

/** Pays the route with initX402, then verifies the answer on chain. */
export async function buy(opts: {
  url: string;
  buyerSecret: string;
  contractId: string;
  readLatest: ReadLatest;
}): Promise<{ answer: PaidAnswer; check: CheckResult }> {
  const agent = new Agent({ apiKey: "unused-x402-only" });
  agent.initX402({ secretKey: opts.buyerSecret, network: "stellar:testnet", maxAmountPerPayment: "$0.05" });
  const res = await agent.x402Fetch(opts.url);
  if (!res.ok) throw new Error(`paid request failed: HTTP ${res.status}`);
  const answer = parsePaidAnswer(await res.json());
  const check = checkAgainstChain(answer, await opts.readLatest(), opts.contractId);
  return { answer, check };
}
