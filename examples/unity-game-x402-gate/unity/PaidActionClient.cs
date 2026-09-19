// PaidActionClient.cs
//
// Reference pattern for calling an x402-gated game action from a Unity
// client built on the Stellar Unity Developer Kit (SUDK,
// https://github.com/towa-hi/StellarUnityDevToolkit). Every SUDK type and
// method referenced here (StellarClient, WalletManager, MuxedAccount,
// SimulateTransactionResult, NetworkContext, SCUtility) is read from the
// toolkit's actual public source — none are invented. This file is not part
// of SUDK and does not modify it; drop it into a project that already
// depends on `com.scryingstone.stellar-sdk` and `com.scryingstone.stellar-wallet`.
//
// Flow: POST the action with no credential -> read the 402's
// `payment-required` header (base64 JSON, matching Nirium's x402Serve()
// wire format) -> build the unsigned Soroban `transfer` invocation for the
// requested amount -> sign it -> retry with a PAYMENT-SIGNATURE header ->
// unlock the JSON result.
//
// Signing is dispatched through NetworkContext.signingMethod, exactly the
// mechanism StellarClient's own SignAndEncodeTransaction (Core/StellarClient.cs)
// uses: SigningMethod.PrivateKey signs locally; SigningMethod.UnityWallet
// calls context.unityWalletSigner(envelopeXdr, networkPassphrase), which the
// caller is expected to have wired up to WalletManager.SignTransaction for a
// WebGL build (see the bottom of this file for that wiring). This file does
// not call WalletManager itself, so it works unmodified on both platforms.
//
// A known SUDK API gap, and how this file works around it
// ----------------------------------------------------------
// x402's "exact" Stellar scheme needs a signature over one Soroban
// authorization entry (SEP-43 `signAuthEntry`), not a signature over a
// whole transaction. SUDK exposes exactly that primitive for desktop
// builds (`MuxedAccount.Sign(byte[])` signs arbitrary bytes), but its WebGL
// bridge (`WalletManager`, backed by StellarClient.jslib) only wraps
// Freighter's `signTransaction(envelope, opts)` — there is no
// `signAuthEntry` bridge method in the toolkit today. That is a real gap in
// SUDK's current public API, not an oversight in this file; verify against
// StellarDevToolkit/Packages/com.scryingstone.stellar-wallet before relying
// on it.
//
// This file handles that by asking Freighter to sign the *whole* built
// transaction (which already carries the unsigned auth entry after
// `SimulateTransactionResult.ApplyTo`). Freighter signs any pending Soroban
// authorization entry belonging to the connected address as part of
// `signTransaction`, in addition to the outer envelope — so SUDK's existing
// single bridge method is sufficient without modifying SUDK. That Freighter
// behavior is documented upstream by Freighter, not by SUDK; confirm it
// against the Freighter extension version your build targets before
// shipping, since this repo has no way to run a WebGL build to verify it.

using System;
using System.Collections.Generic;
using System.IO;
using System.Security.Cryptography;
using System.Text;
using System.Threading.Tasks;
using Newtonsoft.Json;
using Stellar;
using Stellar.RPC;
using StellarSDK;
using StellarWallet;
using UnityEngine;
using UnityEngine.Networking;

namespace Nirium.Examples.UnityGameX402Gate
{
    /// <summary>
    /// One loot item unlocked by a successful paid call, mirroring the
    /// backend's response shape (see src/lootTable.ts).
    /// </summary>
    [Serializable]
    public class LootEntry
    {
        public string id;
        public string name;
        public string rarity;
        public string flavorText;
    }

    [Serializable]
    public class RevealLootResponse
    {
        public bool ok;
        public string network;
        public string price;
        public LootEntry loot;
    }

    /// <summary>Decoded from the 402 response's base64 `payment-required` header.</summary>
    [Serializable]
    public class X402PaymentRequirement
    {
        public string scheme;
        public string network;
        public string amount;
        public string asset;
        public string payTo;
        public int maxTimeoutSeconds;
    }

