import "dotenv/config";

import { Keypair } from "@stellar/stellar-sdk";
import express, { type Express } from "express";
import { Agent, X402PolicyError, x402Serve } from "nirium";
import type { Server } from "node:http";

import { DailyBudgetPolicy } from "./daily-budget.js";
import {
  DAILY_BUDGET,
  MAX_PAYMENT,
  offersForRound,
  cheapestOffer,
  PRODUCER_DEFAULTS,
  ROUND_COUNT,
  type EnergyOffer,
  type ProducerConfig,
} from "./market-model.js";
import { settlementTransactionHash } from "./payment-response.js";

function requiredEnv(name: string): string {
  const value = process.env[name]?.trim();
  if (!value) throw new Error(`Missing ${name}. Copy .env.example to .env and fill it in.`);
  return value;
}

function createProducerApp(producer: ProducerConfig, payTo: string, facilitatorApiKey: string): Express {
  const app = express();
  const routes = Object.fromEntries(
    producer.prices.map((price, index) => [
      `GET /energy/round-${index + 1}`,
      { price, description: `${producer.name}: one kWh allocation, round ${index + 1}` },
    ]),
  );

  app.use(
    x402Serve({
      payTo,
      network: "stellar:testnet",
      facilitatorApiKey,
      appName: `${producer.name} x402 producer`,
      routes,
    }),
  );

  app.get("/energy/round-:round", (req, res) => {
    const round = Number(req.params.round);
    const price = producer.prices[round - 1];
    if (!Number.isInteger(round) || !price) {
      res.status(404).json({ error: "unknown market round" });
      return;
    }
    res.json({
      producerId: producer.id,
      producerName: producer.name,
      round,
      allocationKwh: 1,
      price,
      payTo,
      network: "stellar:testnet",
    });
  });

  return app;
}

async function listen(app: Express, port: number): Promise<Server> {
  return new Promise((resolve, reject) => {
    const server = app.listen(port, "127.0.0.1", () => resolve(server));
    server.once("error", reject);
  });
}

function close(server: Server): Promise<void> {
  return new Promise((resolve, reject) => {
    server.close((error) => (error ? reject(error) : resolve()));
  });
}

function loadProducers(): ProducerConfig[] {
  return PRODUCER_DEFAULTS.map((defaults) => ({
    id: defaults.id,
    name: defaults.name,
    port: Number(process.env[`${defaults.envName.replace("_SECRET", "_PORT")}`] ?? defaults.port),
    secret: requiredEnv(defaults.envName),
    prices: defaults.prices,
  }));
}

function parsePaidOffer(value: unknown, offer: EnergyOffer): void {
  if (!value || typeof value !== "object") throw new Error("Producer returned an invalid energy allocation");
  const answer = value as Record<string, unknown>;
  if (
    answer.producerId !== offer.producerId ||
    answer.round !== offer.round ||
    answer.price !== offer.price ||
    answer.allocationKwh !== 1
  ) {
    throw new Error(`Paid allocation from ${offer.producerId} did not match its advertised offer`);
  }
}

async function buyOffer(agent: Agent, offer: EnergyOffer): Promise<string> {
  const response = await agent.x402Fetch(`${offer.baseUrl}${offer.route}`);
  if (!response.ok) throw new Error(`Payment request failed with HTTP ${response.status}`);
  parsePaidOffer(await response.json(), offer);
  return settlementTransactionHash(response);
}

export async function runMarket(): Promise<void> {
  const facilitatorApiKey = requiredEnv("FACILITATOR_API_KEY");
  const producers = loadProducers();
  const storageSecret = requiredEnv("STORAGE_SECRET");
  const storageAddress = Keypair.fromSecret(storageSecret).publicKey();
  const keyedProducers = producers.map((producer) => ({
    ...producer,
    payTo: Keypair.fromSecret(producer.secret).publicKey(),
  }));
  const addresses = [storageAddress, ...keyedProducers.map((producer) => producer.payTo)];
  if (new Set(addresses).size !== addresses.length) {
    throw new Error("Storage and each producer must use a different Stellar key");
  }

  const servers: Server[] = [];
  try {
    for (const producer of keyedProducers) {
      servers.push(await listen(
        createProducerApp(producer, producer.payTo, facilitatorApiKey),
        producer.port,
      ));
      console.log(`${producer.name} ready at http://127.0.0.1:${producer.port} (payTo ${producer.payTo})`);
    }

    const budget = new DailyBudgetPolicy(DAILY_BUDGET, new Set(keyedProducers.map(({ payTo }) => payTo)));
    const storageAgent = new Agent({ apiKey: "energy-grid-testnet-example" });
    storageAgent.initX402({
      secretKey: storageSecret,
      network: "stellar:testnet",
      maxAmountPerPayment: MAX_PAYMENT,
      policy: budget.hook(),
    });

    const paidProducers = new Set<string>();
    let payments = 0;
    for (let round = 1; round <= ROUND_COUNT - 1; round++) {
      const offer = cheapestOffer(offersForRound(keyedProducers, round));
      const txHash = await buyOffer(storageAgent, offer);
      payments++;
      paidProducers.add(offer.producerId);
      console.log(
        `round ${round}: bought ${offer.price} of 1 kWh from ${offer.producerName}; `
        + `${txHash} https://stellar.expert/explorer/testnet/tx/${txHash}`,
      );
    }

    if (payments < 3 || paidProducers.size < 2) {
      throw new Error("Market did not pay at least three times across two producers");
    }

    const overBudgetOffer = cheapestOffer(offersForRound(keyedProducers, ROUND_COUNT));
    let refusedWithoutSignature = false;
    try {
      await buyOffer(storageAgent, overBudgetOffer);
    } catch (error) {
      const denials = budget.records.filter((record) => record.outcome === "DENY");
      const signatures = budget.records.filter((record) => record.outcome === "SIGNED");
      refusedWithoutSignature =
        error instanceof X402PolicyError &&
        error.outcome === "DENY" &&
        denials.length === 1 &&
        signatures.length === payments;
      if (!refusedWithoutSignature) throw error;
      console.log(`round ${ROUND_COUNT}: refused ${overBudgetOffer.price} over budget before signing`);
    }

    if (!refusedWithoutSignature) throw new Error("Over-budget payment was not refused before signing");
    console.log(`market complete: ${payments} payments, ${paidProducers.size} producers, daily cap 0.035 USDC`);
  } finally {
    const closeResults = await Promise.allSettled(servers.map(close));
    const closeError = closeResults.find((result) => result.status === "rejected");
    if (closeError?.status === "rejected") throw closeError.reason;
  }
}
