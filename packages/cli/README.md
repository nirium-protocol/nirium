# nirium-cli

Scaffold Stellar agent projects, including one that charges for itself.

```bash
npm install -g nirium-cli
```

Audit Trail receipts: anchor a sha-256 hash (optionally signed with ed25519) to IPFS, and anyone can independently verify it with `nirium verify` or at [nirium.xyz/verify](https://nirium.xyz/verify) - no account, no trust in this CLI's own output required.

## Anchor a record

```bash
nirium anchor --file evidence.json
nirium anchor --hash <64-hex-sha256>
nirium anchor --record '{"order":"A-12"}'
```

Anchors a sha-256 hash (or a small JSON object, up to 8KB) to IPFS via an
Audit Trail node's `POST /api/audit/log`, and prints back the CID.

- `--file <path>` computes the sha-256 of the file locally and sends only
  the hash - the file's contents are never uploaded. IPFS cannot delete
  anything once pinned, so hashing locally means raw evidence never
  leaves your machine.
- `--hash <hex>` sends a sha-256 you already have (64 hex chars, optional
  `sha-256:` prefix).
- `--record <json>` anchors a small JSON object verbatim (max 8KB,
  enforced here before the request, not just by the server). Don't put
  personal data in it - an anchored record can never be deleted.

Exactly one of the three is required. `--tx <hash>` and `--tag <label>`
are optional and attached to the anchor as-is. There is no `--network`
flag: the agent box anchoring the record decides its own network, and a
client-supplied network field is rejected server-side anyway.

| Option | Purpose | Default |
|---|---|---|
| `--file <path>` | anchor this file's sha-256 | none |
| `--hash <hex>` | anchor this sha-256 directly | none |
| `--record <json>` | anchor this small JSON object verbatim | none |
| `--tx <hash>` | associate a transaction hash | none |
| `--tag <label>` | free-form label | none |
| `--sign` | attach an ed25519 attestation of which key produced this anchor | off |
| `--key-env <VAR>` | env var holding the secret key to sign with (`--sign` only) | config store's `secretKey` |
| `-u, --url <url>` | agent URL | `https://nirium-agent.fly.dev` |
| `--json` | machine-readable result | off |

On success, prints the CID, the content hash, the gateway URL, and a
`nirium verify <cid>` suggestion so the anchor can be independently
re-checked right away.

### Attesting who produced an anchor

```bash
nirium config set secretKey          # hidden prompt, stored in ~/.niriumrc.json
nirium anchor --hash <64-hex> --sign
# or, without touching the config store:
NIRIUM_KEY=S... nirium anchor --hash <64-hex> --sign --key-env NIRIUM_KEY
```

The CID alone proves the anchored fact wasn't altered; `--sign` proves
*who* declared it. The secret key signs `nirium-audit-v1:<content_sha256>`
locally with ed25519 - only the resulting signature and the derived
public key (`G...`) ever leave this process, never the secret itself. If
the node rejects the signature, nothing is anchored (`400`, exit non-zero).
`nirium verify <cid>` independently re-checks it afterward and reports
`SIGNATURE: VALID` against the same public key.

## Verify an audit record

```bash
nirium verify <cid>
```

Independently re-checks a Nirium audit document anchored to IPFS: fetches
it from a gateway, recomputes its SHA-256 content hash, and, if the
document carries an agent attestation, verifies the ed25519 signature
over `nirium-audit-v1:<content_sha256>` against the declared signer's
Stellar public key. Nothing here trusts the document's own claims about
itself; both the hash and the signed statement are recomputed from the
raw content, not read off the document.

Hash-only anchors (no `record`, the recommended mode) have nothing to
recompute: the document's `content_sha256` is the hash you submitted. Pass
`--hash <hex>` or `--evidence <file>` to compare it with your own evidence;
without either, the hash is reported as NOT CHECKED (not as a mismatch)
and the signature is still verified over `nirium-audit-v1:<content_sha256>`.
Signatures are accepted as base64 or hex, raw ed25519 or SEP-53
(Freighter `signMessage`), like the anchoring node.

`-g, --gateway <url>` is repeatable and tried in order as fallbacks. A
`404` is retried on the *same* gateway up to `--retries` times with a
short backoff first - a fresh pin can take a moment to propagate, so a
404 there doesn't mean the CID is wrong, just not there *yet*. Any other
failure (a real error, or a timed-out request) moves straight to the
next gateway instead, since retrying the same one won't help.

With no `--gateway`, it tries Filebase's dedicated gateway, then Pinata,
then `ipfs.io`, then `dweb.link`. Shared public gateways often answer
`429` under load, so the dedicated one goes first:

```bash
nirium verify <cid> --gateway https://gateway.pinata.cloud --gateway https://ipfs.io --retries 3
```

| Option | Purpose | Default |
|---|---|---|
| `-g, --gateway <url>` | IPFS gateway to fetch from - repeat for fallbacks | `nirium.myfilebase.com`, then `gateway.pinata.cloud`, `ipfs.io`, `dweb.link` |
| `--retries <n>` | retries per gateway on a 404, with backoff | `2` |
| `--timeout <ms>` | per-request timeout | `8000` |
| `--json` | machine-readable result | off |
| `--hash <hex>` | expected evidence hash for a hash-only anchor (`sha-256:` prefix optional) | none |
| `--evidence <file>` | file whose SHA-256 is compared with the anchored hash | none |

If every gateway comes back 404 after exhausting retries, that's
reported as **NOT YET AVAILABLE** (`availability: "not_yet_available"`
in `--json`) - distinct from a hash mismatch, because nothing was
actually fetched to compare. A mix of real errors across gateways is
reported as a gateway error instead. Both exit non-zero, same as before.

Exits non-zero (and prints which check failed) if the hash doesn't match
or the signature doesn't verify. A pass also requires that at least one
of the two checks actually ran and succeeded, a matching `--hash`/
`--evidence`, a valid agent signature, or both. If both were skipped
(an unsigned hash-only anchor with no `--hash` or `--evidence`), nothing
was verified, so `verify` prints `NOTHING VERIFIED`, exits non-zero, and
sets `verified: false` in `--json`, instead of reporting a pass.

## Charge for your API in five minutes

```bash
nirium create x402 --name my-paid-api
cd my-paid-api && npm install
```

Fill two values in the generated `.env`:

| Variable | Where it comes from |
|---|---|
| `STELLAR_PAY_TO` | the Stellar account that receives payments (`G...`) |
| `X402_FACILITATOR_API_KEY` | free at [channels.openzeppelin.com/gen](https://channels.openzeppelin.com/gen) |

The API key is not optional. The facilitator rejects unauthenticated servers
on testnet as well as mainnet, so without it your routes never get as far as
offering a 402.

```bash
npm run dev
```

Everything under `/premium` now bills before it answers. A caller without
payment gets a 402 carrying the terms; one that pays gets the data, and the
transfer settles on Stellar before your handler returns. No subscription, no
card, no invoice, no human in the middle.

The generated server is about ten lines, because `x402Serve()` from the
[`nirium`](https://www.npmjs.com/package/nirium) SDK carries the facilitator
client, the scheme registration and the route shape.

**Usage telemetry (off by default):** `x402Serve()` sends Nirium nothing
unless you turn it on. If you set `NIRIUM_X402SERVE_TELEMETRY=true` in the
generated `.env`, it sends a small usage ping when the server starts and
again every 50 requests or 10 minutes: your `STELLAR_PAY_TO` address, the
network, the number of routes or requests, the SDK version, and a short hash
of your `X402_FACILITATOR_API_KEY` (the first 16 characters of its SHA-256,
never the key itself). The ping never blocks, delays or fails a charge, and
it does not authorize or gate anything. Leave the variable unset and nothing
is sent. (Checked against the real `dist/` shipped in `nirium` 0.19.0 - same behavior as before, only the version citation was stale.)

## Listen to protocol signals

```bash
nirium create bot --name my-agent          # TypeScript
nirium create bot --name my-agent -t py    # Python
```

Scaffolds a project that connects to a Nirium agent and prints incoming
signals, which the autonomous loop produces on testnet. Defaults to `https://nirium-agent.fly.dev` (testnet); set
`NIRIUM_API_URL` and `NIRIUM_API_KEY` in `.env` to point somewhere else.

## Pay an x402 endpoint from the terminal

```bash
NIRIUM_SECRET_KEY=S... nirium pay https://your-api.example.com/premium/signals
```

Signs and settles a real x402 payment against any endpoint that returns a
402, then prints the response. No scaffolding involved. This hits a live
server directly, useful for testing a `nirium serve` instance or someone
else's paid API without writing a client.

Exits 0 only when the request after payment succeeds (`response.ok`); a
4xx or 5xx is printed and reported as a failure, in text and `--json`, and
exits 1. The response payload is still printed either way, so you can see
what the server said.

There is no `--secret` flag: a key passed as a command-line argument sits
in your shell history and in `ps`'s full command line for anyone else on
the machine to read. There are three safe ways to give
it the key: set `NIRIUM_SECRET_KEY`; run `nirium config set secretKey` with
no value (a terminal asks for the key without showing it, or you can pipe
it in through stdin) to save it once; or leave it unset and a terminal
prompts for it each time. `nirium config set secretKey S...` with the key
on the command line is refused and nothing is saved.

| Option | Purpose |
|---|---|
| `-n, --network <network>` | `stellar:testnet` (default) or `stellar:pubnet` |
| `--max-amount <usd>` | Refuse to pay more than this, e.g. `5` or `$0.50`. Rejects zero, negative and non-numeric values before any network call |
| `--json` | Machine-readable result: status, duration, payer, tx hash, response body |

`--max-amount` is compared in the units of whatever asset the server asks
for, not converted. `"$5"` is 5 dollars only when the payment is in a
dollar-pegged asset such as USDC, which is what Nirium's own endpoints
charge in.

The secret key never leaves your machine except as a signature: the CLI
signs locally and sends the signed payment, not the key itself. Missing a
secret key fails immediately with the three ways to supply one, before any
network call happens.

## Spin up a local x402 test server

```bash
FACILITATOR_API_KEY=<facilitator-key> nirium serve --pay-to G...
# or just `nirium serve --pay-to G...` in a terminal: it asks for the key with a hidden prompt
```

A one-command x402 server for testing `nirium pay` (or any x402 client)
against, without scaffolding a whole project. Same facilitator requirement
as `create x402`: get a free key at
[channels.openzeppelin.com/gen](https://channels.openzeppelin.com/gen).

| Option | Values | Default |
|---|---|---|
| `-P, --pay-to <address>` | Stellar `G...` address that receives payments | required |
| `-p, --price <price>` | e.g. `$0.02` | `$0.02` |
| `-port, --port <port>` | | `3000` |
| `-r, --route <route>` | path to protect | `/api/v1/data` |
| `-n, --network <network>` | `stellar:testnet` or `stellar:pubnet` | `stellar:testnet` |

There is no `--api-key` flag: a key passed as a command-line argument sits in
your shell history and in `ps`. The facilitator key comes from
`FACILITATOR_API_KEY`, from `nirium config set facilitatorApiKey` (hidden
prompt), or from a hidden prompt when `serve` runs in a terminal. `--pay-to`
can also come from `nirium config set payTo`.

## Check an agent

```bash
nirium status --url https://nirium-agent.fly.dev
```

Calls the `/health` endpoint of an agent and prints whether it is running
and for how long. It also prints a version and a network line, but they only
carry a value when the agent reports one: the Nirium testnet agent's
`/health` returns just `status`, `service` and `uptime` today, so those two
lines are omitted rather than shown as `undefined`. `--url` points to the
agent you want to check; it defaults to `https://nirium-agent.fly.dev`,
the Nirium testnet agent, so this works out of the box with no agent of
your own running anywhere.

Exits 0 only when `/health` answers 2xx; exits 1 if the agent is
unreachable, times out, or answers with anything else.

| Option | Purpose | Default |
|---|---|---|
| `-u, --url <url>` | Agent to check | `https://nirium-agent.fly.dev` |
| `--json` | The raw `/health` fields plus `ok` | off |
| `--timeout <ms>` | Give up after this many milliseconds instead of hanging | `5000` |

## Diagnose your x402 setup

```bash
nirium doctor --network testnet
```

Five checks against your actual environment before you find out the hard
way in production: `payTo` is a well-formed public key (not a secret key
pasted in the wrong field, a real mistake this catches), the facilitator
API key authenticates against `channels.openzeppelin.com`, the Soroban RPC
endpoint for your target network is reachable, `STELLAR_SECRET_KEY` (if
set) is validly formatted, and MPP config (if set) is internally
consistent. The MPP check only validates the values in your config; Nirium
does not charge MPP payments on mainnet today. Reads from `.env` in the current directory by default.

| Option | Purpose |
|---|---|
| `-n, --network <network>` | `testnet` (default) or `pubnet` |
| `-c, --config <path>` | custom `.env`/config path |
| `--seller <url>` | validate a remote x402 seller without paying |
| `--json` | machine-readable report for CI |

Exits non-zero if any check fails, so it's usable as a CI gate ahead of a
deploy.

### Check a remote seller

```bash
nirium doctor --seller https://your-api.example.com/premium/signals
nirium doctor --seller https://your-api.example.com/premium/signals --json
```

`--seller` does not read `.env` and does not run the local checks above. It
also does not pay: the probe is a `GET` plus an `OPTIONS` preflight, and it
never sends `PAYMENT-SIGNATURE`.

Each line is pass or fail:

| Check | Pass means |
|---|---|
| `challenge` | HTTP 402 with a decodable `PAYMENT-REQUIRED` header (base64 JSON, or raw JSON) |
| `network` | every `accepts[]` entry has a well-formed network (`stellar:testnet`, `stellar:pubnet`, or another CAIP-2 id) |
| `asset` | present; on Stellar, the SAC contract id (`C...`), not a symbol like `USDC` |
| `amount` | a positive integer string in atomic units (`"1000000"`, not `"$0.02"`) |
| `payTo` | present; on Stellar, a valid `G...` public key. A secret (`S...`) fails |
| `resource-url` | `resource.url` is `https://`. `http://` fails even if you probed `http://127.0.0.1` |
| `cors-preflight` | `OPTIONS` from a random `*.invalid` origin returns 2xx and allows that origin |
| `cors-expose` | the 402 response exposes `PAYMENT-REQUIRED` and `PAYMENT-RESPONSE`. Headers listed only on the preflight do not count |
| `cors-allow` | `PAYMENT-SIGNATURE` is listed in `Access-Control-Allow-Headers` |

`--json` prints the same report (`ok`, `seller`, `network`, `checks`) for CI.

## Reporting: summaries and exports

```bash
nirium report summary [--from <date>] [--to <date>] [--network <testnet|mainnet>] [--json]
nirium report export anchors|payments|payroll [--from <date>] [--to <date>] [--limit <n>] [--csv out.csv] [--json]
```

Thin client for the Reporting node's `GET /api/reporting/summary` and
`GET /api/reporting/export` - an aggregation layer over what the
protocol has already anchored (payroll runs, x402/MPP receipts, IPFS
anchors). **This is institutional-format output, not certified
regulatory reporting** - anything filed with an authority remains the
caller's own responsibility (the server's own disclaimer is reprinted in
both commands' output).

`report summary` prints settled payroll runs and totals, payment
receipts by gateway, and anchor counts for the period. `report export
<type>` pulls the underlying rows:

- Without `--csv`, rows print one per line on stdout. For `export
  anchors`, each line is the anchor's date and network, tab-separated.
  There is no CID: the public Reporting export doesn't return them (an
  anchor's CID belongs to whoever made it). If you anchored something,
  you already have its CID - check it with `nirium verify <cid>`.

  The row count and disclaimer print to **stderr**, not stdout.
- With `--csv <file>`, the server's CSV is written to that file instead
  (nothing on stdout but a confirmation).
- `--json` prints the full response (`type`, `period`, `rowCount`,
  `rows`, `disclaimer`) instead of one row per line; mutually exclusive
  with `--csv`.

| Option (both subcommands) | Purpose | Default |
|---|---|---|
| `--from <date>` / `--to <date>` | ISO date period | 30-day window |
| `--network <testnet\|mainnet>` | restrict to one network | all |
| `-u, --url <url>` | agent URL | `https://nirium-agent.fly.dev` |
| `--json` | machine-readable full response | off |

| Option (`export` only) | Purpose | Default |
|---|---|---|
| `--limit <n>` | max rows (server caps at 1000) | server default |
| `--csv <file>` | write the CSV export here instead of printing rows | off |

## Manage stored credentials

```bash
nirium config set secretKey        # hidden prompt; or pipe it: ... | nirium config set secretKey
nirium config set facilitatorApiKey  # same: never as an argument
nirium config list
nirium config get payTo
nirium config delete facilitatorApiKey
```

Stores `secretKey`, `payTo`, `network`, and `facilitatorApiKey` in
`~/.niriumrc.json` (mode `600`) so `pay`, `serve`, and `doctor` don't need
them repeated on every invocation. Command-line flags and environment
variables still take priority when present. `list` and `get` mask secret
values in their output; the raw file is never printed.

## Options

| Option | Values | Default |
|---|---|---|
| `-n, --name <name>` | project directory name | `nirium-bot-v1` |
| `-t, --template <template>` | `ts` or `py` (`bot` only) | `ts` |

## Links

- [nirium.xyz](https://nirium.xyz)
- [TypeScript SDK](https://www.npmjs.com/package/nirium) · [Python SDK](https://pypi.org/project/nirium/)
- [Source and examples on GitHub](https://github.com/nirium-protocol/nirium)

## License

Apache 2.0, Nirium Protocol