    [Serializable]
    public class X402PaymentRequiredEnvelope
    {
        public int x402Version;
        public string error;
        public X402PaymentRequirement[] accepts;
    }

    public enum PaidActionStatusCode
    {
        Success,
        Http402MissingRequirements,
        UnsupportedPaymentScheme,
        SimulationFailed,
        NoAuthorizationRequired,
        WalletSigningFailed,
        HttpRequestFailed,
        UnexpectedStatus,
    }

    public readonly struct PaidActionResult
    {
        public PaidActionStatusCode Code { get; }
        public RevealLootResponse Value { get; }
        public string Message { get; }

        PaidActionResult(PaidActionStatusCode code, RevealLootResponse value, string message)
        {
            Code = code;
            Value = value;
            Message = message;
        }

        public bool IsOk => Code == PaidActionStatusCode.Success;

        public static PaidActionResult Ok(RevealLootResponse value) =>
            new PaidActionResult(PaidActionStatusCode.Success, value, null);

        public static PaidActionResult Err(PaidActionStatusCode code, string message) =>
            new PaidActionResult(code, null, message);
    }

    /// <summary>
    /// Calls one x402-gated game action end to end: 402 -> sign -> retry.
    /// Static, like <see cref="StellarClient"/> — construct nothing, just
    /// call <see cref="RevealLootAsync"/> with a configured
    /// <see cref="NetworkContext"/>.
    /// </summary>
    public static class PaidActionClient
    {
        /// <summary>
        /// Calls the reveal-loot action at <paramref name="actionUrl"/>, paying
        /// for it with an x402 "exact" Stellar payment if the server challenges
        /// with 402. Signing follows <paramref name="context"/>.signingMethod,
        /// same as the rest of SUDK: SigningMethod.PrivateKey needs
        /// context.userAccount loaded from a secret key; SigningMethod.UnityWallet
        /// needs context.unityWalletSigner wired up (see
        /// <see cref="UnityWalletSignerFromWalletManager"/> below) and the
        /// wallet already connected via <see cref="WalletManager.ConnectWallet"/>.
        /// </summary>
        public static async Task<PaidActionResult> RevealLootAsync(
            NetworkContext context,
            string actionUrl,
            string runNonce,
            StellarClientTask task = null)
        {
            using var _ = new StellarClientTask.Scope(task, "RevealLootAsync");

            // 1) First attempt, no payment — expect 402 with payment requirements.
            var first = await PostAction(actionUrl, runNonce, null, task);
            if (first.StatusCode == 200)
            {
                return ParseLootResponse(first.Body);
            }
            if (first.StatusCode != 402)
            {
                return PaidActionResult.Err(PaidActionStatusCode.UnexpectedStatus,
                    $"Expected 200 or 402 from {actionUrl}, got {first.StatusCode}: {first.Body}");
            }

            X402PaymentRequiredEnvelope requirements = DecodePaymentRequiredHeader(first.PaymentRequiredHeader);
            if (requirements?.accepts == null || requirements.accepts.Length == 0)
            {
                return PaidActionResult.Err(PaidActionStatusCode.Http402MissingRequirements,
                    "402 response carried no usable payment-required header.");
            }

            // Prefer an exact match on the context's configured network; fall
            // back to the first "exact" entry if the server only offered one.
            string expectedNetwork = context.isTestnet ? "stellar:testnet" : "stellar:pubnet";
            X402PaymentRequirement accepted =
                Array.Find(requirements.accepts, r => r.scheme == "exact" && r.network == expectedNetwork)
                ?? Array.Find(requirements.accepts, r => r.scheme == "exact");
            if (accepted == null)
            {
                return PaidActionResult.Err(PaidActionStatusCode.UnsupportedPaymentScheme,
                    $"No 'exact' payment option for network {expectedNetwork} in the server's 402 response.");
            }

            // 2) Build the unsigned `transfer(from, to, amount)` invocation on
            // the requested SAC (see SEP-41) — the same call nirium's own
            // TypeScript x402 client makes (see scripts/wallet-bridge-smoke.ts).
            NetworkContext paymentContext = context;
            paymentContext.contractAddress = accepted.asset;

            SCVal[] args = new SCVal[]
            {
                StellarClient.AccountStringToScvAddress(context.userAccount.AccountId), // from
                StellarClient.AccountStringToScvAddress(accepted.payTo),                // to
                ScValFromDecimalString(accepted.amount),                                 // amount (i128, base units)
            };

            var simResult = await StellarClient.SimulateContractFunction(paymentContext, "transfer", args, task: task);
            if (simResult.IsError)
            {
                return PaidActionResult.Err(PaidActionStatusCode.SimulationFailed, simResult.Message);
            }

            (Transaction unsignedTx, SimulateTransactionResult sim) = simResult.Value;

            // GetAuthorisationsRequired's parameter is a ledger-count offset,
            // not seconds — accepted.maxTimeoutSeconds is seconds (per x402's
            // wire format). Converted here the same way @x402/stellar's own
            // exact/client scheme does: seconds / estimated-ledger-close-time,
            // rounded up. ~5s/ledger is Stellar's typical close time; if this
            // example's expiration windows come out consistently too tight or
            // too loose in practice, fetch a live estimate instead (see
            // getEstimatedLedgerCloseTimeSeconds in @x402/stellar for the
            // reference: a rolling average over Horizon's most recent ledgers).
            const uint estimatedLedgerCloseSeconds = 5;
            uint ledgerExpirationRelativeMax =
                (uint)Math.Ceiling(accepted.maxTimeoutSeconds / (double)estimatedLedgerCloseSeconds);
            var authorizationsRequired = sim.GetAuthorisationsRequired(ledgerExpirationRelativeMax);
            if (authorizationsRequired.Count == 0)
            {
                return PaidActionResult.Err(PaidActionStatusCode.NoAuthorizationRequired,
                    "Simulation returned no Soroban authorization entries to sign — nothing to pay with.");
            }

            string networkPassphrase = Network.Current.NetworkPassphrase;
            string signedEnvelopeXdr;

            if (context.signingMethod == NetworkContext.SigningMethod.PrivateKey)
            {
                // Desktop: sign each required auth entry directly with the
                // account keypair (MuxedAccount.Sign signs arbitrary bytes —
                // exactly the SEP-43 signAuthEntry primitive).
                if (!context.userAccount.CanSign())
                {
                    return PaidActionResult.Err(PaidActionStatusCode.WalletSigningFailed,
                        "SigningMethod.PrivateKey requires a NetworkContext.userAccount loaded from a secret key.");
                }

                for (uint i = 0; i < authorizationsRequired.Count; i++)
                {
                    byte[] preimageBytes = EncodeHashIdPreimage(authorizationsRequired[(int)i]);
                    byte[] preimageHash;
                    using (var sha256 = SHA256.Create())
                    {
                        preimageHash = sha256.ComputeHash(preimageBytes);
                    }
                    byte[] signature = context.userAccount.Sign(preimageHash);
                    sim.AddAuthorisationSignature(i, context.userAccount.PublicKey, signature);
                }

                Transaction signedTx = sim.ApplyTo(unsignedTx);
                signedEnvelopeXdr = EncodeTransactionEnvelope(signedTx);
            }
            else if (context.signingMethod == NetworkContext.SigningMethod.UnityWallet)
            {
                if (context.unityWalletSigner == null)
                {
                    return PaidActionResult.Err(PaidActionStatusCode.WalletSigningFailed,
                        "SigningMethod.UnityWallet is selected, but NetworkContext.unityWalletSigner is not wired up "
                        + "(see UnityWalletSignerFromWalletManager at the bottom of this file).");
                }

                // WebGL: merge the (still-unsigned) authorization entries into
                // the transaction, then hand the whole envelope to the wallet
                // signer — which the caller is expected to have wired to
                // WalletManager.SignTransaction. See the file header for why
                // handing over the whole envelope, rather than a per-entry
                // signAuthEntry call SUDK does not expose, is the correct
                // bridge call here.
                Transaction mergedTx = sim.ApplyTo(unsignedTx);
                string unsignedEnvelopeXdr = EncodeTransactionEnvelope(mergedTx);

                Result<string> signResult = await context.unityWalletSigner(unsignedEnvelopeXdr, networkPassphrase);
                if (signResult.IsError)
                {
                    return PaidActionResult.Err(PaidActionStatusCode.WalletSigningFailed, signResult.Message);
                }
                signedEnvelopeXdr = signResult.Value;
            }
            else
            {
                return PaidActionResult.Err(PaidActionStatusCode.WalletSigningFailed,
                    $"Unhandled NetworkContext.SigningMethod: {context.signingMethod}");
            }

            // 3) Build the PAYMENT-SIGNATURE credential and retry. Shape
            // verified against @x402/stellar's exact/client scheme: the
            // credential is the full signed transaction envelope XDR, not a
            // bare signature blob.
            string credentialJson = JsonConvert.SerializeObject(new
            {
                x402Version = requirements.x402Version,
                payload = new { transaction = signedEnvelopeXdr },
            });
            string paymentSignatureHeader = Convert.ToBase64String(Encoding.UTF8.GetBytes(credentialJson));

            var second = await PostAction(actionUrl, runNonce, paymentSignatureHeader, task);
            if (second.StatusCode != 200)
            {
                return PaidActionResult.Err(PaidActionStatusCode.UnexpectedStatus,
                    $"Paid retry to {actionUrl} failed: {second.StatusCode} {second.Body}");
            }

            return ParseLootResponse(second.Body);
        }

