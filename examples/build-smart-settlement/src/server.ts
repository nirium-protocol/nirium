import { pathToFileURL } from 'node:url';

import dotenv from 'dotenv';
import express, { type Express } from 'express';
import { x402Serve } from 'nirium';

dotenv.config({ quiet: true });

export const SETTLEMENT_ROUTE = '/paid/settle-delivery';

export interface ServerConfig {
  /** Stellar account (G...) that receives the payments. */
  payTo: string;
  facilitatorApiKey: string;
  facilitatorUrl?: string;
  /** Price of one delivery settlement, in USD. Default $0.02. */
  price?: string;
}

/** One x402-protected route: paying it records that a verified delivery was settled. */
export function createApp(config: ServerConfig): Express {
  const price = config.price ?? '$0.02';
  const app = express();

  app.get('/health', (_req, res) => {
    res.json({ ok: true, service: 'nirium-build-smart-settlement' });
  });

  app.use(
    x402Serve({
      payTo: config.payTo,
      network: 'stellar:testnet',
      facilitatorApiKey: config.facilitatorApiKey,
      ...(config.facilitatorUrl ? { facilitatorUrl: config.facilitatorUrl } : {}),
      appName: 'Nirium smart settlement example',
      routes: {
        [`GET ${SETTLEMENT_ROUTE}`]: {
          price,
          description: 'Pay the provider when a signed delivery is verified',
        },
      },
    }),
  );

  // Reached only after x402Serve verified and settled the payment.
  app.get(SETTLEMENT_ROUTE, (req, res) => {
    const deliveryId = typeof req.query.deliveryId === 'string' ? req.query.deliveryId : undefined;
    res.json({
      ok: true,
      route: 'settle-delivery',
      price,
      deliveryId,
      message: 'Payment accepted. Delivery settled.',
    });
  });

  return app;
}

function formatPrice(raw: string): string {
  return raw.startsWith('$') ? raw : `$${raw}`;
}

function main(): void {
  const payTo = process.env.SELLER_PUBLIC_KEY ?? '';
  const facilitatorApiKey = process.env.FACILITATOR_API_KEY ?? '';
  const port = Number(process.env.X402_SERVER_PORT ?? 3402);
  const price = formatPrice(process.env.X402_PRICE ?? '0.02');

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
    console.log(`  GET ${SETTLEMENT_ROUTE}  ${price}`);
  });
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  main();
}
