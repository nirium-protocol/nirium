# Charge AI Agents in 5 Minutes with x402

This quickstart shows how to call a paid Nirium endpoint from a TypeScript script. The SDK handles the x402 negotiation, Stellar auth-entry signing, and paid retry after the endpoint returns `402 Payment Required`.

## What You Need

- Node.js >=22.12.0 - `@stellar/stellar-sdk` 16.x (a dependency of `nirium`) requires it; an older Node silently resolves an incompatible older SDK instead of failing.
- A funded Stellar testnet secret key. Use a throwaway testnet account only.
- A clean project where you can install `nirium`.

Do not use a mainnet secret key while testing this flow.

## 1. Create a Script Project

```bash
mkdir nirium-x402-demo
cd nirium-x402-demo
npm init -y
npm install nirium tsx typescript dotenv
```

Add a local environment file:

```bash
cat > .env <<'EOF'
STELLAR_SECRET_KEY=SXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXX
NIRIUM_PREMIUM_URL=https://nirium-agent.fly.dev/api/v1/premium/signals
EOF
```

Replace `STELLAR_SECRET_KEY` with a funded testnet secret key.

## 2. Add the Paid Call

Create `charge-agent.ts`:

```ts
import { Agent } from "nirium";
import "dotenv/config";

const secretKey = process.env.STELLAR_SECRET_KEY;
const premiumUrl =
  process.env.NIRIUM_PREMIUM_URL ??
  "https://nirium-agent.fly.dev/api/v1/premium/signals";

if (!secretKey) {
  throw new Error("Set STELLAR_SECRET_KEY in .env before running this script.");
}

const agent = new Agent({
  baseUrl: "https://nirium-agent.fly.dev",
});

agent.initX402({
  secretKey,
  network: "stellar:testnet",
});

const response = await agent.x402Fetch(premiumUrl);

if (!response.ok) {
  const text = await response.text();
  throw new Error(`Paid request failed: ${response.status} ${text}`);
}

const payload = await response.json();
console.log(JSON.stringify(payload, null, 2));
```

Run it with your `.env` loaded:

```bash
npx tsx charge-agent.ts
```

The first request receives a `402 Payment Required` challenge. `agent.x402Fetch()` signs the Stellar payment authorization, retries the request, and returns the paid response.

## 3. Verify the Testnet Payment

After a successful call, verify the transaction on Stellar testnet:

1. Find the transaction hash or payment reference returned by the endpoint or facilitator logs.
2. Open `https://stellar.expert/explorer/testnet/tx/<TRANSACTION_HASH>`.
3. Confirm the source account matches your testnet account.
4. Confirm the destination and amount match the endpoint price.
5. Save the explorer link with your integration notes.

If the response does not include a transaction hash, check the facilitator or server logs for the settled payment record. The paid response should still prove the x402 flow completed because the endpoint only returns protected data after payment authorization.

## 4. Change the Price or Endpoint

The seller controls pricing on the protected endpoint. To charge a different amount, update the server-side x402 payment requirements for the route you expose to agents. Keep these client-side values aligned with that endpoint:

```bash
NIRIUM_PREMIUM_URL=https://your-api.example.com/paid/agent-signal
```

Then rerun:

```bash
npx tsx charge-agent.ts
```

## Troubleshooting

| Problem | Fix |
| --- | --- |
| `x402 client not initialized` | Call `agent.initX402()` before `agent.x402Fetch()`. |
| `Set STELLAR_SECRET_KEY` | Add a funded testnet secret key to `.env`. |
| `402 Payment Required` is returned to your code | Use `agent.x402Fetch()` instead of `fetch()` so the SDK can sign and retry the payment. |
| Transaction cannot be found | Make sure you are checking Stellar testnet and that the payment was not rejected before settlement. |
| Mainnet funds at risk | Stop and switch back to `network: "stellar:testnet"` with a testnet account. |

## Python / LangChain

LangChain agents can pay the same endpoint through `NiriumX402Tool`, which wraps `init_x402` / `x402_fetch` and never exposes the Stellar secret to the model:

```bash
pip install 'nirium[langchain]'
```

See [`examples/langchain-x402-agent`](../examples/langchain-x402-agent) for a runnable ReAct-style agent.

## Next Steps

- Move the secret key into your normal secret manager before deploying.
- Add request logging so each paid response is tied to its testnet transaction.
- Create a dedicated testnet account per environment to simplify reconciliation.