        struct ActionHttpResult
        {
            public long StatusCode;
            public string Body;
            public string PaymentRequiredHeader;
        }

        static async Task<ActionHttpResult> PostAction(
            string url, string runNonce, string paymentSignatureHeader, StellarClientTask task)
        {
            var bodyJson = JsonConvert.SerializeObject(new { runNonce });
            using var request = new UnityWebRequest(url, "POST");
            byte[] bodyBytes = Encoding.UTF8.GetBytes(bodyJson);
            request.uploadHandler = new UploadHandlerRaw(bodyBytes);
            request.downloadHandler = new DownloadHandlerBuffer();
            request.SetRequestHeader("Content-Type", "application/json");
            if (!string.IsNullOrEmpty(paymentSignatureHeader))
            {
                request.SetRequestHeader("PAYMENT-SIGNATURE", paymentSignatureHeader);
            }

            var op = request.SendWebRequest();
            while (!op.isDone) await Task.Yield();

            return new ActionHttpResult
            {
                StatusCode = request.responseCode,
                Body = request.downloadHandler.text,
                PaymentRequiredHeader = request.GetResponseHeader("payment-required"),
            };
        }

        static X402PaymentRequiredEnvelope DecodePaymentRequiredHeader(string headerValue)
        {
            if (string.IsNullOrEmpty(headerValue)) return null;
            byte[] jsonBytes = Convert.FromBase64String(headerValue);
            string json = Encoding.UTF8.GetString(jsonBytes);
            return JsonConvert.DeserializeObject<X402PaymentRequiredEnvelope>(json);
        }

