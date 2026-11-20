# IoT readings: signed by each sensor, anchored in batches

Simulated sensors each hold their **own ed25519 key** and sign every reading. A
gateway checks each signature, collects the readings into a batch file, keeps
that file locally, and every N minutes anchors **one receipt per batch**: the
SHA-256 of the batch file, signed with the gateway's Stellar key, with the
contributing sensors listed inside the file. `check-batch` verifies both layers.

Only the batch **hash** is anchored, never the readings (IPFS content cannot be
deleted). The batch files stay on this machine.

## What a receipt proves, and what it doesn't

A batch receipt (CID) proves two things:

- **The batch file hasn't changed since it was anchored.** `check-batch`
  recomputes the hash of the stored file and runs the existing
  `nirium verify <cid> --hash <sha256>`. Removing, adding or editing any reading
  changes the hash.
- **Who signed it.** The gateway signed `nirium-audit-v1:<sha256>` with its own
  Stellar key; `nirium verify` checks that signature against the public key.

The per-reading signatures add a second layer: each reading was signed by the
key pinned for that sensor, so an edited reading is **named**
(`<sensorId>#<seq>`), not just detected.

It does **not** prove:

- that a reading is **true**. A sensor can be miscalibrated, tampered with
  before it signs, or lying; the signature says only which key produced it;
- **when** the batch was anchored by any independent clock: `anchoredAt` is the
  Nirium node's clock, not a ledger time, and each reading's `ts` is the
  sensor's own claim;
- that the gateway did not drop readings *before* batching (a gap shows up as a
  missing `seq` for a sensor, but only if you look);
- anything about payments. This example anchors an off-chain record only.

## Layout

```
src/sensor.ts    ed25519 sensor: sign / verify a reading (node:crypto), seeded PRNG
src/canonical.ts canonical JSON, sha-256, the audit statement
src/gateway.ts   verify on ingest, write the batch file, anchor its hash (published SDK)
src/check.ts     check-batch: layer 1 (sensor signatures) + layer 2 (`nirium verify`)
src/store.ts     local storage: batches/, receipts.json, key registry
src/sim.ts       three simulated sensors (temp-a, humid-b, temp-c)
src/cli.ts       run | watch | check-batch <id> | receipts [--new-key]
test/            offline tests (HTTP mocked; no network)
```

A batch file (`.iot/batches/batch-0001.json`) holds the window, the gateway key,
the contributing sensors with their public keys, and the signed readings. Its
exact bytes are hashed.

How the checks resist tampering:

- Sensor keys are **pinned** in `.iot/registry.json` the first time a sensor is
  seen. `check-batch` verifies readings against the pinned key, never a key the
  batch file claims, so swapping a key inside the file is flagged.
- The gateway refuses unknown sensors, forged signatures and duplicates.
- Receipts use the SDK's `anchorAuditRecord()` only; no Nirium package is changed.

## Run it

Requires Node.js >= 22.12.0.

```bash
cd examples/build-iot-readings
npm install
cp .env.example .env
npm run receipts -- --new-key        # prints a fresh testnet keypair; secret goes in .env
npm run run-batches -- --batches 3   # 3 windows -> 3 batch files -> 3 receipts
npm run check-batch -- batch-0001    # both layers
npm test                             # offline
```

`run` uses a simulated clock (`--interval-min`, default 5): it generates one
reading per sensor per minute for each window and anchors immediately, so a demo
needs no waiting. `npm run watch` does the same on the real clock, one batch every
`IOT_INTERVAL_MIN` minutes.

Use **your own** `stellar:testnet` key (never one someone gave you) and never
commit it. The tag must start with `wave11-`. The testnet node is
`https://nirium-agent.fly.dev` (`POST /api/audit/log`, free, no API key). The
sensor keys here are generated for the simulation and kept in `.iot/`
(git-ignored); on a real device the private key never leaves the device.

## Evidence (testnet run, 2026-11-20)

Gateway key: `GB54HQYECYQEXFXSHEJREIVIY2DEYMOUJ2Q7YVI26SDBFPV3ECJIYCAB`, tag
`wave11-iot-readings`, sensors `temp-a`, `humid-b`, `temp-c` (5 readings each per batch).

