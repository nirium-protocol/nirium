import { tool } from 'ai';
import { X402SpendCapError } from 'nirium';
import { z } from 'zod';

/** The shape of `agent.x402Fetch` from the Nirium SDK. */
export type X402Fetch = (url: string, init?: RequestInit) => Promise<Response>;

export interface X402ToolOptions {
  x402Fetch: X402Fetch;
  /**
   * The cap configured in `initX402({ maxAmountPerPayment })`. Only used to
   * word the refusal; the SDK enforces the cap before the signer is reached.
   */
  maxAmountPerPayment?: string;
}

export interface PaidFetchResult {
  ok: boolean;
  url: string;
  status?: number;
  body?: string;
  bodyTruncated?: boolean;
  settlementTx?: string;
  refused?: boolean;
  reason?: string;
  requestedAmount?: string;
  cap?: string;
  signerCalled?: boolean;
}

const MAX_BODY_CHARS = 4_000;

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

/**
 * A refusal the model can act on: what the server asked for, which cap
 * refused it, and the fact that nothing was signed.
 */
export function spendCapReason(error: X402SpendCapError, maxAmountPerPayment: string): string {
  const asked = error.formattedAmount
    ? `${error.formattedAmount}${error.amount ? ` (${error.amount} atomic units)` : ''}`
    : error.amount
      ? `${error.amount} atomic units${error.asset ? ` of ${error.asset}` : ''}`
      : 'more than the per-payment cap';
  const cap = error.cap ?? maxAmountPerPayment;
  return (
    `Payment refused before signing: ${error.url} asked for ${asked}, above the ${cap} per-payment cap. `
    + 'Nothing was signed and nothing was sent. If this payment is intended, the operator must raise '
    + `the cap with initX402({ maxAmountPerPayment: ... }).`
  );
}

function isSpendCapError(error: unknown): error is X402SpendCapError {
  return error instanceof X402SpendCapError
    || (typeof error === 'object' && error !== null && (error as { code?: string }).code === 'X402_SPEND_CAP_EXCEEDED');
}

export function createX402PaidFetchTool({ x402Fetch, maxAmountPerPayment = '$1' }: X402ToolOptions) {
  return tool({
    description:
      'Fetch an HTTP endpoint that may charge an x402 payment in USDC on Stellar testnet. '
      + 'The payment is signed locally and refused before signing when it is above the configured spend cap. '
      + 'Returns the response body, the settlement transaction hash, or a readable refusal reason.',
    inputSchema: z.object({
      url: z.url().describe('Absolute URL of the x402-protected resource.'),
      method: z.enum(['GET', 'POST']).default('GET').describe('HTTP method to use.'),
    }),
    execute: async ({ url, method }): Promise<PaidFetchResult> => {
      try {
        const response = await x402Fetch(url, { method });
        const text = await response.text();
        return {
          ok: response.ok,
          url,
          status: response.status,
          body: text.length > MAX_BODY_CHARS ? text.slice(0, MAX_BODY_CHARS) : text,
          bodyTruncated: text.length > MAX_BODY_CHARS || undefined,
          settlementTx: readSettlementTx(response),
        };
      } catch (error) {
        if (isSpendCapError(error)) {
          return {
            ok: false,
            refused: true,
            url,
            reason: spendCapReason(error, maxAmountPerPayment),
            requestedAmount: error.formattedAmount ?? error.amount,
            cap: error.cap ?? maxAmountPerPayment,
            signerCalled: false,
          };
        }
        return {
          ok: false,
          refused: false,
          url,
          reason: `The paid request failed before a response: ${error instanceof Error ? error.message : String(error)}`,
        };
      }
    },
  });
}
