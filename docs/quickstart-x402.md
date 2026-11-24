# Pay for an x402 API in 5 Minutes

This quickstart shows how an agent or script pays a Nirium x402 endpoint from TypeScript. To charge for your own API instead, see [`x402Serve()` in the README](../README.md#quickstart-charge-for-your-api). The SDK handles the x402 negotiation, Stellar auth-entry signing, and paid retry after the endpoint returns `402 Payment Required`.

## What You Need

- Node.js >=22.12.0 - `@stellar/stellar-sdk` 17.x (a dependency of `nirium`) requires it; an older Node silently resolves an incompatible older SDK instead of failing.
- A Stellar testnet account with XLM (from Friendbot), a USDC trustline and testnet USDC from [faucet.circle.com](https://faucet.circle.com). Use a throwaway testnet account only. The steps are in the [Spanish guide, section 2](./es/quickstart-x402.md#2-crear-y-financiar-una-clave-stellar); the commands are the same.
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
NIRIUM_PREMIUM_URL=https://nirium-agent.fly.dev/api/v1/premium/market
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
  "https://nirium-agent.fly.dev/api/v1/premium/market";

if (!secretKey) {
  throw new Error("Set STELLAR_SECRET_KEY in .env before running this script.");
}

const agent = new Agent({
  baseUrl: "https://nirium-agent.fly.dev",
});

agent.initX402({
  secretKey,
  network: "stellar:testnet",
  maxAmountPerPayment: "$1", // refused before signing if the server asks for more
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

The first request receives a `402 Payment Required` challenge. `agent.x402Fetch()` signs the Stellar payment authorization, retries the request, and returns the paid response. If the server asks for more than `maxAmountPerPayment` (default `$1`), the SDK throws `X402SpendCapError` and signs nothing.

## 3. Verify the Testnet Payment

After a successful call, verify the transaction on Stellar testnet:

1. Open your account on Stellar Expert: `https://stellar.expert/explorer/testnet/account/<YOUR_PUBLIC_KEY>`.
2. Find the newest USDC transfer out of your account and open its transaction.
3. The transaction's source account is the facilitator, which pays the fee; the USDC transfer inside it goes from your account to the seller's `payTo`.
4. Confirm the amount matches the endpoint price (0.05 USDC for `/api/v1/premium/market`).
5. Save the transaction link with your integration notes.

A `200` with data is not proof of payment on its own: the settled transaction on the ledger is. If you cannot find one, the payment did not settle; see Troubleshooting. The endpoint only returns protected data after payment authorization.

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
| `X402SpendCapError` | The endpoint asks for more than your `maxAmountPerPayment`. Raise it on purpose, e.g. `maxAmountPerPayment: "$5"`. |
| `HostError: Error(Contract, #13)` | Your account has no USDC trustline. Add it, then get testnet USDC from the faucet. |
| Mainnet funds at risk | Stop and switch back to `network: "stellar:testnet"` with a testnet account. |

## Endpoints

| Endpoint | Method | Price | Network |
| --- | --- | --- | --- |
| `/api/v1/premium/signals` | GET | 0.02 USDC | Testnet only |
| `/api/v1/premium/market` | GET | 0.05 USDC | Testnet and mainnet |
| `/api/v1/premium/execute` | POST | 0.25 USDC | Testnet only |

Prices read from each endpoint's live `402` challenge on 22 Nov 2026. On mainnet, `signals` and `execute` answer `501`.

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

---

**🇪🇸 Versión en español:** [docs/es/quickstart-x402.md](./es/quickstart-x402.md)
