# Proof of delivery: the photo and details stay private, only the hash is public

At the door, the courier's app takes a photo and records the delivery details
— order id, time, and the location **rounded to about 1 km** — and keeps them
with the courier and the shop. It hashes the photo together with those details
and anchors only that **SHA-256 hash** to Nirium Audit Trail, signed with the
courier's own Stellar key. Later, the shop runs `check-delivery <order-id>
--photo <file>`: it hashes the photo it was given with the stored details and
runs the existing `nirium verify`. The original photo passes; any other photo,
or an edited time or place, fails.

Nothing about the delivery is published: no photo, no address, no exact
location, no order id. The node receives `hash`, `tag` and the courier's
signature, and nothing else.

## What a receipt proves — and what it doesn't

In plain words: the receipt is a sealed envelope with a date stamp on the
outside. It shows the evidence hasn't been swapped since it was sealed. It
can't show that what is inside the envelope is true.

A receipt (CID) proves:

- **The evidence wasn't edited later.** The hash of this exact photo plus
  these exact details was anchored at delivery time. If anyone later swaps the
  photo, changes one byte of it, or edits the time or location, the recomputed
  hash no longer matches and `check-delivery` fails.
- **Who sealed it.** The courier signed `nirium-audit-v1:<sha256>` with their
  own Stellar key, and `nirium verify` checks that signature.

It does **not** prove:

- **that the package really arrived**, or arrived at the right door, or that
  the right person got it. The courier could photograph a parcel on someone
  else's doorstep, or type a wrong order id. The receipt only fixes the
  courier's evidence in place; whether the evidence is honest is a separate
  question (signatures from the customer, disputes, reputation).
- **that the time or location are true.** They are what the courier's app
  stated. `anchoredAt` is the Nirium node's clock when the hash was anchored —
  it shows the evidence existed by then, not when or where the photo was taken.
- anything about payment — this example anchors an off-chain record only.

## What gets hashed

```json
{"deliveredAt":"2026-11-19T09:12:00Z","lat":40.71,"lon":-74.01,"orderId":"order-1001",
 "photoSha256":"<sha-256 of the photo bytes>","version":"proof-of-delivery-v1"}
```

Keys are sorted (canonical JSON) and the SHA-256 of that string is the only
value sent to the node. The location is rounded to 2 decimals before it is
stored or hashed, so even the private record doesn't hold the exact door.
Because the order id and time are inside the hash, the same photo can't be
reused as proof for a different order.

## Layout

```
src/record.ts    delivery record, rounding, canonical JSON, sha-256
src/delivery.ts  at the door: store photo + details privately, anchor hash + courier signature
src/store.ts     private storage shared by courier and shop (.deliveries/)
src/check.ts     check-delivery: re-hash the given photo + details, run `nirium verify`
src/photo.ts     generates small sample "doorstep photos" so the demo runs anywhere
src/demo.ts      three demo deliveries (made-up coordinates, not real addresses)
src/cli.ts       demo | deliver | check-delivery | receipts [--new-key]
test/            offline tests (HTTP is mocked; no network)
```

## Run it

Requires Node.js >= 22.12.0.

```bash
cd examples/build-proof-of-delivery
npm install
cp .env.example .env
npm run receipts -- --new-key        # prints a fresh testnet keypair; put the secret in .env
npm run demo                         # 3 deliveries -> 3 receipts
npm run check-delivery -- order-1001 --photo .deliveries/photos/order-1001.png
npm test                             # offline
```

To record a real delivery:
`npm run deliver -- <order-id> --photo door.jpg --lat <lat> --lon <lon>`.

Use **your own** `stellar:testnet` key and never commit it. The tag must start
with `wave11-`. The testnet node is `https://nirium-agent.fly.dev`
(`POST /api/audit/log`, free, no API key).

## Evidence (testnet run, 2026-11-19)

Courier key: `GAVJENJHFSRGUKKEI4X65IJJSZBCEKP57ADSGOGTBGBNWDTM7B7EVJRI`, tag `wave11-proof-of-delivery`.
The photos and delivery details are not published here — only the receipts.

