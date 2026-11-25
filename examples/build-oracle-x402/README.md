# Autonomous oracle: write to Soroban, sell the data over x402 (testnet)

An agent that fetches a public data point, writes it to a Soroban contract with
its own key, and sells the latest on-chain value over an `x402Serve` route. A
buyer agent pays the route with `initX402` and checks the paid answer against
the contract state.

Testnet only: no real funds, no mainnet, no custody. Every key stays with
whoever owns it.

```
contract/        Soroban contract: stores value + ledger timestamp, writable only by the oracle key
src/weather.ts   Open-Meteo fetch + validation + fixed-point (1/100 degC)
src/contract.ts  read `latest` (free simulation) and sign/submit `set`
src/server.ts    x402Serve route that reads the contract at request time
src/buyer.ts     initX402 + x402Fetch, then compare the answer with the chain
src/cli.ts       keys | write | serve | buy | negative-test
test/            offline tests (fetch mocked; no network)
```

## How it works

1. **Contract** (`contract/src/lib.rs`): `init(oracle)` fixes the oracle key
   once (the oracle must authorise it). `set(value)` calls
   `oracle.require_auth()` on the stored key and stores `{ value, timestamp }`
   where `timestamp` is the **ledger close time**, not a time the caller
   claims. `latest()` returns the reading.
2. **Oracle** (`npm run oracle:write`): fetches the current temperature for
   Lagos, stores it as hundredths of a degree (28.2 C -> `2820`) and signs
   `set` with `ORACLE_SECRET`.
3. **Sell** (`npm run oracle:serve`): `GET /oracle/weather/latest` costs
   `$0.01` through `x402Serve`. The handler reads the contract when a paid
   request arrives, so the buyer pays for what the chain holds.
4. **Buy** (`npm run buyer`): `initX402({ secretKey })`, `x402Fetch`, then
   re-reads the contract and fails if value, timestamp or contract id differ.

## Data source

Weather data by [Open-Meteo](https://open-meteo.com/) (free, no API key),
licensed [CC BY 4.0](https://creativecommons.org/licenses/by/4.0/). No paid
data feeds are used. The paid answer carries the source name and license.

## Run it

Requires Node.js >= 22.12.0, Rust with the `wasm32v1-none` target and the
[Stellar CLI](https://developers.stellar.org/docs/tools/cli).

```bash
# 1. Own testnet keys (never use a key someone gave you; never commit them)
stellar keys generate my-oracle --network testnet --fund
stellar keys generate my-buyer  --network testnet --fund

# 2. Contract: test, build, deploy, fix the oracle key
cd contract && cargo test && stellar contract build
stellar contract deploy --wasm target/wasm32v1-none/release/oracle_feed.wasm \
  --source my-oracle --network testnet
stellar contract invoke --id <CONTRACT_ID> --source my-oracle --network testnet \
  -- init --oracle $(stellar keys address my-oracle)
cd ..

# 3. x402 needs a testnet USDC trustline on both accounts, and USDC for the buyer
stellar tx new change-trust --line USDC:GBBD47IF6LWK7P7MDEVSCWR7DPUWV3NY3DTQEVFL4NAT4AQH3ZLLFLA5 \
  --source-account my-oracle --network testnet
stellar tx new change-trust --line USDC:GBBD47IF6LWK7P7MDEVSCWR7DPUWV3NY3DTQEVFL4NAT4AQH3ZLLFLA5 \
  --source-account my-buyer --network testnet
# USDC for the buyer: https://faucet.circle.com (USDC, Stellar Testnet)

# 4. Configure and run
npm install
cp .env.example .env     # ORACLE_SECRET, BUYER_SECRET, ORACLE_CONTRACT_ID, FACILITATOR_API_KEY
npm run oracle:write     # fetch + write to the contract
npm run oracle:serve     # terminal 1
npm run buyer            # terminal 2: pays $0.01 and checks the contract
npm run negative-test    # a different funded key tries to write: must fail
npm test                 # offline
```

A free facilitator key comes from `https://channels.openzeppelin.com/testnet/gen`.

## Evidence (stellar:testnet, 2026-11-20)

| Item | Value |
|---|---|
| Contract ID | [`CDH26BSAU4AEPTVOQOW3X5XSOXSBEKB2UTD3JMFAOOFQTSQDNDLG6ZHL`](https://stellar.expert/explorer/testnet/contract/CDH26BSAU4AEPTVOQOW3X5XSOXSBEKB2UTD3JMFAOOFQTSQDNDLG6ZHL) |
| Oracle key (public) | `GBHLTJVYQEQAZODSOLP4T7BB2PQ4QAT3UEZSNJQAHKPFIWIGYAU5QSVU` |
| Buyer key (public) | `GC6BROR4USXYDKLEEVAEHODMJ2HHXINN2Q2VEZGJ56VQ4SKD7RMJSPXW` |

Transactions signed by these keys:

| Step | Transaction |
|---|---|
| Deploy | [`d824d66c...c8d42`](https://stellar.expert/explorer/testnet/tx/d824d66cb458faedccf071c4bc97584a1d0cd47413ac355766af9cba768c8d42) |
| `init(oracle)` | [`59e17cba...efbf8`](https://stellar.expert/explorer/testnet/tx/59e17cba0a537c3d20f9fcceea267ab4741fbde322fd8ea472fc8b121e1efbf8) |
| Oracle write #1 (28.2 C -> 2820) | [`33e0442f...5ca94`](https://stellar.expert/explorer/testnet/tx/33e0442fb7f72552e1f86cda320faaa212d7ccdbef2d1a59ca63d1242595ca94) |
| Oracle write #2 (28.2 C -> 2820) | [`a6466123...273bc`](https://stellar.expert/explorer/testnet/tx/a64661232eddf11b31789fdba68808a5cbfe360b8e29fdc6ff842ba9fdf273bc) |

### Negative test: a write from another key fails

A fresh Friendbot-funded key that is not the oracle submits `set(99999)`. The
transaction is recorded on testnet and **FAILED**
([`885417d1...624b4`](https://stellar.expert/explorer/testnet/tx/885417d1f05cabf557d52813dd1a8323d32cbec344025bb6af85eba4c12624b4)),
and the stored value did not change:

```
$ npm run negative-test
non-oracle key: GAKVGQIJBYIKHKJDXXUDMDA35GFUV2EAZ4PQGQTU2AEOYSICN3RDECHV
write rejected as expected:
transaction 885417d1f05cabf557d52813dd1a8323d32cbec344025bb6af85eba4c12624b4 ended with status FAILED
latest on chain is unchanged: 28.2 C
```

The same rule is covered offline in `contract/src/lib.rs` (a write authorised
by another address, or by nobody, returns an error and stores nothing).

### Paid read

<!-- PAID-READ-PENDING: paste the `npm run buyer` output and the settlement tx hash here -->

## What this does and doesn't prove

- The paid value equals the contract state at read time, and the contract
  timestamp is ledger time. Only the oracle key can change the value.
- It does **not** prove the weather reading is true: the oracle is trusted to
  copy Open-Meteo faithfully. A single-key oracle is a trust assumption.
- The route reads the *latest* value, which may be older than the real
  weather if the oracle has not written recently; check `timestamp`.

## Tests

`npm test` (offline, fetch mocked): weather parsing and fixed-point, the buyer's
chain check, the 402 challenge (price, network, `payTo`) with no value leaked
and no chain read before payment, and `x402Serve` config validation.
`cargo test` in `contract/`: write/read with timestamp, double `init`, read
before write, write from another key, write with no auth.
