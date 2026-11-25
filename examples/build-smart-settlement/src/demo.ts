import { pathToFileURL } from 'node:url';
import type { AddressInfo } from 'node:net';

import dotenv from 'dotenv';
import { Agent } from 'nirium';

import { settleIfVerified, type SettlementOutcome } from './agent.js';
import { createDeliveryKeys, simulateDelivery, withBadSignature } from './delivery.js';
import { DAILY_CAP_ATOMIC, PRICE_ATOMIC } from './constants.js';
import { DailyBudgetPolicy } from './policy/daily-budget-policy.js';
import { createApp, SETTLEMENT_ROUTE } from './server.js';

dotenv.config({ quiet: true });

function formatPrice(raw: string): string {
  return raw.startsWith('$') ? raw : `$${raw}`;
}

function paidUrl(base: string, deliveryId?: string): string {
  const url = new URL(SETTLEMENT_ROUTE, base);
  if (deliveryId) url.searchParams.set('deliveryId', deliveryId);
  return url.toString();
}

export interface DemoConfig {
  secretKey: string;
  payTo: string;
  facilitatorApiKey: string;
  facilitatorUrl?: string;
  price?: string;
  port?: number;
}

export async function runDemo(config: DemoConfig): Promise<SettlementOutcome[]> {
  const price = formatPrice(config.price ?? '0.02');
  const app = createApp({
    payTo: config.payTo,
    facilitatorApiKey: config.facilitatorApiKey,
    ...(config.facilitatorUrl ? { facilitatorUrl: config.facilitatorUrl } : {}),
    price,
  });

  const server = app.listen(config.port ?? 0);
  await new Promise<void>((resolve) => server.once('listening', resolve));
  const address = server.address() as AddressInfo;
  const base = `http://127.0.0.1:${address.port}`;
  const endpoint = paidUrl(base);

  const keys = createDeliveryKeys();
  const budget = new DailyBudgetPolicy({ dailyCap: DAILY_CAP_ATOMIC });

  const agent = new Agent({ apiKey: 'unused-x402-only' });
  agent.initX402({
    secretKey: config.secretKey,
    network: 'stellar:testnet',
    policy: budget.hook(),
  });

  const pay = (url: string, init?: RequestInit) => agent.x402Fetch(url, init);
  const outcomes: SettlementOutcome[] = [];

  try {
    console.log(`seller on ${base}${SETTLEMENT_ROUTE}  ${price}  payTo ${config.payTo}`);
    console.log(`daily budget: ${DAILY_CAP_ATOMIC} atomic units (3 × ${PRICE_ATOMIC})`);
    console.log(`delivery public key: ${keys.publicKey}`);
    console.log('');

    // 1–3: valid deliveries are paid.
    for (const index of [1, 2, 3]) {
      const signed = simulateDelivery(keys, index);
      const outcome = await settleIfVerified({
        signed,
        trustedPublicKey: keys.publicKey,
        pay,
        url: endpoint,
      });
      outcomes.push(outcome);
      logOutcome(index, outcome);
    }

    // 4: a delivery with a bad signature is not paid.
    const valid = simulateDelivery(keys, 4);
    const bad = withBadSignature(valid);
    const skipped = await settleIfVerified({
      signed: bad,
      trustedPublicKey: keys.publicKey,
      pay,
      url: endpoint,
    });
    outcomes.push(skipped);
    logOutcome(4, skipped);

    // 5: a valid delivery is refused by the budget policy, with no signature.
    const fifth = simulateDelivery(keys, 5);
    const refused = await settleIfVerified({
      signed: fifth,
      trustedPublicKey: keys.publicKey,
      pay,
      url: endpoint,
    });
    outcomes.push(refused);
    logOutcome(5, refused);

    printSummary(outcomes);
    return outcomes;
  } finally {
    await new Promise<void>((resolve, reject) => {
      server.close((err) => (err ? reject(err) : resolve()));
    });
  }
}

