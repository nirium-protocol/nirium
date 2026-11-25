# IoT Readings: Multi-Sensor Signatures + One Audit Trail Receipt per Batch

Three simulated IoT sensors — each with its own ed25519 keypair — sign their readings locally. A gateway collects those readings over a window into a local batch file (including the contributing sensors manifest) and anchors **only the batch file's SHA-256 hash** to Nirium Audit Trail, signed with the gateway's own Stellar testnet key (`nirium-audit-v1:<sha256>`, tag `wave11-*`).

Raw telemetry readings remain on the local machine under `.batches/`; only `{ hash, tag, agent }` is sent to `POST /api/audit/log`. Later, `check-batch <batch-id>` verifies **both layers**:

1. **Sensor layer:** every reading's ed25519 signature against its sensor public key (plus the batch's contributing sensors manifest).
2. **Batch receipt layer:** recomputes the batch file's SHA-256 and delegates verification to the existing `npx nirium-cli verify <cid> --hash <sha256>`.

If any reading in a stored batch is altered, `check-batch` fails with a non-zero exit code and explicitly names the altered reading.

## What a receipt proves — and what it doesn't

A receipt (CID) proves two things:

- **The batch file hasn't changed since it was anchored.** `check-batch` recomputes the SHA-256 of the stored batch file bytes; any edit to any reading or manifest field produces a hash mismatch against the anchored CID.
- **Who signed the batch anchor.** The gateway signed `nirium-audit-v1:<sha256>` with its own Stellar key, and `nirium verify` validates that signature against the gateway's public key. (Inside the batch file, each reading also carries its sensor's ed25519 signature.)

It does **not** prove:

- **That the sensor readings are true.** A miscalibrated or spoofed sensor can sign inaccurate measurements before the gateway batches them. The receipt fixes what was recorded and who attested to it, not physical truth.
- **When the readings occurred by any independent ledger clock.** `anchoredAt` is the Nirium node's clock at anchoring time — **not** a Stellar ledger timestamp — and `recordedAt` inside each reading is self-reported by the sensor.
- **Anything about payments.** This example anchors off-chain telemetry batch records only.

## Layout

```text
src/sensor.ts   SimulatedSensor (ed25519 key per sensor), canonical JSON, reading verification
src/batch.ts    BatchFile schema, contributing sensors manifest, SHA-256 helpers
src/store.ts    local batch & receipt storage (.batches/, never committed)
src/gateway.ts  collect readings -> store batch locally -> anchor hash + gateway signature
src/check.ts    check-batch: layer-1 sensor signatures + layer-2 `nirium-cli verify`
src/cli.ts      run | check-batch <batch-id> | receipts [--new-key]
test/           offline unit tests (mocked HTTP; zero network calls)
```

## Run It

Requires Node.js `>=22.12.0`.

```bash
cd examples/build-iot-readings
npm install
cp .env.example .env
npm run receipts -- --new-key         # generate your own testnet keypair; put secret in .env
npm run run-batches                   # collects 3 multi-sensor batches -> 3 Audit Trail CIDs
npm run check-batch -- batch-001      # verifies all sensor signatures + `nirium-cli verify`
npm test                              # offline tests
npm run typecheck                     # tsc --noEmit
```

Use **your own** `stellar:testnet` key in `GATEWAY_SECRET_KEY` (never commit `.env` or any `S...` secret). Tags must start with `wave11-`. The testnet node is `https://nirium-agent.fly.dev` (`POST /api/audit/log`, free, no API key required).

## Evidence (testnet run, 2026-11-22)

Gateway key: `GAJWAGGUR4DYTM64UKDDD7DCQEBV2FM3A2B7ETZOTJSFOEB27X4CVWON`, tag `wave11-iot-readings`.

Contributing sensors (each with its own ed25519 key):
- `temp-bay-1` (`temperature_c`, `C`): `GDBGACI6SMFCEIF37SYFUJN4MR5HHMXKE63RGC7SYOOMBL2ZVTNC4PXC`
- `humidity-bay-2` (`relative_humidity_pct`, `%`): `GCPMJ53V45JZTC62UPRYZITV7PF4JNMN63NWGIKGB7ZP3BMIUI3ALFOG`
- `pressure-bay-3` (`barometric_hpa`, `hPa`): `GDJFNARKA3XDBJFWVNNMFRVZA3CROBEEV4SJFN2KTLCJTN56UQLKT77I`

