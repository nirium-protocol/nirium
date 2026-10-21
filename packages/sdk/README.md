# nirium

Autonomous treasury and agentic-payments infrastructure for **Nirium Protocol** on Stellar/Soroban.

Nirium agents rebalance USDC ↔ CETES (tokenized Mexican T-bills via Etherfuse) 24/7 without human intervention. Built for developers who want to integrate autonomous treasury management, agentic payments with x402 (in both directions: paying for other APIs with `initX402()` and charging for your own with `x402Serve()`), an experimental MPP Charge client, and real-time market data into their applications.

## Install

```bash
npm install nirium
```

## Quick Start

```typescript
import { Agent } from 'nirium';

const agent = new Agent({
  apiKey: 'sk_inst_your_key_here',
  baseUrl: 'https://nirium-agent.fly.dev',
});

// Health check
const alive = await agent.ping();
console.log('Agent alive:', alive);

// Real market data from Stellar Horizon
const market = await agent.getMarket();
console.log('XLM Price:', market.xlmPrice);

// Trigger a demo strategy on Nirium's own shared testnet vault - a real,
// working transaction, not a simulation, but it moves Nirium's testnet
// funds, not yours. To rebalance YOUR OWN vault, see Treasury Rebalance below.
const result = await agent.execute('blend-yield', 'USDC', { amount: 5000 });
console.log('Result:', result.success, result.txHash);

// Real-time signals via WebSocket
agent.subscribe((signal) => {
  console.log('Signal:', signal.signal_type, signal.data.details);
});
```

## API Coverage

| Category | Methods |
|---|---|
| Health | `ping()`, `health()`, `systemHealth()` |
| Execution | `execute()`, `executeDemo()` |
| Market | `getTickers()`, `getMarket()`, `getStats()`, `getLoopStatus()`, `startLoop()`, `stopLoop()`, `triggerScan()` |
| Signals | `createSubscription()`, `getSubscriptions()`, `deleteSubscription()`, `getSubscriptionStats()`, `getRecentSignals()` |
| Skills | `getSkills()`, `installSkill()`, `uninstallSkill()`, `getSkillMarketplace()`, `executeSkillAction()` |
| Strategies | `getStrategies()` |
| Webhooks | `registerWebhook()`, `getWebhooks()`, `deleteWebhook()`, `testWebhook()` |
| Auth | `getAuthToken()`, `createAuthKey()`, `getAuthKeys()`, `revokeAuthKey()` |
| Revenue | `getRevenue()`, `getInfo()` |
| Nodes | `getNodes()` |
| Payouts | `createPayoutRun()`, `submitPayout()`, `onboardPayoutRecipient()`, `submitPayoutOnboard()`, `getPayoutRuns()`, `getPayoutTerms()`, `getPayoutInfo()` |
| Treasury | `getTreasuryInfo()`, `getTreasuryVault()`, `getTreasuryVaults()`, `getTreasuryStrategyAsset()`, `deployTreasuryVault()`, `depositToTreasuryVault()`, `withdrawFromTreasuryVault()`, `setTreasuryRebalanceManager()`, `buildTreasuryRebalance()`, `proposeTreasuryRebalance()`, `executeTreasuryRebalance()`, `submitTreasuryTx()` |
| Audit Trail | `anchorAuditRecord()`, `getAuditInfo()` |
| Reporting | `getReportingSummary()`, `getReportingExport()`, `getReportingExportUrl()` |
| Admin | `configureLLM()` |
| WebSocket | `subscribe()`, `onLog()`, `disconnect()` |
| x402 Payments | `initX402()`, `x402Fetch()` |
| MPP Charge client (experimental, see below) | `initMpp()`, `mppFetch()` |

## Authentication

```typescript
// API Key for REST endpoints
const agent = new Agent({
  apiKey: 'sk_inst_...',
  baseUrl: 'https://nirium-agent.fly.dev',
});

// With JWT token for WebSocket (optional)
const agent = new Agent({
  apiKey: 'sk_inst_...',
  baseUrl: 'https://nirium-agent.fly.dev',
  token: 'eyJhbG...', // JWT from /api/auth/token
});
```

