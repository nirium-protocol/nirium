const TX_HASH_PATTERN = /^[0-9a-f]{64}$/i;

function findTransactionHash(value: unknown): string | undefined {
  if (!value || typeof value !== "object") return undefined;
  const object = value as Record<string, unknown>;
  for (const key of ["transaction", "txHash", "tx_hash", "hash", "transactionHash"]) {
    const candidate = object[key];
    if (typeof candidate === "string" && TX_HASH_PATTERN.test(candidate)) return candidate;
    const nested = findTransactionHash(candidate);
    if (nested) return nested;
  }
  for (const key of ["settleResponse", "settlement", "receipt", "payload"]) {
    const nested = findTransactionHash(object[key]);
    if (nested) return nested;
  }
  return undefined;
}

export function settlementTransactionHash(response: Response): string {
  const header = response.headers.get("PAYMENT-RESPONSE");
  if (!header) throw new Error("Paid response has no PAYMENT-RESPONSE settlement header");

  const candidates = [header, Buffer.from(header, "base64").toString("utf8")];
  for (const candidate of candidates) {
    try {
      const hash = findTransactionHash(JSON.parse(candidate));
      if (hash) return hash;
    } catch {
      // Try the other documented header encoding before reporting malformed evidence.
    }
  }
  throw new Error("PAYMENT-RESPONSE did not contain a Stellar transaction hash");
}