| Batch | Readings | SHA-256 | CID | `anchoredAt` |
|---|---|---|---|---|
| `batch-001` | 3 (3 sensors) | `e68b2eafca6a24a27cd7075be2e74b69cf5f7821ab66ee7f282e3cf1ff87345e` | `QmdWyZSrQG44q5oyFxRN5r8U1RJWHLVW8nh5pWetirA59x` | `2026-11-22T19:23:34.960Z` |
| `batch-002` | 3 (3 sensors) | `b40c31911021d290b790ed405369ea564e2ebe53e48569720c616b8fa298a83a` | `QmTgX8M7zEmdvDxFmamK3FJQpLMtYXvEM1scbsCGEe5uPa` | `2026-11-22T19:23:36.973Z` |
| `batch-003` | 3 (3 sensors) | `243f068340a6b4c338e6a395ac3882e9d03b93e7d096302ef2e44f3171a5dcaf` | `QmdNBK2qrdwmBifE849bz2admWZmkDXqwjiM9QzDWHz9Kz` | `2026-11-22T19:23:38.885Z` |

### Passing `nirium-cli verify` outputs (all 3 CIDs)

```text
$ npx nirium-cli verify QmdWyZSrQG44q5oyFxRN5r8U1RJWHLVW8nh5pWetirA59x --hash e68b2eafca6a24a27cd7075be2e74b69cf5f7821ab66ee7f282e3cf1ff87345e
🔍 Nirium Audit Verifier
CID:            QmdWyZSrQG44q5oyFxRN5r8U1RJWHLVW8nh5pWetirA59x
--------------------------------------------------
✔ HASH:        MATCH (e68b2eafca6a24a2...) [hash-only]
✔ SIGNATURE:   VALID (Signed by GAJWAGGUR4DYTM64UKDDD7DCQEBV2FM3A2B7ETZOTJSFOEB27X4CVWON)
   Statement:  nirium-audit-v1:e68b2eafca6a24a27cd7075be2e74b69cf5f7821ab66ee7f282e3cf1ff87345e
   Agent ID:   iot-gateway
--------------------------------------------------
✅ VERIFICATION PASSED

$ npx nirium-cli verify QmTgX8M7zEmdvDxFmamK3FJQpLMtYXvEM1scbsCGEe5uPa --hash b40c31911021d290b790ed405369ea564e2ebe53e48569720c616b8fa298a83a
🔍 Nirium Audit Verifier
CID:            QmTgX8M7zEmdvDxFmamK3FJQpLMtYXvEM1scbsCGEe5uPa
--------------------------------------------------
✔ HASH:        MATCH (b40c31911021d290...) [hash-only]
✔ SIGNATURE:   VALID (Signed by GAJWAGGUR4DYTM64UKDDD7DCQEBV2FM3A2B7ETZOTJSFOEB27X4CVWON)
   Statement:  nirium-audit-v1:b40c31911021d290b790ed405369ea564e2ebe53e48569720c616b8fa298a83a
   Agent ID:   iot-gateway
--------------------------------------------------
✅ VERIFICATION PASSED

$ npx nirium-cli verify QmdNBK2qrdwmBifE849bz2admWZmkDXqwjiM9QzDWHz9Kz --hash 243f068340a6b4c338e6a395ac3882e9d03b93e7d096302ef2e44f3171a5dcaf
🔍 Nirium Audit Verifier
CID:            QmdNBK2qrdwmBifE849bz2admWZmkDXqwjiM9QzDWHz9Kz
--------------------------------------------------
✔ HASH:        MATCH (243f068340a6b4c3...) [hash-only]
✔ SIGNATURE:   VALID (Signed by GAJWAGGUR4DYTM64UKDDD7DCQEBV2FM3A2B7ETZOTJSFOEB27X4CVWON)
   Statement:  nirium-audit-v1:243f068340a6b4c338e6a395ac3882e9d03b93e7d096302ef2e44f3171a5dcaf
   Agent ID:   iot-gateway
--------------------------------------------------
✅ VERIFICATION PASSED
```