        static PaidActionResult ParseLootResponse(string body)
        {
            try
            {
                var parsed = JsonConvert.DeserializeObject<RevealLootResponse>(body);
                return parsed?.loot != null
                    ? PaidActionResult.Ok(parsed)
                    : PaidActionResult.Err(PaidActionStatusCode.UnexpectedStatus, $"Response carried no loot: {body}");
            }
            catch (JsonException ex)
            {
                return PaidActionResult.Err(PaidActionStatusCode.UnexpectedStatus, $"Failed to parse response: {ex.Message}");
            }
        }

        /// <summary>
        /// i128 SCVal from a base-10 string of the token's smallest unit
        /// (e.g. "200000" for $0.02 of 7-decimal USDC). Built directly from
        /// <see cref="Int128Parts"/> (hi/lo halves per the Stellar XDR spec)
        /// rather than via SCUtility.NativeToSCVal, which — verified against
        /// Serialization/SCUtility.cs — has no i128/BigInteger case; it only
        /// covers uint/int/ulong/string/bool/byte[]/Vector2Int/enums plus
        /// types registered through Register&lt;T&gt;().
        /// </summary>
        static SCVal ScValFromDecimalString(string amount)
        {
            System.Numerics.BigInteger value = System.Numerics.BigInteger.Parse(amount);
            if (value < 0 || value > (System.Numerics.BigInteger.One << 128) - 1)
            {
                throw new ArgumentOutOfRangeException(nameof(amount), $"amount {amount} does not fit in an unsigned 128-bit token quantity");
            }

            System.Numerics.BigInteger lo = value & ulong.MaxValue;
            System.Numerics.BigInteger hi = value >> 64;

            return new SCVal.ScvI128
            {
                i128 = new Int128Parts
                {
                    hi = new int64((long)(ulong)hi),
                    lo = new uint64((ulong)lo),
                },
            };
        }

