import { Keypair } from "@stellar/stellar-sdk";
import { pathToFileURL } from "node:url";

import { runMarket } from "./market.js";

async function createKeys(fund: boolean): Promise<void> {
  const roles = ["solar-east", "solar-west", "storage"];
  for (const role of roles) {
    const keypair = Keypair.random();
    console.log(`${role} public key: ${keypair.publicKey()}`);
    console.log(`${role} secret: ${keypair.secret()}`);
    if (fund) {
      const response = await fetch(
        `https://friendbot.stellar.org/?addr=${encodeURIComponent(keypair.publicKey())}`,
      );
      if (!response.ok) throw new Error(`Friendbot returned HTTP ${response.status} for ${role}`);
      console.log(`${role} funded on stellar:testnet`);
    }
  }
}

async function main(): Promise<void> {
  switch (process.argv[2]) {
    case "keys":
      await createKeys(process.argv.includes("--fund"));
      return;
    case "market":
      await runMarket();
      return;
    default:
      console.log("usage: npm run keys [-- --fund] | npm run market");
      process.exitCode = 1;
  }
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  main().catch((error: unknown) => {
    console.error(error instanceof Error ? error.message : error);
    process.exitCode = 1;
  });
}