### Passing `check-batch` (both layers)

```text
$ npm run check-batch -- batch-001
Batch:      batch-001
CID:        QmdWyZSrQG44q5oyFxRN5r8U1RJWHLVW8nh5pWetirA59x
Readings:   3 checked, 0 failed
  PASS batch-001-r1 (temp-bay-1)
  PASS batch-001-r2 (humidity-bay-2)
  PASS batch-001-r3 (pressure-bay-3)

🔍 Nirium Audit Verifier
CID:            QmdWyZSrQG44q5oyFxRN5r8U1RJWHLVW8nh5pWetirA59x
--------------------------------------------------
✔ HASH:        MATCH (e68b2eafca6a24a2...) [hash-only]
✔ SIGNATURE:   VALID (Signed by GAJWAGGUR4DYTM64UKDDD7DCQEBV2FM3A2B7ETZOTJSFOEB27X4CVWON)
   Statement:  nirium-audit-v1:e68b2eafca6a24a27cd7075be2e74b69cf5f7821ab66ee7f282e3cf1ff87345e
   Agent ID:   iot-gateway
--------------------------------------------------
✅ VERIFICATION PASSED

recomputed e68b2eafca6a24a27cd7075be2e74b69cf5f7821ab66ee7f282e3cf1ff87345e
anchored   e68b2eafca6a24a27cd7075be2e74b69cf5f7821ab66ee7f282e3cf1ff87345e
CHECK PASSED
```

### Tampered batch case (fails & names the altered reading)

Editing `batch-002-r2` (`humidity-bay-2`) inside `.batches_tampered/batches/batch-002.json` after anchoring causes both layers to fail and explicitly names `batch-002-r2`:

```text
$ BATCH_DIR=.batches_tampered npm run check-batch -- batch-002
Batch:      batch-002
CID:        QmTgX8M7zEmdvDxFmamK3FJQpLMtYXvEM1scbsCGEe5uPa
Readings:   3 checked, 1 failed
  PASS batch-002-r1 (temp-bay-1)
  FAIL batch-002-r2 (humidity-bay-2) — invalid ed25519 sensor signature
  PASS batch-002-r3 (pressure-bay-3)

🔍 Nirium Audit Verifier
CID:            QmTgX8M7zEmdvDxFmamK3FJQpLMtYXvEM1scbsCGEe5uPa
--------------------------------------------------
❌ HASH:        MISMATCH (Anchored: b40c31911021d290b790ed405369ea564e2ebe53e48569720c616b8fa298a83a, Yours (--hash/--evidence): 2ccee468b205c070669cd3c9abcf220255b2915491a42bf852519a8378e48dd6)
✔ SIGNATURE:   VALID (Signed by GAJWAGGUR4DYTM64UKDDD7DCQEBV2FM3A2B7ETZOTJSFOEB27X4CVWON)
   Statement:  nirium-audit-v1:b40c31911021d290b790ed405369ea564e2ebe53e48569720c616b8fa298a83a
   Agent ID:   iot-gateway
--------------------------------------------------
❌ VERIFICATION FAILED

recomputed 2ccee468b205c070669cd3c9abcf220255b2915491a42bf852519a8378e48dd6
anchored   b40c31911021d290b790ed405369ea564e2ebe53e48569720c616b8fa298a83a
CHECK FAILED
ERROR: Reading batch-002-r2 (sensor humidity-bay-2) failed ed25519 verification: invalid ed25519 sensor signature
ERROR: Batch receipt verification failed for CID QmTgX8M7zEmdvDxFmamK3FJQpLMtYXvEM1scbsCGEe5uPa (recomputed 2ccee468b205c070669cd3c9abcf220255b2915491a42bf852519a8378e48dd6, anchored b40c31911021d290b790ed405369ea564e2ebe53e48569720c616b8fa298a83a)
exit code: 1
```

Out of scope: custom verifiers, Soroban registries, on-chain batching, x402 receipts, policy-decision receipts, escrow evidence, and reconciliation. No Nirium package is modified.
