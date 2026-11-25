# rust-x402

Minimal Rust client for the **x402 v2** payment flow on **Stellar/Soroban**. Parses `payment-required` (402) challenges, signs a real Soroban `transfer` auth entry via ed25519, and retries with a `PAYMENT-SIGNATURE` credential.

Part of the [nirium](https://github.com/nirium-protocol/nirium) toolkit - the Rust surface parallel to the Go (#55) and TypeScript SDKs.

## Flow

1. `GET <protected-url>` → server responds `402` with a `payment-required` header (base64 JSON challenge).
2. Decode + validate the challenge (`x402Version: 2`, non-empty `accepts`).
3. Select the `exact` requirement for `stellar:testnet`.
4. Build an unsigned Soroban `InvokeHostFunction` (`transfer`) envelope sourced from the NULL account, **simulate** it via Soroban RPC to obtain the auth entries, **ed25519-sign** the payer's `ADDRESS`-credential auth entry over the `SorobanAuthorization` preimage hash, splice the signed auth + simulated resource fee back in, and **re-simulate** (the signature adds bytes, so the pre-signature resource fee is too low).
5. Retry the same request with `PAYMENT-SIGNATURE` header containing the base64-encoded payment credential.

The signing flow mirrors the canonical `@x402/stellar` client (and this repo's TypeScript/Python SDKs) end-to-end.

## Usage

```bash
# Set your Stellar testnet secret key (S-prefix)
export STELLAR_SECRET_KEY=S...

# Optional: override the Soroban RPC (defaults to testnet)
export STELLAR_RPC_URL=https://soroban-testnet.stellar.org

# Pay the live testnet endpoint
cargo run --release
```

The default target is Nirium's live testnet x402 endpoint:

```
GET https://nirium-agent.fly.dev/api/v1/premium/signals
```

Returns a real `402` with a `payment-required` header. No API key needed.

## Layout

```
src/
  lib.rs        // re-exports
  types.rs      // Challenge / Requirement / Payment / payment_header()
  signer.rs     // StellarSigner trait + EnvSigner (secret never leaked)
  client.rs     // X402Client - get() + pay() retry loop + PaymentReceipt
  error.rs      // X402Error enum
  main.rs       // runnable example
tests/
  integration.rs // 10 tests: parse, select, payment header roundtrip, mock signer, env signer
```

## Scope & limitations

- **x402 v2 only** - the `PAYMENT-SIGNATURE` header (not `X-PAYMENT` which is v1).
- **Stellar testnet** - `exact` scheme only.
- **Signing** uses official Stellar crates (`stellar-xdr` v27, `stellar-strkey`, `stellar-rpc-client` v27, `ed25519-dalek` v3) to build a real Soroban `TransactionEnvelope` auth entry with correct source account, fee, seq_num, and conditions.
- **Fees sponsored** - the exact scheme requires `areFeesSponsored: true`; the facilitator is the transaction source and pays the real fee. The client never spends a sequence number.

## Acceptance criteria (from GrantFox issue #40)

- [x] Parses `payment-required` header into structured challenge
- [x] Selects exact Stellar requirement for testnet
- [x] Builds and signs a real Stellar auth entry (ed25519 over `SorobanAuthorization` preimage)
- [x] Retries with `PAYMENT-SIGNATURE` payment credential
- [x] Env-configured secret key (`STELLAR_SECRET_KEY`); never logged (zeroized on drop)
- [x] Clear README + runnable binary
- [x] `cargo test` - 10/10 pass
- [x] `cargo clippy` - clean
- [x] No `unwrap()` on paths a malformed server response could hit
- [x] End-to-end testnet payment - tx hash on stellar.expert:
  - `16f7306420bfb6c4e9f6494230c852a22e98b9e278f1a9736d4a6a03a5ba5638` (ledger 4344232)
  - https://stellar.expert/explorer/testnet/tx/16f7306420bfb6c4e9f6494230c852a22e98b9e278f1a9736d4a6a03a5ba5638

## Dependencies

| Crate | Version | Purpose |
|-------|---------|---------|
| `stellar-xdr` | 27 | XDR types (`TransactionEnvelope`, `InvokeHostFunction`, `ScVal`, …) |
| `stellar-strkey` | 0.0.18 | `S…` secret seed / `G…` public key parsing |
| `stellar-rpc-client` | 27 | Soroban RPC (`simulate_transaction_envelope`, `get_latest_ledger`) |
| `ed25519-dalek` | 3 | ed25519 signing of the auth-entry preimage |
| `sha2` | 0.10 | SHA-256 of the `SorobanAuthorization` preimage |
| `reqwest` | 0.12 | HTTP client (rustls-tls + json) |
| `tokio` | 1 | async runtime |
| `zeroize` | 1 | secret is zeroized on `Drop` |

## References

- x402 spec: <https://github.com/nirium-protocol/nirium/blob/main/README.md>
- x402 v2 facilitator: <https://channels.openzeppelin.com/x402/testnet>
- USDC SAC (testnet): `CBIELTK6YBZJU5UP2WWQEUCYKLPU6AUNZ2BQ4WWFEIE3USCIHMXQDAMA`
- Dev docs: <https://nirium.xyz/developers>
