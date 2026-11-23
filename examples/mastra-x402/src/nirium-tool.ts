import { createTool } from '@mastra/core/tools';
import { decodePaymentResponseHeader } from '@x402/core/http';
import { z } from 'zod';
import { X402SpendCapError } from 'nirium';
import type { NiriumPayer } from './nirium-payer.ts';

export interface NiriumPayToolOptions {
    payer: NiriumPayer;
}

const refusalSchema = z.object({
    code: z.literal('X402_SPEND_CAP_EXCEEDED'),
    reason: z.string(),
    /** What the server asked for, in atomic units (7 decimals for USDC). */
    amount: z.string().optional(),
    /** The same amount, readable: "2 USDC". */
    formattedAmount: z.string().optional(),
    /** The cap that refused it: "$0.05". */
    cap: z.string().optional(),
});

const outputSchema = z.object({
    ok: z.boolean(),
    paid: z.boolean(),
    refused: z.boolean(),
    status: z.number().int(),
    url: z.string(),
    data: z.unknown().optional(),
    /** Settlement transaction hash, when the server returned a PAYMENT-RESPONSE header. */
    transaction: z.string().optional(),
    refusal: refusalSchema.optional(),
});

export type NiriumPayResult = z.infer<typeof outputSchema>;

/** The SDK error class and its `code` survive different module instances; match both. */
function isSpendCapError(error: unknown): error is X402SpendCapError {
    return error instanceof X402SpendCapError
        || (typeof error === 'object' && error !== null && (error as { code?: unknown }).code === 'X402_SPEND_CAP_EXCEEDED');
}

/**
 * Mastra tool that pays an x402 endpoint through the Nirium SDK.
 *
 * The per-payment cap lives in the payer (`createNiriumPayer`), so `x402Fetch`
 * refuses an over-cap payment before anything is signed. This tool turns that
 * refusal into a normal result the agent can report, instead of an exception
 * that ends the run. Every other failure is rethrown and handled by Mastra.
 */
export function createNiriumPayTool({ payer }: NiriumPayToolOptions) {
    return createTool({
        id: 'pay_x402_endpoint',
        description: `Fetch a URL that answers 402 Payment Required by paying it in USDC on Stellar ${payer.network} `
            + `through the Nirium SDK. The payment is capped at ${payer.cap} per request and is refused before `
            + 'signing when the server asks for more; the result then says refused with the amount and the cap. '
            + 'Returns the paid response body and the settlement transaction hash.',
        inputSchema: z.object({
            url: z.string().url().describe('The x402-protected URL to pay for.'),
            method: z.enum(['GET', 'POST']).optional().describe('HTTP method. Defaults to GET.'),
        }),
        outputSchema,
        execute: async ({ url, method }): Promise<NiriumPayResult> => {
            let response: Response;
            try {
                response = await payer.x402Fetch(url, method ? { method } : undefined);
            } catch (error) {
                if (!isSpendCapError(error)) throw error;
                return {
                    ok: false,
                    paid: false,
                    refused: true,
                    status: 402,
                    url,
                    refusal: {
                        code: 'X402_SPEND_CAP_EXCEEDED',
                        reason: error.message,
                        amount: error.amount,
                        formattedAmount: error.formattedAmount,
                        cap: error.cap ?? payer.cap,
                    },
                };
            }

            const settlement = readSettlement(response);
            return {
                ok: response.ok,
                paid: settlement !== undefined && settlement.success !== false,
                refused: false,
                status: response.status,
                url,
                data: await readBody(response),
                transaction: settlement?.transaction,
            };
        },
    });
}

interface Settlement {
    success?: boolean;
    transaction?: string;
}

function readSettlement(response: Response): Settlement | undefined {
    const header = response.headers.get('payment-response');
    if (!header) return undefined;
    try {
        return decodePaymentResponseHeader(header) as Settlement;
    } catch {
        return undefined;
    }
}

async function readBody(response: Response): Promise<unknown> {
    const text = await response.text();
    if (!text) return undefined;
    try {
        return JSON.parse(text);
    } catch {
        return text;
    }
}