## Payment Protocols

### x402: Pay-Per-Request
```typescript
agent.initX402({
  secretKey: 'S...',           // Stellar secret key
  network: 'stellar:testnet',
});

const response = await agent.x402Fetch('https://nirium-agent.fly.dev/api/v1/premium/signals');
const data = await response.json();
```

#### Per-payment cap

`@x402/core` 2.23.0 and later refuse any payment above a default cap of **$1** per request (a default asset such as USDC), before anything is signed. `x402Fetch()` now says so with an `X402SpendCapError` instead of a generic error:

```typescript
import { X402SpendCapError } from 'nirium';

try {
  await agent.x402Fetch(url);
} catch (e) {
  if (e instanceof X402SpendCapError) {
    console.log(e.formattedAmount, e.cap, e.signerCalled); // '2 USDC' '$1' false
  }
}
```

The error carries `url`, `amount` (atomic units, the cheapest offer when the server lists several), `formattedAmount`, `asset`, `network` and `cap`, and `signerCalled` is always `false`: nothing was signed or sent. The cap is enforced by `@x402/core`. Other `spendControls` rejections (for example a non-default asset) still surface as the original error.

To pay an API priced above $1, raise the cap explicitly with `maxAmountPerPayment` (a USD amount: `'$5'`, `'5'` or `5`; it applies to default assets such as USDC):

```typescript
agent.initX402({ secretKey: 'S...', network: 'stellar:pubnet', maxAmountPerPayment: '$5' });
```

Why the default stays at $1: an agent pays whatever a server's 402 asks for, without a human in the loop, so a low cap limits the damage from a mispriced or malicious endpoint. Raising it is a choice the integrator makes on purpose; omitting the option keeps `@x402/core`'s $1. It must be a positive amount, checked when `initX402()` runs; `false` (no cap) is not accepted. The option also applies when a `policy` is set, and a payment above the cap is refused before the policy or the signer is reached.

#### Pre-sign policy hook (experimental)

Pass `policy` to `initX402()` and every `x402Fetch()` asks your policy before anything is signed. The question is asked after the Stellar authorization is built, so the policy sees exactly what would be signed: amount, destination, asset, nonce, expiration ledger and network, decoded from the bytes.

**Experimental, new in 0.16.0.** The shape of `policy` (the context object, the outcomes, the records `onDecision` receives) can still change in a minor release before 1.0.0. Its scope is the agent-side cases that [#96](https://github.com/nirium-protocol/nirium/issues/96) groups as G1 (they come from the harness of @CodeDeityX), and nothing beyond them. What it does not cover is listed in the last paragraph of this section: code in the same process that holds the raw signer (L02 in that discussion), and pending-capacity reservation (L01: concurrent requests that observe the same remaining capacity). Neither is solved.

```typescript
import { X402PolicyError } from 'nirium';

agent.initX402({
  signer: walletSigner,
  network: 'stellar:pubnet',
  policy: {
    evaluate: async (ctx) => {
      const ok = BigInt(ctx.authorization.amount) <= myLimit;
      return ok
        ? { decision: 'ALLOW', contextHash: ctx.contextHash, policyVersion: 'v7', expiresAt: Date.now() + 2_000 }
        : { decision: 'DENY', reason: 'over limit' };
    },
    // Optional: the policy version in force right now.
    currentVersion: async () => myPolicyStore.version(),
  },
});

try {
  await agent.x402Fetch(url);
} catch (e) {
  if (e instanceof X402PolicyError) console.log(e.outcome); // DENY, WAIT, TIMEOUT, STALE, ...
}
```

Only an `ALLOW` that echoes this authorization's `contextHash`, and is still valid, reaches the signer. Everything else signs nothing: `DENY`, `WAIT`, an exception, no answer before the deadline (`timeoutMs`, default 5 s, never more than half the payment's `maxTimeoutSeconds`), a malformed answer, an `ALLOW` past its `expiresAt`, a signer whose address changed while the policy was being asked, or a clock (`now`) that does not return a finite number (`CLOCK_INVALID`). Without `policy`, `x402Fetch()` behaves exactly as before.

