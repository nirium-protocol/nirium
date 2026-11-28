# Build with Nirium: energy smart grid over x402

Two simulated solar producers each run their own `x402Serve` routes and receive
payments at their own Stellar testnet address. A storage agent uses
`initX402()` to buy one kWh allocation from the cheapest producer each round.
Its daily-budget policy allows exactly the first three allocations and refuses
the next payment before signing.

This example is **testnet only**: no real funds, no mainnet, and no custody.
The storage key signs payments locally; the producers only receive them.

## Roles and keys

| Environment variable | Role |
|---|---|
| `SOLAR_EAST_SECRET` | East Ridge Solar producer; receives its own payments |
| `SOLAR_WEST_SECRET` | West Field Solar producer; receives its own payments |
| `STORAGE_SECRET` | Storage buyer; signs each x402 payment |

Every key must be different and must belong to you. The market checks that the
three public addresses are distinct before starting. Never use a key someone
gave you, share a secret, or commit `.env`.

## Run the testnet market

Requires Node.js >= 22.12.0. From this directory:

```bash
# Build the local Nirium SDK once (its dist/ output is git-ignored).
cd ../../packages/sdk
npm install --legacy-peer-deps
npm run build
cd ../../examples/build-energy-grid
npm install

# Generate three keys of your own. Add -- --fund to fund their XLM fee balances
# through Friendbot. The secrets are printed once; copy each to the matching
# variable in .env, then fund the storage account with testnet USDC.
npm run keys -- --fund
cp .env.example .env
# Set the three secret values and a testnet key from:
# https://channels.openzeppelin.com/testnet/gen

npm run market
```

Open the required testnet USDC trustlines and fund the storage account using
the current Stellar testnet USDC faucet before running. The market uses the
`stellar:testnet` x402 network only. Do not put secret keys in command-line
arguments, source files, or this README.

The command starts both local producer servers, runs three paid rounds, then
attempts a fourth purchase. Offer prices are deterministic:

| Round | East Ridge Solar | West Field Solar | Cheapest |
|---|---:|---:|---|
| 1 | $0.01 | $0.02 | East Ridge Solar |
| 2 | $0.03 | $0.015 | West Field Solar |
| 3 | $0.02 | $0.01 | West Field Solar |
| 4 | $0.01 | $0.01 | Tie-break: East Ridge Solar |

The first three payments total 0.035 USDC (USDC has seven decimal places).
That exactly uses the storage agent's daily budget; round 4 is denied by the
pre-sign policy, before the storage key signs anything. Each successful round
prints its testnet transaction hash and Stellar Expert link.

The budget is held in memory for this short demo. It resets when the process
restarts, and an `ALLOW` reserves budget before settlement. It is an example
policy, not a durable spending control.

## Offline tests

```bash
npm test
npm run typecheck
```

Tests need no network, testnet account, or funded keys. They check exact
seven-decimal price comparison, cheapest-producer selection and tie-breaking,
budget enforcement, and the SDK's real pre-sign gate with a signer spy proving
that an over-budget payment produces zero signature calls.

## Testnet evidence

The testnet transaction hashes must come from a run made with your own keys.
Paste the three payment hashes printed by `npm run market` here after running
the market; do not use fabricated, example, or someone else's hashes.

| Round | Producer | Transaction |
|---|---|---|
| 1 | East Ridge Solar | Pending owner-run testnet demo |
| 2 | West Field Solar | Pending owner-run testnet demo |
| 3 | West Field Solar | Pending owner-run testnet demo |

The denied round 4 must not have a transaction hash because the policy rejects
it before signing. Include a <=2 minute screen recording in the PR description
showing the market output. State in the PR whether the recording may be shared
on Nirium's channels, with credit to you.
