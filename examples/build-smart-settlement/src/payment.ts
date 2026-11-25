/**
 * The x402 v2 server returns the settlement in the `PAYMENT-RESPONSE` header:
 * base64-encoded JSON whose `transaction` is the Stellar transaction hash.
 */
export function readSettlementTx(response: Response): string | undefined {
  const header = response.headers.get('PAYMENT-RESPONSE') ?? response.headers.get('X-PAYMENT-RESPONSE');
  if (!header) return undefined;
  try {
    const decoded = JSON.parse(Buffer.from(header, 'base64').toString('utf8')) as unknown;
    return findTxHash(decoded);
  } catch {
    return undefined;
  }
}

function findTxHash(value: unknown): string | undefined {
  if (!value || typeof value !== 'object') return undefined;
  const record = value as Record<string, unknown>;
  for (const key of ['transaction', 'txHash', 'tx_hash', 'hash', 'transactionHash']) {
    const candidate = record[key];
    if (typeof candidate === 'string' && candidate.length > 0) return candidate;
  }
  for (const key of ['settleResponse', 'settlement', 'receipt', 'payload']) {
    const nested = findTxHash(record[key]);
    if (nested) return nested;
  }
  return undefined;
}
