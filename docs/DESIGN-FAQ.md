# Design FAQ

Short answers to the questions people ask most about how Nirium is built, and
where its limits are. For evidence with tx hashes, see
[`EVIDENCE.md`](../EVIDENCE.md). For a ten-minute check, see
[`FOR-REVIEWERS.md`](FOR-REVIEWERS.md).

## What does a receipt prove that the Stellar ledger doesn't?

For the payment itself, nothing. A Stellar transaction already proves the
payer, the payee, the asset and the amount, and anyone can read it from any
node. If that is all you need to prove, link the transaction.

A receipt is for what the ledger doesn't hold:

- **A policy decision**, including a payment the agent refused and never
  signed. No transaction exists for that, so the ledger has nothing to show.
- **What a payment was for**: the resource, request or delivery it paid for.
- **Records that never touch the chain**: a report, an approval, proof that a
  task was done, the evidence behind an escrow release.
- **Who declared it**, through an optional ed25519 signature made with the
  declarer's own key.

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
IPFS. We ask integrators to send a hash, not the record itself: IPFS content
can't be deleted, so raw personal data would outlive any erasure request.

A receipt is an integrity seal: it shows the record hasn't changed since it
was anchored and, if signed, who declared it. It does not prove the record is
true, and it is not notarization or legal proof.

## What if Nirium goes away?

Receipts stay checkable without us. The record lives on IPFS under its CID,
the hash can be recomputed from the original, and the signature can be
checked with the signer's public key. `nirium verify` (open source) reads from
a dedicated Filebase gateway and falls back to Pinata, ipfs.io and dweb.link.
What would stop is new anchoring through our API.

## Does Nirium hold funds or keys?

No. The client signs every payment with its own key, independent partners
settle, and Nirium never holds client funds or a key that can move them.

## Does the pre-sign policy decide for the user?

No. The hook (experimental since 0.16.0) asks *your* policy, in your process,
before anything is signed. DENY or WAIT means nothing is signed. Nirium is
never the policy owner and never answers ALLOW or DENY for someone else's
payment. Its real scope and what it does not cover are in
[`packages/sdk/README.md`](../packages/sdk/README.md#pre-sign-policy-hook-experimental).

## Who checks receipts today?

Honestly, few people yet. TIA anchors signed receipts on mainnet with its own
keys, AgentLedger reports running the pre-sign hook on testnet (its public
ledger shows the payments but doesn't name the hook), and a Trustless Work
escrow pilot on testnet refused tampered evidence and released valid
evidence. All of it is listed with hashes in [`EVIDENCE.md`](../EVIDENCE.md).
We don't have organic third-party verification at scale, and we say so rather
than imply it.
