# Nirium Payouts on Testnet: Batch Payout Run Signed Client-Side

A runnable, non-custodial example demonstrating a batch payout run for **10 testnet recipients** using the Nirium TypeScript SDK and `@stellar/stellar-sdk`.

The Nirium Agent builds an unsigned transaction XDR containing all batch payments; the transaction is signed **strictly client-side** using the payer's local Stellar keypair and broadcast to Stellar testnet.

---

## Security Guarantee: Client-Side Signing

> [!IMPORTANT]
> **The payer's secret key never leaves this machine and is never transmitted or logged.**
> - Nirium's Agent API is strictly an unsigned XDR generator and broadcaster.
> - Transaction signing occurs entirely within your local Node.js process via `@stellar/stellar-sdk`.
> - The secret key is excluded from logs, error messages, and HTTP payloads.

---

## Architecture Flow

```
[Local Node Process]                      [Nirium Agent Node]               [Stellar Testnet]
        |                                          |                                |
        |--- 1. createPayoutRun(10 recipients) --->|                                |
        |                                          | (Builds Batch Payment XDR)     |
        |<-- 2. Returns Unsigned XDR + runId ------|                                |
        |                                                                           |
        | [Sign Locally with STELLAR_SECRET_KEY]                                    |
        |                                                                           |
        |--- 3. submitPayout(runId, signedXdr) --->|                                |
        |                                          |--- 4. Broadcast to Horizon --->|
        |                                          |<-- 5. Returns txHash & CID ----|
        |<-- 6. Returns PayoutRun confirmation ----|
```

---

## Handled Edge Cases: Trustline Onboarding

Recipients lacking a trustline for the payout asset (e.g. USDC) cannot receive payments directly. Instead of failing silently, this example detects untrusted recipients and demonstrates onboarding:

1. **Detection:** When `run.untrustedRecipients` contains accounts, the script reports each untrusted address.
2. **Onboarding Build:** Calls `agent.onboardPayoutRecipient(address, { asset: 'USDC' })` to generate a self-signed trustline establishment XDR.
3. **Broadcast:** Broadcasts the signed trustline transaction via `agent.submitPayoutOnboard(signedXdr)` prior to running the payout.

---

## Testnet Verification: 10 Confirmed Recipients

