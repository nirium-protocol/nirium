# Design FAQ

Short answers to the questions people ask most about how Nirium is built, and
where its limits are. For evidence with tx hashes, see
[`EVIDENCE.md`](../EVIDENCE.md). For a ten-minute check, see
[`FOR-REVIEWERS.md`](FOR-REVIEWERS.md).

## What does a receipt prove that the Stellar ledger doesn't?

For the payment itself, nothing. A Stellar transaction already proves who paid
whom, which asset and how much, that the payer authorized it with their
signature, and that it settled in a given ledger at a given time. Nobody can
change it afterwards, and anyone can read it from any node. A classic payment
can also carry a memo: up to 28 bytes of text, or a 32-byte hash. A Soroban
payment, which is how x402 settles on Stellar, can't carry a memo at all; at
most a numeric ID inside a muxed address
([Stellar docs](https://developers.stellar.org/docs/learn/fundamentals/contract-development/contract-interactions/stellar-transaction)).
If that is all you need to prove, link the transaction.

A receipt is for what the ledger doesn't hold:

- **What a payment was for**, beyond what a memo or an ID can say: the
  resource, request or delivery it paid for, e.g. "0.02 USDC paid for
  GET /signals, request r-123, response delivered".
- **A policy decision**, including a payment the agent refused and never
  signed. No transaction exists for that, so the ledger has nothing to show.
- **Records that never touch the chain**: a partner's exchange-rate quote, the
  evidence behind an escrow release, the invoice or order being paid, which
  version of the terms a user accepted.
- **Private evidence**: only its hash is public. The file stays with you, and
  anyone you give it to can recompute the hash and check it matches.
- **Who stands behind it**, through an optional ed25519 signature made with the
  declarer's own key. The ledger signature shows who authorized moving the
  money; the receipt signature shows who vouches for what is said around it.
  Anyone can check the signer said it, not Nirium, and any later change shows.

To check a receipt yourself, paste its CID at
[nirium.xyz/verify](https://nirium.xyz/verify). No account needed, and the page
shows what the ledger already proves and what the receipt adds. The page
recomputes the CID in your browser, but checks the signature on our server; for
a check that relies on nothing of ours, run `npx nirium-cli verify <CID>`.

## Then why make a receipt for a plain payment?

To link the transaction to the record it settles: the order, invoice or
request ID that only the seller holds. With that link you can find a
settlement that matches no record, or a record that was never paid. That
reconciliation is on our roadmap and not built yet.

## Is the receipt part of the payment?

No. Anchoring is a separate call (`anchorAuditRecord()` in the SDK,
`POST /api/audit/log` over HTTP) that you make when you choose, usually after
the payment settles. The payment never waits for it, and if the call fails
the payment has already happened. Nothing about receipts is required to pay or
to get paid.

## What exactly gets stored?

A SHA-256 hash of your record, a tag, and an optional signature, pinned to
IPFS. We ask integrators to send a hash, not the record itself: nobody can
guarantee that something is deleted from IPFS (anyone with the CID may have kept
a copy), so raw personal data could outlive any erasure request.

A receipt is an integrity seal: it shows the record hasn't changed since it
was anchored and, if signed, who declared it. It does not prove the record is
true, and it is not notarization or legal proof.

## What if Nirium goes away?

Receipts stay checkable without us. The record lives on IPFS under its CID,
the hash can be recomputed from the original, and the signature can be
checked with the signer's public key. `nirium verify` (open source) reads from
a dedicated Filebase gateway and falls back to Pinata, ipfs.io and dweb.link.
What would stop is new anchoring through our API.

One limit: a document stays on IPFS only while someone pins it. Today we pin
every receipt on Pinata. A second copy on Filebase is built and deployed, but
it is not active: Filebase's pinning API needs a paid plan, and that account
is still on the free one (checked 21 Nov 2026). `GET /api/audit/info` reports
which copies are live.

So keep your own copy. The anchor response includes the exact `document` that
was pinned; `nirium anchor --save receipt.json` writes it for you. The CID is
the hash of those bytes, so `nirium cid receipt.json --expect <CID>` (or
`receiptCid()` / `receipt_cid()` in the SDKs) shows it is the original, and
`ipfs add --cid-version=0 receipt.json` puts it back on IPFS with the same CID,
even if every pin we pay for disappears.

## Does Nirium hold funds or keys?

No. The client signs every payment with its own key, independent partners
settle, and Nirium never holds client funds or a key that can move them.

## Does the pre-sign policy decide for the user?

No. The hook (experimental since 0.16.0) asks *your* policy, in your process,
before anything is signed. DENY or WAIT means nothing is signed. Nirium is
never the policy owner and never answers ALLOW or DENY for someone else's
payment. It is in the TypeScript SDK and, since 0.12.9 (22 Nov 2026), in the
Python SDK. Its real scope and what it does not cover are in
[`packages/sdk/README.md`](../packages/sdk/README.md#pre-sign-policy-hook-experimental)
and [`packages/sdk-python/README.md`](../packages/sdk-python/README.md#pre-sign-policy-hook).

## Who checks receipts today?

Honestly, few people yet. TIA anchors signed receipts on mainnet with its own
keys. AgentLedger ran the pre-sign hook on mainnet on 18 Nov 2026 and anchored
five signed receipts for its decisions; its founder has worked with Nirium
part-time since October 2026, so we count that as team activity, not outside
use. An outside reviewer (holistis) checked two receipts with their own code,
without our tools, on 19 Nov 2026. And a Trustless Work escrow pilot on testnet
refused tampered evidence and released valid evidence. All of it is listed with hashes in [`EVIDENCE.md`](../EVIDENCE.md).
We don't have organic third-party verification at scale, and we say so rather
than imply it.
