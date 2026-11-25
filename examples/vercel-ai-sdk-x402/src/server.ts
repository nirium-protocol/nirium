import { pathToFileURL } from 'node:url';

import dotenv from 'dotenv';
import express, { type Express } from 'express';
import { x402Serve } from 'nirium';

dotenv.config({ quiet: true });

export const CHEAP_ROUTE = '/paid/market-summary';
export const EXPENSIVE_ROUTE = '/paid/full-report';

export interface ServerConfig {
  /** Stellar account (G...) that receives the payments. */
  payTo: string;
  facilitatorApiKey: string;
  facilitatorUrl?: string;
  /** Price of the cheap route, below the agent's $1 cap. */
  price?: string;
}

/**
 * Two paid routes on one seller: one below the agent's cap and one above it,
 * so a single run shows both the paid call and the pre-sign refusal.
 */
export function createApp(config: ServerConfig): Express {
  const price = config.price ?? '$0.02';
  const app = express();

  app.get('/health', (_req, res) => {
    res.json({ ok: true, service: 'nirium-vercel-ai-sdk-x402' });
  });

  app.use(
    x402Serve({
      payTo: config.payTo,
      network: 'stellar:testnet',
      facilitatorApiKey: config.facilitatorApiKey,
      ...(config.facilitatorUrl ? { facilitatorUrl: config.facilitatorUrl } : {}),
      appName: 'Nirium Vercel AI SDK x402 example',
      routes: {
        [`GET ${CHEAP_ROUTE}`]: {
          price,
          description: "Market summary (below the agent's $1 cap)",
        },
        [`GET ${EXPENSIVE_ROUTE}`]: {
          price: '$2',
          description: "Full report (above the agent's $1 cap)",
        },
      },
    }),
  );

  // Reached only after x402Serve verified and settled the payment.
  app.get(CHEAP_ROUTE, (_req, res) => {
    res.json({
      ok: true,
      route: 'market-summary',
      price,
      note: 'Demo data from your own x402Serve route.',
      signals: [{ pair: 'XLM/USDC', confidence: 0.82 }],
    });
  });

  app.get(EXPENSIVE_ROUTE, (_req, res) => {
    res.json({ ok: true, route: 'full-report', price: '$2' });
  });

  return app;
}

function main(): void {
  const payTo = process.env.SELLER_PUBLIC_KEY ?? '';
  const facilitatorApiKey = process.env.FACILITATOR_API_KEY ?? '';
  const port = Number(process.env.X402_SERVER_PORT ?? 3402);
  const rawPrice = process.env.X402_PRICE ?? '0.02';
  const price = rawPrice.startsWith('$') ? rawPrice : `$${rawPrice}`;

  if (!/^G[A-Z2-7]{55}$/.test(payTo)) {
    console.error('SELLER_PUBLIC_KEY must be a testnet public key (G...) that you own. It receives the payments.');
    process.exit(1);
  }
  if (!facilitatorApiKey) {
    console.error('FACILITATOR_API_KEY is missing. A free testnet key: https://channels.openzeppelin.com/testnet/gen');
    process.exit(1);
  }

  const app = createApp({
    payTo,
    facilitatorApiKey,
    ...(process.env.FACILITATOR_URL ? { facilitatorUrl: process.env.FACILITATOR_URL } : {}),
    price,
  });

  app.listen(port, () => {
    console.log(`x402Serve on http://localhost:${port} (stellar:testnet), payTo ${payTo}`);
    console.log(`  GET ${CHEAP_ROUTE}  ${price}`);
    console.log(`  GET ${EXPENSIVE_ROUTE}     $2`);
  });
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  main();
}
