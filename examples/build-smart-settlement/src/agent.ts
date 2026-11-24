import { X402PolicyError, X402SpendCapError } from 'nirium';

import { type SignedDelivery, verifyDelivery } from './delivery.js';
import { readSettlementTx } from './payment.js';

/** The shape of `agent.x402Fetch` from the Nirium SDK. */
export type PayFn = (url: string, init?: RequestInit) => Promise<Response>;

export type SettlementOutcome =
  | {
      status: 'paid';
      deliveryId: string;
      httpStatus: number;
      body: string;
      settlementTx?: string;
    }
  | {
      status: 'skipped';
      deliveryId: string;
      reason: string;
      signerCalled: false;
    }
  | {
      status: 'refused';
      deliveryId: string;
      reason: string;
      outcome?: string;
      signerCalled: false;
    };

/**
 * Verify the delivery signature first. Only a valid event is allowed to reach
 * the payer. A bad signature never calls `pay`. A policy or spend-cap refusal
 * is reported with `signerCalled: false`.
 */
export async function settleIfVerified(args: {
  signed: SignedDelivery;
  trustedPublicKey: string;
  pay: PayFn;
  url: string;
}): Promise<SettlementOutcome> {
  const deliveryId = args.signed.event.deliveryId;

  if (!verifyDelivery(args.signed, args.trustedPublicKey)) {
    return {
      status: 'skipped',
      deliveryId,
      reason: 'invalid delivery signature; payment was not attempted',
      signerCalled: false,
    };
  }

  const url = withDeliveryId(args.url, deliveryId);
  try {
    const response = await args.pay(url, { method: 'GET' });
    const body = await response.text();
    const settlementTx = readSettlementTx(response);
    if (!response.ok || !settlementTx) {
      throw new Error(
        `payment did not settle for ${deliveryId}: HTTP ${response.status}`
          + (settlementTx ? '' : ' (missing PAYMENT-RESPONSE)')
          + (body ? `: ${body.slice(0, 400)}` : ''),
      );
    }
    return {
      status: 'paid',
      deliveryId,
      httpStatus: response.status,
      body,
      settlementTx,
    };
  } catch (error) {
    if (error instanceof X402PolicyError) {
      const decisionReason = error.decision?.decision === 'DENY' ? error.decision.reason : undefined;
      return {
        status: 'refused',
        deliveryId,
        reason: decisionReason ?? error.message,
        outcome: error.outcome,
        signerCalled: false,
      };
    }
    if (error instanceof X402SpendCapError) {
      return {
        status: 'refused',
        deliveryId,
        reason: error.message,
        signerCalled: false,
      };
    }
    throw error;
  }
}

function withDeliveryId(url: string, deliveryId: string): string {
  const parsed = new URL(url);
  parsed.searchParams.set('deliveryId', deliveryId);
  return parsed.toString();
}