| Batch | Readings | SHA-256 | CID |
|---|---|---|---|
| batch-0001 | 15 | `fbac8727f1d814ff5e9250cf7b232f14325b39512b1cc027ea7379081b0706cb` | `Qma5FSsQDvicYPjBZSSrHU8qPrNPVvj4tN7udsdELSSThL` |
| batch-0002 | 15 | `501275ac14f1baa2ffdc1f0414bd15273f8d3bd3577559dba0409a2eb745e227` | `QmPz64dZdmTc89nN8jzWg4jD1hVMWq8ZgboTLDp1btE9ZC` |
| batch-0003 | 15 | `8c93b46f73ba8ce869a6af65fe1e61ca1403adaa6a5f950eca11b83a1c9cb7f4` | `QmNeeg4UiXKXFuTpAdbif1ncpUwtZtSdJGhQejdJrb1Upw` |

Each one passes `nirium verify <cid> --hash <sha256>`; anyone can re-check with
`npx nirium-cli verify <cid> --hash <sha256>`. A passing check:

```
$ npm run check-batch -- batch-0001
CID:            Qma5FSsQDvicYPjBZSSrHU8qPrNPVvj4tN7udsdELSSThL
--------------------------------------------------
✔ HASH:        MATCH (fbac8727f1d814ff...) [hash-only]
✔ SIGNATURE:   VALID (Signed by GB54HQYECYQEXFXSHEJREIVIY2DEYMOUJ2Q7YVI26SDBFPV3ECJIYCAB)
   Statement:  nirium-audit-v1:fbac8727f1d814ff5e9250cf7b232f14325b39512b1cc027ea7379081b0706cb
   Agent ID:   iot-gateway
--------------------------------------------------
✅ VERIFICATION PASSED

layer 1 (sensor signatures): 15/15 valid
layer 2 (batch receipt):     recomputed fbac8727f1d814ff5e9250cf7b232f14325b39512b1cc027ea7379081b0706cb
                             anchored   fbac8727f1d814ff5e9250cf7b232f14325b39512b1cc027ea7379081b0706cb  verify OK

CHECK PASSED
```

### The tampered case

A copy of the store where one reading of `batch-0002` was edited after
anchoring (`humid-b#7`, 67.65 -> 82.65):

```
$ IOT_DIR=.iot_tampered npm run check-batch -- batch-0002
❌ HASH:        MISMATCH (Anchored: 501275ac14f1baa2ffdc1f0414bd15273f8d3bd3577559dba0409a2eb745e227, Yours (--hash/--evidence): 59d1002d480d6654d86de4dd6974d9f602fbe3157676aad9741a3c079c8022ca)
✔ SIGNATURE:   VALID (Signed by GB54HQYECYQEXFXSHEJREIVIY2DEYMOUJ2Q7YVI26SDBFPV3ECJIYCAB)
   Statement:  nirium-audit-v1:501275ac14f1baa2ffdc1f0414bd15273f8d3bd3577559dba0409a2eb745e227
   Agent ID:   iot-gateway
--------------------------------------------------
❌ VERIFICATION FAILED

layer 1 (sensor signatures): 14/15 valid
  BAD READING humid-b#7
layer 2 (batch receipt):     recomputed 59d1002d480d6654d86de4dd6974d9f602fbe3157676aad9741a3c079c8022ca
                             anchored   501275ac14f1baa2ffdc1f0414bd15273f8d3bd3577559dba0409a2eb745e227  verify OK -> FAILED

CHECK FAILED
```

(On Windows, `nirium-cli` also prints a libuv `Assertion failed ... UV_HANDLE_CLOSING`
line when it exits after a failed verify; it comes from the CLI's own process
exit, not from this example, and is omitted above.)

Note the receipt's gateway signature is still valid: it signs the *original*
hash, which is exactly why the recomputed hash is what fails.

## Tests

`npm test` (offline; the anchoring call is mocked and one test inspects the real
SDK request): a sensor's key verifies only its own readings; one receipt and one
stored file per batch with hash = file bytes; the node only receives
`hash`, `tag` and `agent`, never readings; forged, unknown and duplicate
readings are rejected; tag must start with `wave11-`; an untouched batch
passes; an altered reading fails and is named; a deleted reading keeps every
signature valid but fails the receipt; a swapped key inside the file is
flagged against the pinned registry.
