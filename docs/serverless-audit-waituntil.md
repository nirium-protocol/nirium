# Anchor Audit Trail Receipts from Serverless (Vercel `waitUntil`)

On a long-lived Node process you can fire `anchorAuditRecord()` after the
response and trust the event loop to finish the work. On **Vercel Functions**
(and similar serverless runtimes) that is not true: the isolate can freeze or
exit as soon as the HTTP response is sent, and a plain fire-and-forget promise
is aborted mid-flight. The paid client still got its 200; the CID never lands.

This guide shows the pattern that keeps the Audit Trail POST alive until it
settles: hash and sign synchronously, return the response, then schedule the
anchor with [`waitUntil`](https://vercel.com/docs/functions/functions-api-reference#waituntil) from `@vercel/functions`.

## What the Audit Trail actually does

Confirmed against `GET /api/audit/info` on the public nodes:

- The node anchors a **sha-256 hash** (or a small JSON `record`) to **IPFS** and
  returns a CID. It does **not** open a Stellar transaction for the anchor.
- The document's `network` field is set by **which box you called**
  (`stellar:testnet` on `https://nirium-agent.fly.dev`, `stellar:pubnet` on
  `https://nirium-agent-mainnet.fly.dev`). A `network` field in the request body
  is ignored.
- Pricing is **free during beta**, rate-limited. A Nirium API key is optional for
  this path; the TypeScript `Agent` constructor still requires an `apiKey`
  string field, so pass `process.env.NIRIUM_API_KEY ?? ''` (or omit the header
  and call `POST /api/audit/log` yourself).

Anchor a **hash**, not personal data: IPFS content cannot be deleted.

## Why fire-and-forget fails on serverless

```ts
// Fragile on Vercel: the isolate may freeze right after res.json(...).
void agent.anchorAuditRecord({ hash }).catch(console.warn);
res.status(200).json(payload);
```

Typical failure mode: the client receives the paid body, your logs show nothing
useful, and `GET` on the IPFS gateway never finds a CID. The work was scheduled
but never completed.

## Minimal pattern: hash → sign → respond → `waitUntil`

Install:

```bash
npm install nirium @stellar/stellar-sdk@16 @vercel/functions
```

```ts
import { createHash } from 'node:crypto';
import { waitUntil } from '@vercel/functions';
import { Keypair } from '@stellar/stellar-sdk';
import { Agent } from 'nirium';

const STATEMENT_PREFIX = 'nirium-audit-v1:';

function sha256Hex(text: string): string {
  return createHash('sha256').update(text, 'utf8').digest('hex');
}

function scheduleAnchor(task: Promise<unknown>): void {
  // Always attach a catch so a rejected anchor cannot become an unhandled
  // rejection, and so failures show up in platform logs.
  const tracked = task.catch((err: unknown) => {
    console.warn('[audit]', err instanceof Error ? err.message : String(err));
  });

  // Synchronous import of waitUntil: a dynamic import() after the response
  // can resolve too late on Vercel and the POST is aborted.
  waitUntil(tracked);
}

export async function handler(/* req */) {
  // Example paid response body — replace with your own. Hash this, not PII.
  const body = {
    ok: true,
    generatedAt: new Date().toISOString(),
    // market / route fields...
  };

  const hex = sha256Hex(JSON.stringify(body));
  const secret = process.env.AUDIT_SIGNER_SECRET;
  if (!secret) {
    // Prefer failing closed on attestation rather than anchoring unsigned by
    // accident. Adjust if you intentionally want unsigned anchors.
    throw new Error('AUDIT_SIGNER_SECRET is required');
  }
  const signer = Keypair.fromSecret(secret);
  const signature = Buffer.from(
    signer.sign(Buffer.from(`${STATEMENT_PREFIX}${hex}`, 'utf8')),
  ).toString('base64');

  const agent = new Agent({
    apiKey: process.env.NIRIUM_API_KEY ?? '',
    // Pick the box that matches the network you are operating on.
    baseUrl:
      process.env.NIRIUM_BASE_URL ?? 'https://nirium-agent.fly.dev',
  });

  // Return first. Anchoring must not delay or fail the paid response.
  const response = {
    statusCode: 200,
    headers: {
      'content-type': 'application/json',
      // Optional: let the client correlate the body with the later CID.
      'x-audit-hash': `sha-256:${hex}`,
    },
    body: JSON.stringify(body),
  };

  scheduleAnchor(
    agent.anchorAuditRecord({
      hash: `sha-256:${hex}`,
      tag: process.env.AUDIT_TAG ?? 'serverless-receipt',
      agent: {
        key: signer.publicKey(),
        signature,
        id: (process.env.AUDIT_AGENT_ID ?? 'api').slice(0, 64),
      },
    }).then((anchor) => {
      console.info('[audit] anchored', {
        cid: anchor.cid,
        contentSha256: anchor.contentSha256,
        gatewayUrl: anchor.gatewayUrl,
      });
    }),
  );

  return response;
}
```

### What each piece maps to in the SDK

| Piece | Source of truth |
| --- | --- |
| `Agent.anchorAuditRecord(options)` | `packages/sdk/src/index.ts` → `POST /api/audit/log` |
| `options.hash` | sha-256 hex, optionally with a `sha-256:` prefix |
| `options.tag` | free-form label |
| `options.agent.key` / `signature` / `id?` | ed25519 over utf8 `nirium-audit-v1:<content_sha256>` (64 lowercase hex, **no** `sha-256:` prefix inside the statement) |
| Return: `cid`, `contentSha256`, `gatewayUrl?`, `anchoredAt`, `attestedBy?` | `AuditAnchor` |

Invalid agent signatures are rejected with HTTP 400 and **nothing** is anchored.

## Error handling and logs

Keep anchoring failures off the critical path:

- Wrap the promise in `.catch(...)` **before** handing it to `waitUntil`.
- Log a short message and the CID on success; never log the signer secret or the
  full signature.
- Treat HTTP 429 from the node as back-pressure (free beta is rate-limited). Do
  not busy-retry inside the same invocation; drop or defer that receipt.
- Treat 5xx / network timeouts as retryable once if you want; treat 400 as a
  bug in your hash/signature construction (do not retry blindly).

A paid x402 response should still return `200` even when the anchor fails. The
receipt is an integrity seal, not a gate on delivery.

## Fallback when `waitUntil` is not available

Local Node, unit tests, and some hosts keep the process alive until the event
loop drains. On those platforms you can still schedule the same promise — just
skip `waitUntil`:

```ts
import { waitUntil } from '@vercel/functions';

function scheduleAnchor(task: Promise<unknown>): void {
  const tracked = task.catch((err: unknown) => {
    console.warn('[audit]', err instanceof Error ? err.message : String(err));
  });

  if (typeof waitUntil === 'function') {
    waitUntil(tracked);
    return;
  }

  // Outside Vercel: leaving the promise attached (with a catch) is enough for
  // a long-lived process. Do not replace this with an empty void without a
  // catch — failures become silent.
}
```

If you are not on Vercel at all, prefer awaiting the anchor in a background
worker / queue rather than pretending fire-and-forget is durable.

## Verify the receipt afterward (free)

Verification does not need a Nirium API key. After you have the CID (from logs,
or from a small hash→CID store you keep yourself):

1. Inspect node limits and disclaimer:

```bash
curl -s https://nirium-agent.fly.dev/api/audit/info
# mainnet box:
curl -s https://nirium-agent-mainnet.fly.dev/api/audit/info
```

2. Fetch the IPFS document and check `content_sha256` against your original hex:

```bash
curl -s "https://gateway.pinata.cloud/ipfs/<CID>"
```

3. Or use the CLI (hash-only anchors need `--hash` if you want the hash checked):

```bash
npx --yes nirium-cli verify <CID> --hash <64-lowercase-hex> --json
```

The CLI recomputes the signed statement as `nirium-audit-v1:<hash>` and verifies
the ed25519 signature against `agent.key`. See also
[`actions/verify-audit-cid`](../actions/verify-audit-cid) for the same model in CI.

## Environment variables

| Variable | Purpose |
| --- | --- |
| `AUDIT_SIGNER_SECRET` | Dedicated Stellar secret used **only** to sign audit statements. Never reuse a pay-to / treasury key. |
| `NIRIUM_BASE_URL` | Audit node (`https://nirium-agent.fly.dev` or `https://nirium-agent-mainnet.fly.dev`) |
| `NIRIUM_API_KEY` | Optional during free beta; still accepted by `Agent` |
| `AUDIT_TAG` / `AUDIT_AGENT_ID` | Optional labels on the anchored document |

Never commit real secrets. Use env vars / your platform's secret store only.

## Related

- SDK Audit Trail surface: [`packages/sdk/README.md`](../packages/sdk/README.md)
- Hash-only + signature verification in CI: [`actions/verify-audit-cid`](../actions/verify-audit-cid)
- x402 on Vercel (payment side, not audit): [`examples/deploy-x402-vercel`](../examples/deploy-x402-vercel)
