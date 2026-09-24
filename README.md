# Nirium

Open-source autonomous treasury and agentic payments (x402/MPP) for Stellar/Soroban.

This repository contains the TypeScript and Python SDKs, the MCP server, the CLI, examples and quickstarts that let any developer:

- **Get paid by AI agents**: put your own API behind an x402 pay-gate in one call with `x402Serve()`, or pay for someone else's with `initX402()`.
- **Automate on-chain treasury**: a Nirium agent moves idle capital into a CETES strategy (tokenized Mexican T-bills via Etherfuse) and back, over a vault **you** own. The agent can propose a rebalance without ever holding a signing key; autonomous execution on mainnet (the agent signs) is invite-only while a legal review closes.
- **Anchor immutable audit trails**: SHA-256 content hash pinned to IPFS, optionally carrying an ed25519 signature that proves *who* declared the fact, not just that it is unaltered.

Software-only and non-custodial: regulated partners execute settlement, the client signs every fund movement, and Nirium never holds client funds.

## Packages

| Package | Install | Version | Description |
|---|---|---|---|
| TypeScript SDK | `npm install nirium` | [![npm](https://img.shields.io/npm/v/nirium)](https://www.npmjs.com/package/nirium) | Client for the Nirium API, x402/MPP payments, signals, webhooks, plus `x402Serve()` to charge for your own API. |
| Python SDK | `pip install nirium` · `pip install 'nirium[langchain]'` | [![PyPI](https://img.shields.io/pypi/v/nirium)](https://pypi.org/project/nirium/) | Async client with the same surface, plus `NiriumX402Tool` for LangChain agents. |
| MCP server | `npx nirium-mcp` | [![npm](https://img.shields.io/npm/v/nirium-mcp)](https://www.npmjs.com/package/nirium-mcp) | 25 tools for Claude Desktop, Cursor, and any MCP-compatible IDE. |
| CLI | `npm install -g nirium-cli` | [![npm](https://img.shields.io/npm/v/nirium-cli)](https://www.npmjs.com/package/nirium-cli) | Scaffold and interact with Nirium from the terminal. |

> The source in `packages/` matches what is published. The two SDKs have identical **client** surfaces; TypeScript is one minor ahead because `x402Serve()` is Express middleware: server-side Node, with no meaningful Python equivalent. That gap is the honest signal, not a lag.

Signing with a social-login wallet instead of a raw keypair? See [`nirium-pollar-adapter`](https://github.com/nirium-protocol/nirium-pollar-adapter), a separate package that adapts [Pollar](https://pollar.xyz)'s embedded-wallet SDK to sign x402 payments and audit records through this SDK.

## Quickstart: pay for an API (TypeScript)

```bash
npm install nirium
```

```ts
import { Agent } from 'nirium';

const agent = new Agent({ baseUrl: 'https://nirium-agent.fly.dev' });
const market = await agent.getMarket();
console.log(market);
```

## Quickstart: charge for *your* API

The other side of the counter. Wiring x402 by hand is ~25 lines of facilitator client, per-method auth headers, per-network scheme registration and a route table whose shape you have to reverse-engineer. This is the same thing with the defaults that already run in production:

```ts
import { x402Serve } from 'nirium';

app.use('/premium', x402Serve({
    payTo: 'G...',              // your Stellar address
    routes: { 'GET /signals': '$0.02' },
}));
```

Any AI agent can now pay for your endpoint in USDC: no account, no card, no subscription, no human awake.

> **Known limitation:** `x402Serve()` verifies and settles the payment; it does
> not deduplicate a payment proof across requests or rate-limit callers on its
> own. Add your own protection if you need either (see
> [issue #91](https://github.com/nirium-protocol/nirium/issues/91) for what's
> missing and why, and for a real production reference implementation).

See [`docs/`](./docs) for full quickstarts, including [**"Charge AI agents in 5 minutes"**](./docs/quickstart-x402.md), and [`examples/`](./examples) for runnable Express, Next.js, [LangChain x402](./examples/langchain-x402-agent), and [non-custodial treasury vault](./examples/treasury-vault-quickstart) integrations. For real production findings (not marketing copy), see the [**devlog**](./docs/devlog.md).

## Networks

Live on **both** Stellar networks. They are not two copies of the same thing.

> **Settlement note (proposal, not a demand):** because nirium already speaks
> x402 (`x402Serve()`/`initX402()`), the same exact-scheme flow can also
> settle **fee-free in Nano (XNO)** — instant finality, no gas, fully
> self-custodied (no freezeable stablecoin). At agent micropayment prices the
> settlement cost on an EVM/Stellar rail can rival the call itself. The
> buyer side already works today (independent, on-chain): an
> OpenAI-Agents-SDK x402 payer settled a third-party seller in 0.00001292 XNO
> on 2026-09-18, block
> `E67FB89426F46E6AE4E0E5750B5F814A699965B8639DA89F38689EA1AFE57FC3`
> (`confirmed: true`), via a thin adapter on feeless402:
> https://github.com/PANDeveloper001/openai-agents-nano-x402. If Nano fits
> your settlement model, a `nano:mainnet`/XNO accept beside your Stellar one
> could be a one-route pilot; if it does not, this changes nothing.

**Mainnet** (real value). The API box holds **no signing key** by design; a separate process with no HTTP surface signs autonomous rebalances, and clients sign their own fund movements.

| What | Verify |
|---|---|
| First real x402 payment | [`3134a51c…7558bc`](https://stellar.expert/explorer/public/tx/3134a51c66091fd7fbd85b38a4a6ec6cd432bb92c2450eac84ea7855cb7558bc) |
| Treasury vault deployed (client signs) | [`93ff6284…78416`](https://stellar.expert/explorer/public/tx/93ff6284cdf03706624c88434a79fba1b213ee547f58e09a9248f75373178416) |
| Autonomous invest (**the agent signs**) | [`82d73f53…6b3d4`](https://stellar.expert/explorer/public/tx/82d73f537e907140367f9343f63a36704c74a5286aced7a938cee8fffb56b3d4) |
| API | [`nirium-agent-mainnet.fly.dev/health`](https://nirium-agent-mainnet.fly.dev/health) |

That third transaction is the point: the agent moved funds it does not own, and the contract gave it no way to take them out. Nirium holds only the vault's `RebalanceManager` role, and `rebalance()` accepts no destination address: withdrawal is not *forbidden*, it is **inexpressible**.

**Testnet** (no real value, where the loop and the key live, and where you should build).

| Contract | ID |
|---|---|
| NiriumVault | [`CBTWMZCG3P72EHFAQ4ZLSEBIOFYJC244H5J6DHZIJ56FHFWJ2CFAWSZU`](https://stellar.expert/explorer/testnet/contract/CBTWMZCG3P72EHFAQ4ZLSEBIOFYJC244H5J6DHZIJ56FHFWJ2CFAWSZU) |
| NiriumProtocol | [`CC2TU5BDTKTPRRRQPEF77I54XYHFQ25XGIRO2TCWKSR7NRJDFR5L5NR5`](https://stellar.expert/explorer/testnet/contract/CC2TU5BDTKTPRRRQPEF77I54XYHFQ25XGIRO2TCWKSR7NRJDFR5L5NR5) |

API: [`nirium-agent.fly.dev/health`](https://nirium-agent.fly.dev/health) · node catalog: [`/api/nodes`](https://nirium-agent.fly.dev/api/nodes)

Nirium's own **NiriumVault** treasury contract stays on testnet and is audit-gated: no independent third-party audit has happened yet, and no client funds ever reach it. The mainnet treasury path runs over a **DeFindex** vault instead: a third-party contract audited by OtterSec (March 2025, 16 findings, all 13 vulnerabilities resolved) on a Blend V2 strategy.

## External validation

Live usage, read from Horizon/npm/PyPI/GitHub: https://nirium.xyz/stats

Real bugs found in code we don't control, in other people's repos, confirmed by maintainers with no reason to agree if they weren't real.

**[x402-foundation/x402#3171](https://github.com/x402-foundation/x402/issues/3171)** — `paymentRequirementsMatchAccepted()` in `@x402/core` threw a raw internal `TypeError` instead of a protocol-level error when a payment's `accepted` field was missing or null. We filed it after hitting it live against our own production endpoint. Fixed by an external contributor, [JasonColapietro](https://github.com/JasonColapietro) — not us — in [PR #3180](https://github.com/x402-foundation/x402/pull/3180). Maintainer [phdargen](https://github.com/phdargen) approved and merged it: *"Thanks for the patch @JasonColapietro, LGTM 🚀"* — commit [`ab1a31a`](https://github.com/x402-foundation/x402/commit/ab1a31ab56ef8656908562d5c2b691772c5a85a2), 55/55 tests passing, issue closed automatically as completed.

**[OpenZeppelin/relayer-plugin-x402-facilitator#47](https://github.com/OpenZeppelin/relayer-plugin-x402-facilitator/issues/47)** — a facilitator sponsor account we rely on went silent for 205+ hours. Three independent integrators (us, [AgentLedger](https://agentpayments.fi), and a third party) converged on the same diagnosis across a month of silence on two official OpenZeppelin channels — until a direct tag to maintainers verified as active elsewhere in the org broke it open: *"Apologies for the slow response... looking into it now and will update here shortly"* ([`zeljkoX`](https://github.com/zeljkoX), 9-sep-2026). **Fixed 2026-09-11** — root cause was a stale RPC URL on the hosted pubnet facilitator instance, throwing before it ever evaluated a payload. Verified with a real settlement on our own mainnet box (clean `200`, confirmed on Horizon), then independently repeated by AgentLedger on 2026-09-12 with the same result. Closed by the maintainer 2026-09-14. ~32-day outage, ~2026-08-10 → 2026-09-11.

**[stellar/stellar-mpp-sdk#69](https://github.com/stellar/stellar-mpp-sdk/pull/69)** — `@stellar/mpp`'s exported `USDC_SAC_MAINNET` (54 chars) and `XLM_SAC_MAINNET` (55 chars) both fail `StrKey.isValidEd25519PublicKey()` — invalid addresses, present in every version including 0.7.1. Filed with the exact byte counts and correct addresses; PR merged the **same day**. Our own `USDC_SAC_OVERRIDE` workaround (`middleware/mpp.ts`) stays until a release actually ships the fix.

Full history, including findings still open, in the [devlog](./docs/devlog.md).

## Contributing

Contributions welcome: examples, framework adapters, language bindings, docs and tests. This repo ran a GrantFox bounty campaign with Trustless Work through early September 2026 — that campaign is now closed, so there are currently **no open, assigned-on-request issues**. Watch the [issues page](../../issues) for the next round rather than pinging an old thread; a future campaign, if one runs, will be labeled explicitly.

Outside of any campaign, PRs are still welcome — examples, framework adapters, bindings, docs, tests — just note in the PR that it isn't tied to a bounty.

## Disclaimer

Experimental software. Not financial advice, not an investment product, and no guarantee of yield, dividends or appreciation. Rate data (Blend supply rate, Etherfuse CETES rate) is public protocol information, not a projection. Smart contracts carry risk even when audited. XLM and Stellar assets are volatile.

## License

Apache-2.0: see [LICENSE](./LICENSE).
