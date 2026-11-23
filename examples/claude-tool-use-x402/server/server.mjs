// A small x402Serve route on stellar:testnet for the OpenAI Agents example.
//
// Two paid routes, so the agent can show both outcomes against a seller you run:
//   GET /paid/market-summary  costs X402_PRICE (default $0.02), below the agent's $1 cap: paid
//   GET /paid/full-report     costs $2, above the cap: refused by the agent before signing
//
// Payments go to SELLER_PUBLIC_KEY, a testnet account you own (not the payer's key).
import dotenv from "dotenv";
import express from "express";
import { x402Serve } from "nirium";

// Same .env as the Python agent, one folder up.
dotenv.config({ path: new URL("../.env", import.meta.url), quiet: true });

const payTo = process.env.SELLER_PUBLIC_KEY ?? "";
const facilitatorApiKey = process.env.FACILITATOR_API_KEY ?? "";
const port = Number(process.env.X402_SERVER_PORT ?? 3402);
const rawPrice = process.env.X402_PRICE ?? "0.02";
const cheapPrice = rawPrice.startsWith("$") ? rawPrice : `$${rawPrice}`;

if (!/^G[A-Z2-7]{55}$/.test(payTo)) {
  console.error("SELLER_PUBLIC_KEY must be a testnet public key (G...) that you own. It receives the payments.");
  process.exit(1);
}
if (!facilitatorApiKey) {
  console.error("FACILITATOR_API_KEY is missing. A free testnet key: https://channels.openzeppelin.com/testnet/gen");
  process.exit(1);
}

const app = express();

app.use(
  x402Serve({
    payTo,
    network: "stellar:testnet",
    facilitatorApiKey,
    appName: "Nirium OpenAI Agents x402 example",
    routes: {
      "GET /paid/market-summary": { price: cheapPrice, description: "Market summary (below the agent's $1 cap)" },
      "GET /paid/full-report": { price: "$2", description: "Full report (above the agent's $1 cap)" },
    },
  }),
);

// Reached only after x402Serve verified and settled the payment.
app.get("/paid/market-summary", (_req, res) => {
  res.json({ ok: true, route: "market-summary", price: cheapPrice, note: "Demo data from your own x402Serve route." });
});

app.get("/paid/full-report", (_req, res) => {
  res.json({ ok: true, route: "full-report", price: "$2" });
});

app.listen(port, () => {
  console.log(`x402Serve on http://localhost:${port} (stellar:testnet), payTo ${payTo}`);
  console.log(`  GET /paid/market-summary  ${cheapPrice}`);
  console.log("  GET /paid/full-report     $2");
});