**Stale ALLOW.** With `currentVersion` set, it is read after the `ALLOW` and right before signing, and the `ALLOW` signs only if its `policyVersion` matches. A rejected, empty or late read signs nothing. This check is **not atomic with signing**: the version can change after it is read, or while the signer runs. It narrows the window to the synchronous step between the read and the signer call; it does not close it. `expiresAt` is checked again after the read.

**Receipts (`onDecision`).** A payment whose `ALLOW` is accepted produces an `ALLOWED` record. `ALLOWED` does **not** mean every check has passed: it is a notice, sent before the policy-version read and the final clock and identity checks. What follows it is either a refusal from those checks (`STALE`, `EXPIRED`, `TIMEOUT`, `CLOCK_INVALID`, `SIGNER_CHANGED`, ...) or the signer's result: `SIGNED` (the signer returned a signature) or `SIGNER_ERROR` (it rejected, threw, or returned no `signedAuthEntry`; its own error is rethrown untouched). `SIGNED` therefore means a signature exists. The observer cannot change the outcome. A synchronous throw from it is swallowed. If it returns a promise (or any thenable), that is not awaited, so it cannot delay a payment, and its rejection is swallowed so it never becomes an unhandled rejection. It runs before the final clock and identity checks, so what it changes there is detected.

**Rejected before the policy is consulted.** An authorization that is not a single `transfer(from, to, amount)` matching the selected payment requirements (asset, destination, amount, network, no sub-invocations, `from` equal to the signer) is refused without calling `evaluate`. A CAP-71 preimage must be bound to the signer's own address.

**Signature check.** The hook only checks that the signer returned a non-empty `signedAuthEntry`; it does not verify the signature itself. That check comes from `@stellar/stellar-sdk`: `authorizeEntry` verifies the signature against sha256 of the preimage before it enters the transaction (verified in 16.3.0, the version this package requires). A signature over different bytes, or by a different key, never reaches the merchant; a test in this package pins that.

