# Unity game x402 pay-per-action gate

A minimal, standalone reference for gating one paid game action — here,
"reveal loot" — behind [x402](https://nirium.xyz/developers) micropayments on
Stellar, using nirium's `x402Serve()` on the backend and the [Stellar Unity
Developer Kit](https://github.com/towa-hi/StellarUnityDevToolkit) (SUDK) on
the client.

This is **not a fork of SUDK and does not modify it**. It's a small backend
plus one Unity C# script that a game built on SUDK can drop in as-is.

## What's here

| Path | What it is |
| --- | --- |
| [`src/server.ts`](src/server.ts) | Express app; `POST /api/v1/actions/reveal-loot` is protected by `x402Serve()`. |
| [`src/lootTable.ts`](src/lootTable.ts) | The paid action itself — deterministic loot draw, server-authoritative. |
| [`test/server.test.ts`](test/server.test.ts) | Network-mocked tests (facilitator calls mocked; no real network in CI). |
| [`scripts/wallet-bridge-smoke.ts`](scripts/wallet-bridge-smoke.ts) | Real end-to-end run against Stellar testnet — proves the protocol shape without a Unity Editor. |
| [`unity/PaidActionClient.cs`](unity/PaidActionClient.cs) | The Unity client: 402 → sign → retry, built on SUDK's real public API. |

## Why this needs no custody

The backend never holds player funds. `x402Serve()` only needs `payTo` — a
**public** Stellar address — plus a facilitator API key. There is no seller
secret key anywhere in this example, on disk or in an env var read by the
server. Settlement is wallet-to-wallet, direct from the player's Stellar
account to `payTo`, brokered by the OpenZeppelin Channels facilitator; the
backend finds out about payment only via the facilitator's verify/settle
responses. Losing this server (or its `.env`) exposes nothing but a
facilitator API key, which is scoped to relaying payment verification, not
to spending funds.

The game client is equally non-custodial: it only ever signs with the
player's own key (a local testnet keypair for desktop, or the player's own
Freighter wallet for WebGL). It never sees, holds, or transmits a server
secret, because there isn't one.

## The 402 → sign → retry flow