        static byte[] EncodeHashIdPreimage(HashIDPreimage.EnvelopeTypeSorobanAuthorization preimage)
        {
            using var stream = new MemoryStream();
            var writer = new XdrWriter(stream);
            HashIDPreimageXdr.Encode(writer, preimage);
            return stream.ToArray();
        }

        /// <summary>
        /// Wraps a Transaction in a v1 TransactionEnvelope and encodes it to
        /// base64 XDR — mirrors StellarClient's own (private) EncodeTransaction
        /// helper (Core/StellarClient.cs) exactly, since a bare `Transaction`
        /// is not a valid envelope on its own and RPC/the facilitator expect an
        /// envelope. `signatures` is left empty: x402's "exact" scheme is
        /// authorized entirely by the signed Soroban authorization entry
        /// embedded in the invocation, not by an outer envelope signature —
        /// confirmed against @x402/stellar's exact/client scheme, which never
        /// calls a whole-transaction sign either.
        /// </summary>
        static string EncodeTransactionEnvelope(Transaction transaction)
        {
            var envelope = new TransactionEnvelope.EnvelopeTypeTx
            {
                v1 = new TransactionV1Envelope
                {
                    tx = transaction,
                    signatures = Array.Empty<DecoratedSignature>(),
                },
            };
            return TransactionEnvelopeXdr.EncodeToBase64(envelope);
        }

        /// <summary>
        /// Wires <see cref="NetworkContext.unityWalletSigner"/> to
        /// <see cref="WalletManager.SignTransaction"/> for a WebGL build.
        /// Call once when building the context, e.g.:
        /// <code>
        /// context.signingMethod = NetworkContext.SigningMethod.UnityWallet;
        /// context.unityWalletSigner = PaidActionClient.UnityWalletSignerFromWalletManager;
        /// </code>
        /// </summary>
        public static async Task<Result<string>> UnityWalletSignerFromWalletManager(
            string unsignedEnvelopeXdr, string networkPassphrase)
        {
            WalletResult<string> signResult = await WalletManager.SignTransaction(unsignedEnvelopeXdr, networkPassphrase);
            return signResult.IsOk
                ? Result<string>.Ok(signResult.Value)
                : Result<string>.Err(StatusCode.WALLET_NOT_AVAILABLE, signResult.Message);
        }
    }
}
