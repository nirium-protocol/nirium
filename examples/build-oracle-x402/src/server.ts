import express, { type Express } from "express";
import { x402Serve } from "nirium";

import type { ReadLatest } from "./contract.js";
import { fromFixed, SOURCE_NAME, SOURCE_URL } from "./weather.js";

export const PAID_ROUTE = "/oracle/weather/latest";

export interface ServerConfig {
  /** Public key (G...) that receives payment. */
  payTo: string;
  facilitatorApiKey: string;
  contractId: string;
  readLatest: ReadLatest;
  network?: "stellar:testnet" | "stellar:pubnet";
  facilitatorUrl?: string;
  price?: string;
}

/**
 * The paid answer is read from the contract at request time, so what a buyer
 * pays for is exactly what the chain holds, not a cached copy.
 */
export function createApp(config: ServerConfig): Express {
  const network = config.network ?? "stellar:testnet";
  const price = config.price ?? "$0.01";
  const app = express();

  app.get("/health", (_req, res) => {
    res.json({ ok: true, service: "build-oracle-x402" });
  });

  app.use(
    x402Serve({
      payTo: config.payTo,
      network,
      facilitatorApiKey: config.facilitatorApiKey,
      appName: "Nirium Oracle x402 Example",
      routes: {
        [`GET ${PAID_ROUTE}`]: {
          price,
          description: "Latest temperature written to the oracle's Soroban contract",
        },
      },
      ...(config.facilitatorUrl ? { facilitatorUrl: config.facilitatorUrl } : {}),
    }),
  );

  // Reached only after x402Serve verified and settled the payment.
  app.get(PAID_ROUTE, async (_req, res) => {
    try {
      const r = await config.readLatest();
      res.json({
        ok: true,
        network,
        contractId: config.contractId,
        value: r.value,
        celsius: fromFixed(r.value),
        timestamp: r.timestamp,
        source: { name: SOURCE_NAME, url: SOURCE_URL, license: "CC BY 4.0" },
      });
    } catch {
      res.status(503).json({ ok: false, error: "no value on chain yet" });
    }
  });

  return app;
}