| Order | SHA-256 | CID |
|---|---|---|
| order-1001 | `2a74ce2b605505b6c9c0578135bbba6579d6f50215d579a7bb35d29f4deb94ff` | `QmaxPe1uGu8UL8c1Nq1j46xRufut6frgk8VDiSexjdS5Qa` |
| order-1002 | `9f63fc755bcf179781143f896ff3287baf5067babab9c2ea9b8ed79fb9854ce4` | `QmY6gXCdsaqC25ASt7iEYgq6FNNsbqpJRMpFdPaPMyBRMK` |
| order-1003 | `332ff1c7e15e7474a747d4e0c9c63f8dc6819b5fafc20746f7021baa2223d0f3` | `QmRkZYuX4nn2fB2eqVqoAUGH87wmpxKYoTWPp5K4ND9aSG` |

Each one passes `nirium verify <cid> --hash <sha256>`. Anyone can re-check them
with `npx nirium-cli verify <cid> --hash <sha256>` — without ever seeing the photo.

The shop's check with the original photo:

```
$ npm run check-delivery -- order-1001 --photo .deliveries/photos/order-1001.png
🔍 Nirium Audit Verifier
CID:            QmaxPe1uGu8UL8c1Nq1j46xRufut6frgk8VDiSexjdS5Qa
--------------------------------------------------
✔ HASH:        MATCH (2a74ce2b605505b6...) [hash-only]
✔ SIGNATURE:   VALID (Signed by GAVJENJHFSRGUKKEI4X65IJJSZBCEKP57ADSGOGTBGBNWDTM7B7EVJRI)
   Statement:  nirium-audit-v1:2a74ce2b605505b6c9c0578135bbba6579d6f50215d579a7bb35d29f4deb94ff
   Agent ID:   courier-app
--------------------------------------------------
✅ VERIFICATION PASSED
```

The tampered case — the shop is handed a different photo for `order-1002`:

```
# a different photo handed to the shop for order-1002
$ npm run check-delivery -- order-1002 --photo different-photo.png
🔍 Nirium Audit Verifier
CID:            QmY6gXCdsaqC25ASt7iEYgq6FNNsbqpJRMpFdPaPMyBRMK
--------------------------------------------------
❌ HASH:        MISMATCH (Anchored: 9f63fc755bcf179781143f896ff3287baf5067babab9c2ea9b8ed79fb9854ce4, Yours (--hash/--evidence): 162d2432d56cf0beb3092203f6056e20d8e7e06f1b54dda46fd4de1fc7434bb8)
✔ SIGNATURE:   VALID (Signed by GAVJENJHFSRGUKKEI4X65IJJSZBCEKP57ADSGOGTBGBNWDTM7B7EVJRI)
   Statement:  nirium-audit-v1:9f63fc755bcf179781143f896ff3287baf5067babab9c2ea9b8ed79fb9854ce4
   Agent ID:   courier-app
--------------------------------------------------
❌ VERIFICATION FAILED

recomputed 162d2432d56cf0beb3092203f6056e20d8e7e06f1b54dda46fd4de1fc7434bb8
anchored   9f63fc755bcf179781143f896ff3287baf5067babab9c2ea9b8ed79fb9854ce4
CHECK FAILED
exit code: 1
```

(The signature is still valid — it signs the anchored hash — but the photo the
shop was given doesn't hash to it, so the check fails with a non-zero exit code.)

## Tests

`npm test` runs offline; the SDK's HTTP call is replaced by a mock that records
every request body:

- 3 deliveries produce 3 receipts, each signed by the courier key;
- the request bodies contain only `hash`, `tag` and `agent` — no order id,
  time, coordinates (exact or rounded), photo bytes or photo hash;
- only the rounded location is stored, never the exact one;
- `check-delivery` passes with the original photo and fails with a different
  photo, with a one-byte edit to the photo, and after the stored time is edited;
- the hash covers photo, order id, time and rounded location, independent of
  key order;
- tags outside `wave11-` are refused before anything is anchored.

Out of scope: verifiers, Soroban registries, on-chain batching, x402 receipts,
escrow or payment release. No Nirium package is changed.
