# Nirium

[![CI](https://github.com/nirium-protocol/nirium/actions/workflows/ci.yml/badge.svg)](https://github.com/nirium-protocol/nirium/actions/workflows/ci.yml)
[![Security Gate](https://github.com/nirium-protocol/nirium/actions/workflows/security-gate.yml/badge.svg)](https://github.com/nirium-protocol/nirium/actions/workflows/security-gate.yml)

Open-source autonomous treasury and agentic payments (x402/MPP) for Stellar/Soroban.

This repository contains the TypeScript and Python SDKs, the MCP server, the CLI, examples and quickstarts that let any developer:

- **Get paid by AI agents**: put your own API behind an x402 pay-gate in one call with `x402Serve()`, or pay for someone else's with `initX402()`.
- **Cap what your own agent can spend**: an experimental pre-sign policy hook (`initX402({ policy })`, shipped in 0.16.0) asks your own ALLOW/DENY policy before any payment is signed - see [`packages/sdk/README.md#pre-sign-policy-hook-experimental`](./packages/sdk/README.md#pre-sign-policy-hook-experimental) for its real scope and what it does not cover.
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

> The source in `packages/` matches what is published (the `overrides` in `packages/sdk` and `packages/cli` were added on 2026-10-23 for this repo's own dependency audit; npm ignores a dependency's `overrides`, so they don't change what you install). The two SDKs share full Treasury parity (12 methods, `proposeTreasuryRebalance()`/`propose_treasury_rebalance()` included). `x402Serve()` stays TypeScript-only - it's Express middleware, server-side Node, with no meaningful equivalent in an async Python client. Going the other way, Python ships a resilient, auto-reconnecting WebSocket client (backoff, jitter, dedup) and a LangChain `BaseTool` (`pip install nirium[langchain]`) that TypeScript doesn't have yet - the version gap runs both directions, not just one.

Signing with a social-login wallet instead of a raw keypair? See [`nirium-pollar-adapter`](https://github.com/nirium-protocol/nirium-pollar-adapter), a separate package that adapts [Pollar](https://pollar.xyz)'s embedded-wallet SDK to sign x402 payments and audit records through this SDK.

## Quickstart: pay for an API (TypeScript)

```bash
npm install nirium
```

```ts
import { Agent } from 'nirium';

const agent = new Agent({ apiKey: 'sk_inst_your_key_here', baseUrl: 'https://nirium-agent.fly.dev' });
const market = await agent.getMarket();
console.log(market);
```

> **Update, 2026-10-24 (checked against the live API that day):** this
> previously showed `getMarket()` with no `apiKey` at all. `GET /api/market`
> requires auth server-side and returns 401 without one - get a key from
> `POST /api/auth/keys` or the [`/keys` console](https://nirium.xyz/keys).

## Quickstart: charge for *your* API

The other side of the counter. Wiring x402 by hand is ~25 lines of facilitator client, per-method auth headers, per-network scheme registration and a route table whose shape you have to reverse-engineer. This is the same thing with the defaults that already run in production:

```bash
npm install nirium express @x402/express @x402/core @x402/stellar
```

```ts
import express from 'express';
import { x402Serve } from 'nirium';

const app = express();

// No `network` set, so this defaults to stellar:testnet - get a free
// testnet key from channels.openzeppelin.com/testnet/gen. A mainnet key
// returns 401 against testnet; pass network: 'stellar:pubnet' plus a
// mainnet key (channels.openzeppelin.com/gen) to charge for real.
app.use('/premium', x402Serve({
    payTo: 'G...',                      // your Stellar address
    routes: { 'GET /signals': '$0.02' },
    facilitatorApiKey: process.env.X402_FACILITATOR_API_KEY,
}));

app.listen(3000);
```

Any AI agent can now pay for your endpoint in USDC: no account, no card, no subscription, no human awake.

> **Update, 2026-10-24 (checked against the source that day):** this previously
> omitted `facilitatorApiKey`/`facilitatorUrl`, `express`/`app` itself (the
> snippet called `app.use()` with no `app` ever created), and which network
> it runs against by default (testnet). Get a key from [OpenZeppelin Channels](https://channels.openzeppelin.com),
> or point `facilitatorUrl` at your own facilitator instead.

> **Known limitation:** `x402Serve()` verifies and settles the payment; it does
> not deduplicate a payment proof across requests or rate-limit callers on its
> own. Add your own protection if you need either (see
> [issue #91](https://github.com/nirium-protocol/nirium/issues/91) for what's
> missing and why, and for a real production reference implementation).

See [`docs/`](./docs) for full quickstarts, including [**"Charge AI agents in 5 minutes"**](./docs/quickstart-x402.md), and [`examples/`](./examples) for 13 runnable integrations across 4 languages: [Express](./examples/express-x402) and [Next.js](./examples/nextjs-x402) (TypeScript), [Go](./examples/go-x402), [Rust](./examples/rust-x402), [LangChain x402](./examples/langchain-x402-agent), [non-custodial treasury vault](./examples/treasury-vault-quickstart), [resilient WebSocket signals](./examples/ws-signals-resilient), [one-click Vercel deploy](./examples/deploy-x402-vercel), [Unity/C# game paywall](./examples/unity-game-x402-gate), [RouteDock discovery manifest](./examples/routedock-manifest), [Stellar Disbursement Platform audit bridge](./examples/sdp-audit-bridge), [audit-forensic-bridge](./examples/audit-forensic-bridge), and [per-agent daily spend policy](./examples/x402-policy-daily-budget). For real production findings (not marketing copy), see the [**devlog**](./docs/devlog.md).

## Networks

Live on **both** Stellar networks. They are not two copies of the same thing.

**Update, 2026-10-24 (checked against the live `/api/v1/mpp/info` on both
boxes that day):** that applies to x402 and the treasury path below, not to
**MPP Charge**. MPP is implemented and `charge.enabled: true` on both
networks, but it has only ever settled on **testnet** (pull and push, 15 Oct
2026); mainnet is unverified. Don't read "live on both networks" as covering
MPP - see `packages/sdk/README.md#mpp-charge-experimental`.

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

Nirium's own **NiriumVault** treasury contract stays on testnet and is audit-gated: no independent third-party audit has happened yet, and no client funds ever reach it. The mainnet treasury path runs over a **DeFindex** vault instead: a third-party contract audited by OtterSec (March 2025, 16 findings total - 13 of them vulnerabilities, all resolved; the other 3 were non-vulnerability suggestions) on a Blend V2 strategy.

## External validation

Live usage, read from Horizon/npm/PyPI/GitHub: https://nirium.xyz/stats

Real bugs found in code we don't control, in other people's repos, confirmed by maintainers with no reason to agree if they weren't real.

**[x402-foundation/x402#3171](https://github.com/x402-foundation/x402/issues/3171)** - `paymentRequirementsMatchAccepted()` in `@x402/core` threw a raw internal `TypeError` instead of a protocol-level error when a payment's `accepted` field was missing or null. We filed it after hitting it live against our own production endpoint. Fixed by an external contributor, [JasonColapietro](https://github.com/JasonColapietro) - not us - in [PR #3180](https://github.com/x402-foundation/x402/pull/3180). Maintainer [phdargen](https://github.com/phdargen) approved and merged it: *"Thanks for the patch @JasonColapietro, LGTM 🚀"* - commit [`ab1a31a`](https://github.com/x402-foundation/x402/commit/ab1a31ab56ef8656908562d5c2b691772c5a85a2), 55/55 tests passing, issue closed automatically as completed.

**[OpenZeppelin/relayer-plugin-x402-facilitator#47](https://github.com/OpenZeppelin/relayer-plugin-x402-facilitator/issues/47)** - a facilitator sponsor account we rely on went silent for 205+ hours. Three independent integrators (us, [AgentLedger](https://agentpayments.fi), and a third party) converged on the same diagnosis across a month of silence on two official OpenZeppelin channels - until a direct tag to maintainers verified as active elsewhere in the org broke it open: *"Apologies for the slow response... looking into it now and will update here shortly"* ([`zeljkoX`](https://github.com/zeljkoX), 9-sep-2026). **Fixed 2026-09-11** - root cause was a stale RPC URL on the hosted pubnet facilitator instance, throwing before it ever evaluated a payload. Verified with a real settlement on our own mainnet box (clean `200`, confirmed on Horizon), then independently repeated by AgentLedger on 2026-09-12 with the same result. Closed by the maintainer 2026-09-14. ~32-day outage, ~2026-08-10 → 2026-09-11.

**Update, 2026-10-24:** at the time of this outage (Aug-Sep 2026), AgentLedger was independent of Nirium, which is what makes the corroboration above worth citing. Since then, Fer - AgentLedger's founder - also joined Nirium part-time (October 2026). Mentioned here for anyone reading this as third-party validation today.

**[stellar/stellar-mpp-sdk#69](https://github.com/stellar/stellar-mpp-sdk/pull/69)** - `@stellar/mpp`'s exported `USDC_SAC_MAINNET` (54 chars) and `XLM_SAC_MAINNET` (55 chars) both fail `StrKey.isValidEd25519PublicKey()` - invalid addresses, present in every version including 0.7.1. Filed with the exact byte counts and correct addresses; PR merged the **same day**. Our own `USDC_SAC_OVERRIDE` workaround (`middleware/mpp.ts`) stays until a release actually ships the fix.

**[Trustless-Work/agentic-escrow-research](https://github.com/Trustless-Work/agentic-escrow-research)** - 4 PRs merged (#1-#4), all 4 within a 27-minute window, 21-sep-2026: bounded-authority milestone payouts, treasury rebalancing via a destination parameter that doesn't exist, direct x402 payment without escrow with real settlement verified on mainnet, and production evidence for their agentic-tool schema. Trustless Work thanked us publicly from their own account: *"We just merged our first 4 community contributions 🙏 @vaiossx @smithserrat @Niriumstellar."*

**[stellar/js-stellar-sdk#1655](https://github.com/stellar/js-stellar-sdk/issues/1655)** (and the related [#1681](https://github.com/stellar/js-stellar-sdk/issues/1681), [#1683](https://github.com/stellar/js-stellar-sdk/issues/1683), [#1700](https://github.com/stellar/js-stellar-sdk/issues/1700)) - real bugs and gaps in the SDK's delegate-signing path (`needsNonInvokerSigningBy()`/`signAuthEntries()`/`authorizeEntry()` weren't walking CAP-71 delegate trees correctly, or verifying signers other than the root node). #1655 fixed by the maintainer's [PR #1747](https://github.com/stellar/js-stellar-sdk/pull/1747); #1683 fixed by [PR #1742](https://github.com/stellar/js-stellar-sdk/pull/1742); #1681 fixed by two separate PRs, [#1743](https://github.com/stellar/js-stellar-sdk/pull/1743) and [#1744](https://github.com/stellar/js-stellar-sdk/pull/1744), closed by us once both merged. #1700 was closed after a docs-only PR, [#1745](https://github.com/stellar/js-stellar-sdk/pull/1745), documented the reported gap as a known limitation rather than changing behavior - real acknowledgment, not a code fix. The maintainer kept building on this thread in a follow-up feature request of their own ([#1759](https://github.com/stellar/js-stellar-sdk/issues/1759)). A fifth report from the same round, [#1699](https://github.com/stellar/js-stellar-sdk/issues/1699), we withdrew ourselves after our own fix attempt against the full test suite showed the behavior was intentional, not a bug - closed `not_planned`, never fixed, reported honestly rather than folded into the count above.

**Update, 2026-09-28 (checked against the GitHub API that day):** an earlier version of this entry, published the same day, said all five issues including #1699 were "confirmed and fixed by the maintainer in PR #1747 and PR #1742." That was wrong on two counts, caught the same day by re-checking each issue's closing event individually instead of trusting the grouped claim: #1699 was withdrawn as `not_planned`, never fixed; and #1681/#1700 were never closed by those two PRs - #1681 by #1743 + #1744 (closed manually by us), #1700 by a docs-only PR (#1745) that documents a known limitation instead of changing behavior. Corrected above.

**[Trustless-Work/trustlesswork-sdk-react#6](https://github.com/Trustless-Work/trustlesswork-sdk-react/issues/6)** - `trustline.address` ambiguity (SAC contract id vs. classic issuer) in their Multi-Release docs. Closed 28-sep-2026, 30 minutes after their ["Feature/version 2" PR](https://github.com/Trustless-Work/trustlesswork-sdk-react/pull/7) merged.

Full history, including findings still open, in the [devlog](./docs/devlog.md).

## Funding

Nirium received Stellar Community Fund Instaward funding (two awards) via a regional Stellar Ambassador chapter, with full KYC complete (Airtable + Persona + W-8BEN). Instaward is SCF's early-stage program for prototyping and local validation, up to $15,000 per project. More info: [communityfund.stellar.org](https://communityfund.stellar.org). This isn't independently verifiable by API the way the findings above are - it's the program's own award record, not a third-party confirmation.

## Contributing

Contributions welcome: examples, framework adapters, language bindings, docs and tests. This repo ran a GrantFox bounty campaign with Trustless Work through early September 2026 - that campaign is now closed, so there are currently **no open, assigned-on-request issues**. Watch the [issues page](../../issues) for the next round rather than pinging an old thread; a future campaign, if one runs, will be labeled explicitly.

Outside of any campaign, PRs are still welcome - examples, framework adapters, bindings, docs, tests - just note in the PR that it isn't tied to a bounty.

## Security

Report vulnerabilities privately; see [SECURITY.md](./SECURITY.md).

**Known transitive issue (checked 2026-10-04):** `@stellar/stellar-sdk` 16.x pins `axios` to exactly `1.18.0`, which has seven high-severity advisories fixed in `1.20.0`. `nirium` and `@x402/stellar` both depend on stellar-sdk 16, so a plain install pulls that axios. Until a 16.x patch ships, force the fixed version from your own `package.json`:

**Update, 2026-10-23 (checked against the npm registry that day):** that patch shipped. `@stellar/stellar-sdk` 16.4.1 pins `axios` 1.20.0, and `nirium@0.16.1` depends on `^16.3.0`, so a fresh install now gets the fixed axios without any override. You still need the override below only if an existing lockfile keeps you on an older 16.x; `npm update @stellar/stellar-sdk` is the cleaner fix. The original note stays for that case:

```json
{
  "overrides": { "axios": "^1.20.0" }
}
```

With pnpm, put the same entry under `"pnpm": { "overrides": { ... } }`. We tested this on a clean install of `nirium@0.16.0`: axios resolves to 1.20.0, `npm audit` reports no high findings, and Horizon calls through the SDK still work.

## Disclaimer

Experimental software. Not financial advice, not an investment product, and no guarantee of yield, dividends or appreciation. Rate data (Blend supply rate, Etherfuse CETES rate) is public protocol information, not a projection. Smart contracts carry risk even when audited. XLM and Stellar assets are volatile.

## License

Apache-2.0: see [LICENSE](./LICENSE).
