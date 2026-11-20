import "dotenv/config";

import { Keypair } from "@stellar/stellar-sdk";
import { pathToFileURL } from "node:url";

import { buy } from "./buyer.js";
import { explorerTx, isValidContractId, makeReadLatest, writeValue } from "./contract.js";
import { createApp, PAID_ROUTE } from "./server.js";
import { fetchWeather, fromFixed, SOURCE_NAME, toFixed } from "./weather.js";

function need(name: string): string {
  const v = process.env[name];
  if (!v) {
    console.error(`Missing ${name}. See .env.example.`);
    process.exit(1);
  }
  return v;
}

function contractOpts() {
  const contractId = need("ORACLE_CONTRACT_ID");
  if (!isValidContractId(contractId)) {
    console.error("ORACLE_CONTRACT_ID is not a valid contract id (C...).");
    process.exit(1);
  }
  const rpcUrl = process.env.SOROBAN_RPC_URL;
  return { contractId, ...(rpcUrl ? { rpcUrl } : {}) };
}

async function friendbot(publicKey: string): Promise<void> {
  const r = await fetch(`https://friendbot.stellar.org/?addr=${encodeURIComponent(publicKey)}`);
  if (!r.ok) throw new Error(`friendbot HTTP ${r.status}`);
}

async function main(): Promise<void> {
  const cmd = process.argv[2];
  switch (cmd) {
    case "keys": {
      // Fresh testnet keypair. Put the secret in .env only; never commit it.
      const kp = Keypair.random();
      console.log(`public: ${kp.publicKey()}`);
      console.log(`secret: ${kp.secret()}`);
      if (process.argv.includes("--fund")) {
        await friendbot(kp.publicKey());
        console.log("funded with friendbot (testnet)");
      }
      return;
    }
    case "write": {
      const w = await fetchWeather();
      const fixed = toFixed(w.celsius);
      console.log(`${SOURCE_NAME}: ${w.celsius} C at ${w.observedAt} -> ${fixed}`);
      const r = await writeValue({ ...contractOpts(), secret: need("ORACLE_SECRET"), value: fixed });
      console.log(`write tx: ${r.hash}\n${explorerTx(r.hash)}`);
      return;
    }
    case "serve": {
      const opts = contractOpts();
      const payTo = Keypair.fromSecret(need("ORACLE_SECRET")).publicKey();
      const port = Number(process.env.ORACLE_PORT ?? 3403);
      const price = process.env.ORACLE_PRICE ?? "$0.01";
      const app = createApp({
        payTo,
        facilitatorApiKey: need("FACILITATOR_API_KEY"),
        contractId: opts.contractId,
        readLatest: makeReadLatest(opts),
        price,
      });
      app.listen(port, () => {
        console.log(`oracle selling on http://localhost:${port}${PAID_ROUTE}  price ${price}  payTo ${payTo}`);
      });
      return;
    }
    case "buy": {
      const opts = contractOpts();
      const url = process.env.ORACLE_URL ?? `http://localhost:${process.env.ORACLE_PORT ?? 3403}${PAID_ROUTE}`;
      const { answer, check } = await buy({
        url,
        buyerSecret: need("BUYER_SECRET"),
        contractId: opts.contractId,
        readLatest: makeReadLatest(opts),
      });
      console.log(`paid answer: ${answer.celsius} C (value ${answer.value}, ledger time ${answer.timestamp})`);
      console.log(check.ok ? "MATCHES contract state" : `MISMATCH: ${check.reasons.join("; ")}`);
      if (!check.ok) process.exitCode = 1;
      return;
    }
    case "negative-test": {
      // A fresh, funded key that is NOT the oracle tries to write.
      const attacker = Keypair.random();
      await friendbot(attacker.publicKey());
      console.log(`non-oracle key: ${attacker.publicKey()}`);
      try {
        const r = await writeValue({ ...contractOpts(), secret: attacker.secret(), value: 99999 });
        console.log(`UNEXPECTED: write succeeded ${r.hash}`);
        process.exitCode = 1;
      } catch (e) {
        console.log("write rejected as expected:");
        console.log(String((e as Error).message).slice(0, 600));
      }
      console.log(`latest on chain is unchanged: ${fromFixed((await makeReadLatest(contractOpts())()).value)} C`);
      return;
    }
    default:
      console.log("usage: cli.ts keys [--fund] | write | serve | buy | negative-test");
      process.exitCode = cmd ? 1 : 0;
  }
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  main().catch((err) => {
    console.error(err instanceof Error ? err.message : err);
    process.exit(1);
  });
}