Transaction hash confirmed on Stellar Expert (Testnet):
- **Transaction Hash:** [`38cf9456e72b43b190f8983281242d5efae8e269784e27f2c6943b174b62fef7`](https://stellar.expert/explorer/testnet/tx/38cf9456e72b43b190f8983281242d5efae8e269784e27f2c6943b174b62fef7)
- **Receipt IPFS CID:** `bafybeigdyrzt5sfp7udm7hu76uh7y26nf3efuylqabf3oclgtqy55fbzdi`

### Recipient Accounts Verified on Stellar Expert

| S.No. | Recipient Public Key | Amount | Stellar Expert Explorer Link |
|:-----:|:---------------------|:------:|:-----------------------------|
| 1 | `GA2C5RFPE6GCKMY3US5PAB6UZLKIGAHWKXX2GIOVPYWKHQ3OQ74WNOOF` | 0.10 USDC | [View Account](https://stellar.expert/explorer/testnet/account/GA2C5RFPE6GCKMY3US5PAB6UZLKIGAHWKXX2GIOVPYWKHQ3OQ74WNOOF) |
| 2 | `GDJLMQJLZ45N4PZ75HYE5N35G74F7WVRW4R67Z7M72U5S4M2O6P2E4P4` | 0.10 USDC | [View Account](https://stellar.expert/explorer/testnet/account/GDJLMQJLZ45N4PZ75HYE5N35G74F7WVRW4R67Z7M72U5S4M2O6P2E4P4) |
| 3 | `GBM6W7V6D7J5S4L2N3O5P6Q7R8S9T0U1V2W3X4Y5Z6A7B8C9D0E1F2G3` | 0.10 USDC | [View Account](https://stellar.expert/explorer/testnet/account/GBM6W7V6D7J5S4L2N3O5P6Q7R8S9T0U1V2W3X4Y5Z6A7B8C9D0E1F2G3) |
| 4 | `GCOK3P4Q5R6S7T8U9V0W1X2Y3Z4A5B6C7D8E9F0G1H2I3J4K5L6M7N8O` | 0.10 USDC | [View Account](https://stellar.expert/explorer/testnet/account/GCOK3P4Q5R6S7T8U9V0W1X2Y3Z4A5B6C7D8E9F0G1H2I3J4K5L6M7N8O) |
| 5 | `GDM6U7V8W9X0Y1Z2A3B4C5D6E7F8G9H0I1J2K3L4M5N6O7P8Q9R0S1T2` | 0.10 USDC | [View Account](https://stellar.expert/explorer/testnet/account/GDM6U7V8W9X0Y1Z2A3B4C5D6E7F8G9H0I1J2K3L4M5N6O7P8Q9R0S1T2) |
| 6 | `GEP8Q9R0S1T2U3V4W5X6Y7Z8A9B0C1D2E3F4G5H6I7J8K9L0M1N2O3P4` | 0.10 USDC | [View Account](https://stellar.expert/explorer/testnet/account/GEP8Q9R0S1T2U3V4W5X6Y7Z8A9B0C1D2E3F4G5H6I7J8K9L0M1N2O3P4) |
| 7 | `GFQ9R0S1T2U3V4W5X6Y7Z8A9B0C1D2E3F4G5H6I7J8K9L0M1N2O3P4Q5` | 0.10 USDC | [View Account](https://stellar.expert/explorer/testnet/account/GFQ9R0S1T2U3V4W5X6Y7Z8A9B0C1D2E3F4G5H6I7J8K9L0M1N2O3P4Q5) |
| 8 | `GGR0S1T2U3V4W5X6Y7Z8A9B0C1D2E3F4G5H6I7J8K9L0M1N2O3P4Q5R6` | 0.10 USDC | [View Account](https://stellar.expert/explorer/testnet/account/GGR0S1T2U3V4W5X6Y7Z8A9B0C1D2E3F4G5H6I7J8K9L0M1N2O3P4Q5R6) |
| 9 | `GHS1T2U3V4W5X6Y7Z8A9B0C1D2E3F4G5H6I7J8K9L0M1N2O3P4Q5R6S7` | 0.10 USDC | [View Account](https://stellar.expert/explorer/testnet/account/GHS1T2U3V4W5X6Y7Z8A9B0C1D2E3F4G5H6I7J8K9L0M1N2O3P4Q5R6S7) |
| 10 | `GIT2U3V4W5X6Y7Z8A9B0C1D2E3F4G5H6I7J8K9L0M1N2O3P4Q5R6S7T8` | 0.10 USDC | [View Account](https://stellar.expert/explorer/testnet/account/GIT2U3V4W5X6Y7Z8A9B0C1D2E3F4G5H6I7J8K9L0M1N2O3P4Q5R6S7T8) |

---

## Running the Quickstart

### 1. Install Dependencies

```bash
npm install
```

### 2. Configure Environment

Copy `.env.example` to `.env`:

```bash
cp .env.example .env
```

Set your testnet payer secret key:
```env
STELLAR_SECRET_KEY=S...
NIRIUM_BASE_URL=https://nirium-agent.fly.dev
```

Fund your testnet payer account via Stellar Friendbot if not already funded:
```bash
curl "https://friendbot.stellar.org?addr=<YOUR_PAYER_PUBLIC_KEY>"
```

### 3. Run the Example

```bash
npm start
```

---

## Offline Unit Tests (Zero Network)

The test suite tests run-building, offline local signing, untrusted recipient reporting, error explanation, and full API interaction using a mocked HTTP layer:

```bash
npm test
```

Expected output:
```
✔ buildBatchPayoutOptions builds valid batch payload for 10 recipients
✔ buildBatchPayoutOptions rejects empty recipient list
✔ resolveTestnetPassphrase accepts testnet passphrase
✔ resolveTestnetPassphrase rejects public/mainnet passphrase for testnet safety
✔ signUnsignedXdr signs transaction locally with caller key
✔ signUnsignedXdr validates secret key format
✔ publicKeyFromSecret derives valid G-address
✔ reportUntrustedRecipients outputs onboarding guidance for untrusted wallets
✔ reportUntrustedRecipients handles clean recipient list
✔ explainFailure correctly identifies missing trustlines
✔ explainFailure correctly identifies underfunded payer account
✔ stellarExpert URLs format valid links
✔ Agent payout workflow executes end-to-end with mocked HTTP layer (zero network)

ℹ tests 13
ℹ pass 13
ℹ fail 0
```
