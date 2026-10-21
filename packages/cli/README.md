# nirium-cli

Scaffold Stellar agent projects, including one that charges for itself.

```bash
npm install -g nirium-cli
```

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
is sent. (Checked against the code of `nirium` 0.16.0.)

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
| `-a, --amount <amount>` | Override the price the server advertises |
| `--json` | Machine-readable result: status, duration, payer, tx hash, response body |

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
lines show `undefined`. `--url` points to the agent you want to check; `https://nirium-agent.fly.dev` is the Nirium testnet agent.
Without `--url` it looks for an agent on your own machine at
`http://localhost:3001`, so it reports "unreachable" if you are not running
one.

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

| Option | Purpose | Default |
|---|---|---|
| `-g, --gateway <url>` | IPFS gateway to fetch from | `https://gateway.pinata.cloud` |
| `--json` | machine-readable result | off |
| `--hash <hex>` | expected evidence hash for a hash-only anchor (`sha-256:` prefix optional) | none |
| `--evidence <file>` | file whose SHA-256 is compared with the anchored hash | none |

Exits non-zero (and prints which check failed) if the hash doesn't match
or the signature doesn't verify.

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