**What this does not do.** It is a check on the agent side, not account-level enforcement: code in the same process that holds the raw signer can still call it directly (the L02 limit in #96; so can code that replaces its `signAuthEntry`, which is looked up at call time), and nothing on-chain enforces the policy. It does not solve pending-capacity reservation (L01 in #96: concurrent requests that observe the same remaining capacity): two calls evaluated at the same time can each fit a limit that together they exceed, and an aggregate cap has to be held by your policy. Discussed in [#96](https://github.com/nirium-protocol/nirium/issues/96), where @CodeDeityX laid out the agent-side cases this hook is built against.

### MPP Charge (experimental)

```typescript
agent.initMpp({ secretKey: 'S...', mode: 'pull' }); // 'pull' (default) or 'push'

const response = await agent.mppFetch('https://your-mpp-server.example/resource');
```

`initMpp()` builds an MPP Charge client: the server answers `402` with a challenge, the client signs a USDC transfer on Stellar, and the server verifies and settles it. The network comes from the server's challenge, so `network` in the config is accepted but unused.

**Testnet: verified. Mainnet: not tested. Still experimental, not for production.**

- On 15 October 2026 (UTC) we paid Nirium's hosted **testnet** endpoint with this client (`nirium@0.16.1`), once in `pull` and once in `push` mode. Both settled on Stellar testnet and the server returned the resource: [`b8c4ed56…`](https://stellar.expert/explorer/testnet/tx/b8c4ed568f6eb41321b97d251d7f3727c57570a226d187e3675a9df03496e3ed) (pull), [`96d43d6f…`](https://stellar.expert/explorer/testnet/tx/96d43d6f4cf38fbd3a4df2c2bb6625e650c0d0509184d86c1e42c7e6ebdf242c) (push). The `402 Verification Failed` we saw on 1 October no longer reproduces.
- We have **not tested the mainnet endpoint** (it would spend real USDC), so we cannot tell you it works there.
- In `push` mode the payment settles on-chain before the server verifies it, so a request the server rejects is **not refunded**.
- For paid endpoints in production, use x402 (`initX402()`). The `get_mpp_*` tools of the MCP server were not re-tested.

### x402Serve(): Charging Your Own API

`initX402()` above lets you *pay* for someone else's API. This is the other side: charging for yours.

```typescript
import { x402Serve } from 'nirium';

app.use('/premium', x402Serve({
  payTo: 'G...',                 // your Stellar address - where payments land
  routes: { 'GET /signals': '$0.02' },
  facilitatorApiKey: '...',      // required on mainnet; OpenZeppelin Channels by default
}));
```

Runs on **your own server**, not Nirium's - `x402Serve()` is a client-side function you call from your own code; Nirium doesn't operate, host, or route through anything here, is never in the payment path, and never sees your end users' requests.

**Known limitation:** by default `x402Serve()` does not protect against replay and does not rate-limit callers. It is turned on by passing `guard` (see below).

#### Replay and rate-limit guard (optional)

Without `guard`, `x402Serve()` verifies and settles the payment and does nothing else. It does not stop the same signed payment from being sent twice, and it does not limit how often one caller can hit a route. Pass `guard` to get both:

- **Replay guard:** each payment proof can be used once per method and route (`replayTtlMs`, 15 minutes by default). A second use gets `409 payment_replayed`. If the request does not end in a 2xx, the claim is released, so a normal retry still works. If the store is down, the replay check refuses the request (`503`) instead of letting it through.
- **Rate limit:** optional, per caller IP (`req.ip`; set Express `trust proxy` if you run behind a proxy). Past `max` requests in `windowMs` the caller gets `429 rate_limited` with a `Retry-After` header. If the store is down, rate limiting lets traffic through.

The guard needs a store with three methods (`X402GuardStore`: `claimOnce`, `release`, `slidingWindowHit`). Two options:

```typescript
import { x402Serve, createUpstashX402GuardStore, type X402GuardStore } from 'nirium';

// Option 1: Upstash (Redis over REST). Shared between several servers.
const store = createUpstashX402GuardStore({
  url: process.env.UPSTASH_REDIS_REST_URL!,
  token: process.env.UPSTASH_REDIS_REST_TOKEN!,
});

// Option 2: your own store. This one lives in memory, so it only works for a
// single process. For more than one server, back the same three methods with a shared store.
function createMemoryGuardStore(): X402GuardStore {
  const claims = new Map<string, number>();                    // key -> expires at
  const hits = new Map<string, { t: number; member: string }[]>();
  return {
    async claimOnce(key, ttlMs) {
      const now = Date.now();
      if ((claims.get(key) ?? 0) > now) return false;
      claims.set(key, now + ttlMs);
      return true;
    },
    async release(key) { claims.delete(key); },
    async slidingWindowHit(key, windowMs, member) {
      const now = Date.now();
      const list = (hits.get(key) ?? []).filter((h) => h.t > now - windowMs);
      list.push({ t: now, member });
      hits.set(key, list);
      return list.length;
    },
  };
}

app.use('/premium', x402Serve({
  payTo: 'G...',
  routes: { 'GET /signals': '$0.02' },
  facilitatorApiKey: '...',
  guard: {
    store, // or createMemoryGuardStore()
    rateLimit: { max: 60, windowMs: 60_000 }, // optional
  },
}));
```

No in-memory store ships with the package, and you do not need Upstash: any store that implements the three methods works. The design comes from a real production integration by Edgadafi ([Edgadafi/remesa-liquidez](https://github.com/Edgadafi/remesa-liquidez)); see [issue #91](https://github.com/nirium-protocol/nirium/issues/91). The code here is ours. Thanks, Edgadafi.

**Usage telemetry - opt-in, off by default:** set `NIRIUM_X402SERVE_TELEMETRY=true` to send a small, non-blocking usage ping to Nirium - your `payTo` address, a SHA-256 hash of your `facilitatorApiKey` (never the key itself), network, route/request counts, and this SDK's version. It never blocks, delays, or fails a payment if the ping fails, times out, or isn't sent at all. Disabled by default since v0.14.0 - it's the only channel that would otherwise connect Nirium to how a specific integrator is using this locally-run function, and that isn't a decision this package should make for you.

**Compliance is yours.** `x402Serve()` is a general-purpose library, not a service Nirium provides to your end users. You choose what to charge for, who your `payTo` is, and which jurisdiction you operate in - you remain solely responsible for complying with the financial, tax, and consumer-protection laws that apply to your own use of it.

### Resilient WebSocket client

`ResilientSignalClient` is a WebSocket client for `/ws/signals` that reconnects by itself with backoff, pings to detect dead connections, and drops duplicate signals. Create it with `{ url, token }`, call `connect()`, and listen with `onSignal()`, `onStatus()` and `onError()`; `close()` stops it.

### Endpoint Access Model

| Access | Endpoints |
|---|---|
| **Public** (no key) | `health`, `loop/status`, `execute-demo`, `signals/recent`, `skills` list |
| **Protected** (API key) | `execute`, `market`, `loop/start\|stop\|scan`, `subscriptions`, `skills/install`, `webhooks` |
| **WebSocket** (JWT) | `/ws/signals` - real-time signal stream |
| **x402 Premium** | `/api/v1/premium/signals` ($0.02 USDC), `/api/v1/premium/market` ($0.05 USDC). `/premium/signals` only exists on testnet: on mainnet it answers `501` (no signal source there) and does not charge. `/premium/market` is paid on both networks. |
| **MPP Charge** | `/api/v1/mpp/signals`, `/api/v1/mpp/market` (testnet verified with settled payments on 15 Oct 2026, mainnet untested, see [MPP Charge](#mpp-charge-experimental)) |

### x402 Metrics: Observability Wrapper

Wrap your `x402Serve` handler with `x402Metrics` to get Prometheus-format counters, histograms, and revenue tracking - no changes to your payment logic.

```typescript
import express from 'express';
import { x402Serve, x402Metrics } from 'nirium';

const app = express();

const { handler, metricsHandler } = x402Metrics(
  x402Serve({
    payTo: 'G...',
    routes: { 'GET /signals': '$0.02' },
    facilitatorApiKey: 'oz_...',
  }),
);

app.use('/premium', handler);
app.get('/metrics', metricsHandler); // no payment required

app.listen(3000);
```

Scrape the endpoint with curl:

```bash
curl -s http://localhost:3000/metrics
```

Output:

```
# HELP x402_challenges_total Total402 payment challenges issued
# TYPE x402_challenges_total counter
x402_challenges_total{route="GET /signals"} 12
# HELP x402_verify_success_total Total successful payment verifications
# TYPE x402_verify_success_total counter
x402_verify_success_total{route="GET /signals"} 8
# HELP x402_verify_fail_total Total failed payment verifications
# TYPE x402_verify_fail_total counter
x402_verify_fail_total{route="GET /signals"} 2
# HELP x402_settle_success_total Total successful settlements
# TYPE x402_settle_success_total counter
x402_settle_success_total{route="GET /signals"} 8
# HELP x402_settle_fail_total Total failed settlements
# TYPE x402_settle_fail_total counter
x402_settle_fail_total{route="GET /signals"} 1
# HELP x402_infra_errors_total Total facilitator/infrastructure errors (5xx)
# TYPE x402_infra_errors_total counter
x402_infra_errors_total{route="GET /signals"} 1
# HELP x402_rejections_total Total403 rejections from protected-request hooks
# TYPE x402_rejections_total counter
x402_rejections_total{route="GET /signals"} 1
# HELP x402_revenue_total Revenue collected per route and asset
# TYPE x402_revenue_total counter
x402_revenue_total{route="GET /signals",asset="USDC"} 160000
# HELP x402_settlement_latency_seconds Request latency in seconds (approximate settlement time)
# TYPE x402_settlement_latency_seconds histogram
x402_settlement_latency_seconds_bucket{route="GET /signals",le="0.1"} 5
x402_settlement_latency_seconds_bucket{route="GET /signals",le="0.5"} 7
x402_settlement_latency_seconds_bucket{route="GET /signals",le="1"} 8
x402_settlement_latency_seconds_bucket{route="GET /signals",le="2.5"} 8
x402_settlement_latency_seconds_bucket{route="GET /signals",le="5"} 8
x402_settlement_latency_seconds_bucket{route="GET /signals",le="10"} 8
x402_settlement_latency_seconds_bucket{route="GET /signals",le="+Inf"} 8
x402_settlement_latency_seconds_sum{route="GET /signals"} 3.42
x402_settlement_latency_seconds_count{route="GET /signals"} 8
```

No payer addresses or PII are included in metrics output - aggregates only.

## Payouts

Batch disbursement, non-custodial: the node builds an **unsigned** transaction, you sign it with your own wallet and broadcast it. Nirium never holds funds and never sees your keys.

```typescript
const run = await agent.createPayoutRun({
  recipients: [{ wallet: 'GABC...', amount: '250.00' }],
  acknowledgeTerms: true,       // required on every network - 403 without it
});

const signedXdr = await signWithYourWallet(run.xdr);
const settled = await agent.submitPayout(run.runId, signedXdr);
console.log(settled.txHash, settled.cid);   // on-chain hash + IPFS receipt
```

Licensed for **independent service payments only** - contractors, freelancers, B2B. Not for subordinate-employee salary. Read `getPayoutTerms()` before integrating; classifying recipients and meeting tax and labor obligations is the client's responsibility.

Mainnet is invite-only during early access and additionally requires `clientInfo`.

## Treasury Rebalance

Two ways to rebalance a DeFindex vault between idle cash and an invested strategy. Neither is a swap - the contract's `rebalance()` exposes exactly two instructions, `Unwind` and `Invest`, and neither accepts a destination address, so withdrawing anywhere but back into the vault itself is not expressible.

### Propose: you review and sign, available to everyone today

The agent decides what it would do, using the same decision logic as the autonomous signer below, but it never signs. Public, no allowlist, no invite required - works for any vault where you're already the on-chain rebalance manager.

```typescript
const proposal = await agent.proposeTreasuryRebalance({
  vault: 'CABC...',
  caller: 'GABC...',   // must already be this vault's rebalanceManager on-chain
  enterAt: 2.5,        // your own mandate - Nirium never supplies a default here
  exitAt: 2.0,
});

if (proposal.instructions.length) {
  const signedXdr = await signWithYourWallet(proposal.xdr!);
  await agent.submitTreasuryTx(signedXdr);
} else {
  console.log('Nothing to propose:', proposal.reason);
}
```

### Autonomous: Nirium signs, invite-only during legal review

`executeTreasuryRebalance()` has Nirium sign and submit with its own RebalanceManager key - full autonomy, no per-cycle approval. **This is invite-only while a specific legal question stays open**: whether executing on a client's behalf without taking custody still counts as regulated facilitation under Mexican law. It only runs against vaults explicitly allowlisted server-side; calling it against any other vault returns 403, and Nirium's mainnet infrastructure returns 501 for it entirely, since that box holds no signing key by design. Ask if you want autonomous execution today - otherwise, `proposeTreasuryRebalance()` above gives you the same decision-making with you as the one who signs.

## Audit Trail

Anchor evidence to IPFS and get back a CID - an integrity seal, not notarization.

```typescript
const anchor = await agent.anchorAuditRecord({
  hash: 'sha-256:9f86d081...',   // hash of your own file or event
  tag: 'invoice-batch-jul',
});
console.log(anchor.cid);
```

Anchor a **hash** rather than the data itself: IPFS content cannot be deleted, so raw personal data would outlive any erasure request.

## Requirements

- Node.js >= 22.12.0. `@stellar/stellar-sdk` 16 and `@x402/stellar` 2.28 declare `>=22.0.0`, but stellar-sdk 16 depends on `@noble/hashes` 2.x, which is ESM-only, and this package is published as CommonJS: `require('nirium')` only works without a flag from Node 22.12.0 (on 22.11 it throws `ERR_REQUIRE_ESM`)
- TypeScript >= 5.0

## Links

- [Documentation](https://nirium.xyz/docs)
- [Developer Sandbox](https://nirium.xyz/sandbox)
- [GitHub](https://github.com/nirium-protocol/nirium)

## License

Apache 2.0 - Nirium Protocol