1. Unity `POST`s the action with no credential.
2. The server (via `x402Serve()`) answers `402 Payment Required`. The actual
   payment terms — `scheme`, `network`, `payTo`, `asset`, `amount`,
   `maxTimeoutSeconds` — are **not** in the JSON body (that's `{}`); they're
   base64-JSON in the **`payment-required` response header**. That's a
   real, verified detail of the wire protocol, not the body shape you'd
   guess from the spec alone — see the code comment in
   `test/server.test.ts` for how it was confirmed.
3. The client builds an unsigned Soroban `transfer(from, to, amount)`
   invocation against the requested asset contract (a
   [SEP-41](https://github.com/stellar/stellar-protocol/blob/master/ecosystem/sep-0041.md)
   token — USDC on testnet), simulates it, and signs the resulting Soroban
   authorization entry.
4. The client retries the same request with a `PAYMENT-SIGNATURE` header —
   **not** `X-PAYMENT`, which is the obsolete x402 v1 header name. The
   credential is the signed transaction envelope XDR, base64-JSON encoded,
   matching `@x402/stellar`'s own client scheme
   (`{ x402Version, payload: { transaction } }`).
5. The facilitator verifies and settles the payment on Stellar; the server
   only finds out it happened once the facilitator confirms it, then
   returns the unlocked loot JSON.

## SUDK API used, and the one real gap

Every SUDK symbol `PaidActionClient.cs` calls is read from the toolkit's
actual source, not guessed from its README:

- `StellarClient.SimulateContractFunction` — builds and simulates the
  `transfer` invocation.
- `SimulateTransactionResult.GetAuthorisationsRequired` /
  `.AddAuthorisationSignature` / `.ApplyTo` — SUDK's existing (and, for this
  use case, already purpose-built) helpers for pulling out the Soroban
  authorization entries a simulation needs signed, patching a raw signature
  back into one, and merging everything into a submittable transaction.
- `MuxedAccount.Sign(byte[])` — raw ed25519 signing over arbitrary bytes;
  this is desktop's SEP-43 `signAuthEntry` equivalent.
- `NetworkContext.signingMethod` / `.unityWalletSigner` — the same
  signing-method dispatch `StellarClient`'s own internals use
  (`SignAndEncodeTransaction` in `Core/StellarClient.cs`), reused here so
  this file needs no platform `#if` branches of its own.
- `WalletManager.SignTransaction` — wired into `unityWalletSigner` for a
  WebGL build (see `UnityWalletSignerFromWalletManager` at the bottom of the
  file); it bridges to Freighter's `signTransaction`.

**The real gap:** x402's "exact" scheme needs a signature over one Soroban
*authorization entry* (SEP-43 `signAuthEntry`). SUDK's WebGL bridge
(`WalletManager`, backed by `StellarClient.jslib`) only wraps Freighter's
`signTransaction(envelope, opts)` — there is no `signAuthEntry` bridge
method in the toolkit today (confirmed by reading `WalletManager.cs` and
`StellarClient.jslib` directly). This example works around it by handing
Freighter the *whole* transaction, already carrying the entry unsigned;
Freighter signs pending Soroban authorization entries for the connected
address as part of `signTransaction`, alongside the envelope. That's
documented Freighter behavior, not SUDK behavior — verify it against the
Freighter extension version your build targets before shipping, since this
example can't launch a WebGL build to confirm it. Desktop signing has no
such gap: `MuxedAccount.Sign` covers it exactly, and that path is proven
end to end by `scripts/wallet-bridge-smoke.ts` (see below).

## Running it

### 1. Install and configure

```bash
cd examples/unity-game-x402-gate
npm install
cp .env.example .env
```

Fill in `.env`:

- `X402_SELLER_ADDRESS` — a Stellar **public** key (G...) to receive
  payment. Public only; no secret involved.
- `FACILITATOR_API_KEY` — free testnet key from
  `GET https://channels.openzeppelin.com/testnet/gen` (open it in a browser,
  or `curl`; a `POST` here returns `401 Unauthorized`).
- `PLAYER_SECRET_KEY` — only needed for `wallet-bridge-smoke`, a throwaway
  testnet secret key that will actually pay. **Never use a mainnet key
  here.**

The player account needs a small amount of testnet USDC to actually settle
a payment:

1. Open the trustline: `Operation.changeTrust` to
   `USDC:GBBD47IF6LWK7P7MDEVSCWR7DPUWV3NY3DTQEVFL4NAT4AQH3ZLLFLA5` (the
   testnet USDC issuer, confirmed via stellar.expert's testnet contract
   lookup for `CBIELTK6YBZJU5UP2WWQEUCYKLPU6AUNZ2BQ4WWFEIE3USCIHMXQDAMA`,
   the SAC `x402Serve` charges through by default).
2. Fund it at the [Circle faucet](https://faucet.circle.com/) (network:
   Stellar) — this step is reCAPTCHA-gated and has to be done by a human in
   a browser; there's no API around it.

`X402_SELLER_ADDRESS` needs to be a real account too, not just a valid-looking
key: if you generate a fresh keypair for it (rather than pointing at an
already-funded account), it has to be created on-chain (friendbot) and given
the same USDC trustline above before it can receive the SAC transfer —
otherwise `wallet-bridge-smoke` fails simulation with `HostError: Error(Contract, #13)`
("trustline entry is missing for account").

### 2. Run the mocked test suite

```bash
npm test
```

No network leaves the process — every facilitator call is mocked (see the
header comment in `test/server.test.ts` for exactly which calls that
covers and how their shape was confirmed against real traced runs, not
assumed).

### 3. Run the real testnet smoke test

```bash
npm run wallet-bridge-smoke
```

This starts the real server in-process and drives it with the real
`nirium` x402 client against the real OpenZeppelin Channels testnet
facilitator and real Stellar testnet — the exact protocol shape a
SUDK-based Unity client needs to reproduce, provable without a Unity
Editor. On success it prints the unlocked loot and the settled Stellar
testnet transaction hash, with a direct stellar.expert link.

### 4. Unity

Copy `unity/PaidActionClient.cs` into a Unity project that already
references `com.scryingstone.stellar-sdk` and `com.scryingstone.stellar-wallet`
(SUDK's packages), configure a `NetworkContext` the same way the rest of a
SUDK-based game does, and call:

Both packages are required to compile this file, even if your project only
ever uses `SigningMethod.PrivateKey` — `com.scryingstone.stellar-wallet` is
referenced unconditionally (`using StellarWallet;`,
`UnityWalletSignerFromWalletManager`) regardless of which signing method you
actually use at runtime.

```csharp
var result = await PaidActionClient.RevealLootAsync(
    context,
    "https://your-server.example.com/api/v1/actions/reveal-loot",
    runNonce: System.Guid.NewGuid().ToString());

if (result.IsOk)
{
    Debug.Log($"Unlocked: {result.Value.loot.name} ({result.Value.loot.rarity})");
}
```

This file hasn't been run through a Unity compile pass — there's no Unity
Editor available in this environment. Every API it calls is verified
against SUDK's actual source (see the file's header comment for specifics),
but a real Editor compile is worth doing before merging into a game.

## Out of scope

Matches the parent issue: this does not modify SUDK, does not implement any
in-game token economy or NFT/item ownership, and targets testnet only.
