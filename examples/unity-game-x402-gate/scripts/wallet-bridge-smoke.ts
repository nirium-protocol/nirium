/**
 * Wallet-bridge smoke test — proves the exact 402 → sign → retry protocol
 * shape a SUDK-based Unity client needs to reproduce, without a Unity
 * Editor.
 *
 * This is NOT a mocked test. It starts the real Express app from
 * src/server.ts, then drives it with the real `nirium` x402 client
 * against the real OpenZeppelin Channels testnet facilitator and real
 * Stellar testnet. Run it after funding PLAYER_SECRET_KEY's account with
 * testnet USDC (see README.md) — its output includes the settled
 * transaction hash to verify on stellar.expert.
 *
 * Desktop signing path
 * ---------------------
 * SUDK signs desktop (non-WebGL) transactions directly with the account's
 * ed25519 keypair (`MuxedAccount.Sign(byte[] data)` in
 * StellarDevToolkit/.../Stellar/MuxedAccount.cs — confirmed against the
 * toolkit's actual source, not guessed). That is exactly what nirium's
 * `agent.initX402({ secretKey })` does: `createEd25519Signer` wraps a raw
 * secret key and signs the Soroban authorization entry's preimage hash
 * directly. This script exercises that path for real, end to end.
 *
 * WebGL / Freighter bridge path
 * ------------------------------
 * SUDK's WebGL bridge (StellarClient.jslib) only wraps Freighter's
 * `signTransaction(unsignedEnvelope, { networkPassphrase })` — a whole
 * transaction-envelope signature. It does NOT expose Freighter's separate
 * `signAuthEntry` call, which is what x402's SEP-43 `X402Signer` interface
 * asks for. There is no method on `WalletManager` to invent around this: it
 * is a real gap in the toolkit's current public API (verified by reading
 * WalletManager.cs and StellarClient.jslib directly), not an oversight in
 * this example.
 *
 * The documented adaptation (implemented in unity/PaidActionClient.cs) is:
 * wrap the payment authorization entry inside a minimal Soroban
 * invoke-host-function transaction, sign that whole envelope with
 * `WalletManager.SignTransaction`, then extract the resulting signed auth
 * entry back out of the signed envelope before sending it as the
 * PAYMENT-SIGNATURE credential. The underlying cryptographic primitive is
 * identical either way — an ed25519 signature over the same auth-entry
 * preimage hash — so the desktop run below proves the payment protocol
 * logic is correct; only the transport (direct sign vs. wrap-in-envelope
 * sign) differs for WebGL, and that half is Unity/Freighter-only by
 * construction (no Unity Editor can substitute for it).
 */
import "dotenv/config";

import { Agent } from "nirium";

import { createApp, PAID_ROUTE } from "../src/server.js";

async function main(): Promise<void> {
  const payTo = requireEnv("X402_SELLER_ADDRESS");
  const facilitatorApiKey = requireEnv("FACILITATOR_API_KEY");
  const playerSecretKey = requireEnv("PLAYER_SECRET_KEY");
  const facilitatorUrl = process.env.X402_FACILITATOR_URL;
  const network = "stellar:testnet" as const;
  const price = process.env.X402_PRICE ?? "$0.02";

  const app = createApp({
    payTo,
    facilitatorApiKey,
    network,
    price,
    ...(facilitatorUrl ? { facilitatorUrl } : {}),
  });

  const server = app.listen(0);
  await new Promise<void>((resolve) => server.once("listening", resolve));
  const address = server.address();
  if (address === null || typeof address === "string") {
    throw new Error("expected server to bind an ephemeral TCP port");
  }
  const baseUrl = `http://127.0.0.1:${address.port}`;
  console.log(`[smoke] local x402 server listening on ${baseUrl}`);

  try {
    // `apiKey` here is for nirium's unrelated REST API surface (Agent
    // requires one in its config type) — it plays no role in x402 payments.
    const agent = new Agent({ apiKey: "unused-for-x402", baseUrl });

    console.log(`[smoke] initializing x402 client with the player's Stellar testnet keypair`);
    agent.initX402({ secretKey: playerSecretKey, network });

    console.log(`[smoke] requesting ${PAID_ROUTE} — expect a 402 challenge, then a signed, paid retry`);
    const response = await agent.x402Fetch(`${baseUrl}${PAID_ROUTE}`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ runNonce: `smoke-${Date.now()}` }),
    });

    if (!response.ok) {
      const text = await response.text();
      throw new Error(`Paid request failed: ${response.status} ${text}`);
    }

    const payload = (await response.json()) as {
      loot: { id: string; name: string; rarity: string };
    };

    console.log(`[smoke] payment accepted. Unlocked loot:`);
    console.log(JSON.stringify(payload.loot, null, 2));

    // x402 v2's settlement header is `PAYMENT-RESPONSE`, not the v1 name
    // `X-PAYMENT-RESPONSE` (and never `settlement-response`, which isn't a
    // real header in either version). See "Settlement Response Delivery" in
    // x402-foundation/x402's specs/transports-v2/http.md.
    const txHashHeader = response.headers.get("payment-response");
    if (txHashHeader) {
      console.log(`[smoke] settlement response header: ${txHashHeader}`);
      const decoded = tryDecodeBase64Json(txHashHeader);
      if (decoded && typeof decoded === "object" && "transaction" in decoded) {
        const txHash = (decoded as { transaction: string }).transaction;
        console.log(`[smoke] settled Stellar testnet transaction: ${txHash}`);
        console.log(`[smoke] verify at: https://stellar.expert/explorer/testnet/tx/${txHash}`);
      }
    } else {
      console.log(
        "[smoke] no settlement header found on the response — check facilitator/server logs for the settled tx hash.",
      );
    }
  } finally {
    server.close();
  }
}

function requireEnv(name: string): string {
  const value = process.env[name];
  if (!value) {
    throw new Error(`Missing required environment variable ${name}. Copy .env.example to .env and fill it in.`);
  }
  return value;
}

function tryDecodeBase64Json(value: string): unknown {
  try {
    return JSON.parse(Buffer.from(value, "base64").toString("utf8"));
  } catch {
    return null;
  }
}

main().catch((err) => {
  console.error("[smoke] failed:", err instanceof Error ? err.message : err);
  process.exitCode = 1;
});