function logOutcome(step: number, outcome: SettlementOutcome): void {
  if (outcome.status === 'paid') {
    console.log(
      `step ${step} PAID  delivery=${outcome.deliveryId}  http=${outcome.httpStatus}`
        + (outcome.settlementTx ? `  tx=${outcome.settlementTx}` : '  tx=(missing PAYMENT-RESPONSE)'),
    );
    return;
  }
  if (outcome.status === 'skipped') {
    console.log(`step ${step} SKIPPED  delivery=${outcome.deliveryId}  ${outcome.reason}`);
    return;
  }
  console.log(
    `step ${step} REFUSED  delivery=${outcome.deliveryId}`
      + (outcome.outcome ? `  outcome=${outcome.outcome}` : '')
      + `  signerCalled=${outcome.signerCalled}`
      + `\n  ${outcome.reason}`,
  );
}

function printSummary(outcomes: SettlementOutcome[]): void {
  const paid = outcomes.filter((o) => o.status === 'paid');
  const skipped = outcomes.filter((o) => o.status === 'skipped');
  const refused = outcomes.filter((o) => o.status === 'refused');

  console.log('\n--- summary ---');
  for (const [i, outcome] of paid.entries()) {
    console.log(
      `paid ${i + 1}: ${outcome.deliveryId}`
        + (outcome.settlementTx
          ? `  https://stellar.expert/explorer/testnet/tx/${outcome.settlementTx}`
          : '  (no settlement hash in the response)'),
    );
  }
  for (const outcome of skipped) {
    console.log(`skipped: ${outcome.deliveryId}  ${outcome.reason}`);
  }
  for (const outcome of refused) {
    console.log('refusal output:');
    console.log(
      JSON.stringify(
        {
          status: outcome.status,
          deliveryId: outcome.deliveryId,
          outcome: outcome.outcome,
          reason: outcome.reason,
          signerCalled: outcome.signerCalled,
        },
        null,
        2,
      ),
    );
  }
}

function assertExpectedFlow(outcomes: SettlementOutcome[]): void {
  if (outcomes.length !== 5) {
    throw new Error(`expected 5 outcomes, got ${outcomes.length}`);
  }
  const [a, b, c, d, e] = outcomes;
  if (a.status !== 'paid' || b.status !== 'paid' || c.status !== 'paid') {
    throw new Error('steps 1–3 must be paid deliveries');
  }
  if (d.status !== 'skipped') {
    throw new Error(`step 4 must be skipped (bad signature), got ${d.status}`);
  }
  if (e.status !== 'refused' || e.signerCalled !== false) {
    throw new Error(`step 5 must be a budget refusal with no signature, got ${JSON.stringify(e)}`);
  }
}

async function main(): Promise<void> {
  const secretKey = process.env.STELLAR_SECRET_KEY ?? '';
  const payTo = process.env.SELLER_PUBLIC_KEY ?? '';
  const facilitatorApiKey = process.env.FACILITATOR_API_KEY ?? '';

  if (!secretKey) {
    console.error('STELLAR_SECRET_KEY is missing. Copy .env.example to .env and use your own testnet key.');
    process.exit(1);
  }
  if (!/^G[A-Z2-7]{55}$/.test(payTo)) {
    console.error('SELLER_PUBLIC_KEY must be a testnet public key (G...) that you own. It receives the payments.');
    process.exit(1);
  }
  if (!facilitatorApiKey) {
    console.error('FACILITATOR_API_KEY is missing. A free testnet key: https://channels.openzeppelin.com/testnet/gen');
    process.exit(1);
  }

  const port = process.env.X402_SERVER_PORT ? Number(process.env.X402_SERVER_PORT) : 0;
  const outcomes = await runDemo({
    secretKey,
    payTo,
    facilitatorApiKey,
    ...(process.env.FACILITATOR_URL ? { facilitatorUrl: process.env.FACILITATOR_URL } : {}),
    price: process.env.X402_PRICE,
    port,
  });
  assertExpectedFlow(outcomes);
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  main().catch((error) => {
    console.error(error instanceof Error ? error.message : error);
    process.exit(1);
  });
}
