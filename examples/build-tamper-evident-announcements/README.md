# Tamper-evident project announcements

A small static page generator for project announcements: changelogs, policy
changes and incident notes. Each announcement is hashed locally, anchored on
Stellar testnet through Nirium's free Audit Trail endpoint, and published with
its CID and a link to [nirium.xyz/verify](https://nirium.xyz/verify).

Only the SHA-256 hash is anchored. The announcement text is not uploaded to
IPFS; the generator copies it into the static site and readers can recompute
its hash themselves.

## Publish or rebuild

Install this example independently, like the other integrations in this
repository:

```bash
cd examples/build-tamper-evident-announcements
npm install
```

Anchoring a new announcement needs a Stellar testnet secret key that you own.
The key stays local and is never written to the repository:

```bash
export ANNOUNCEMENT_SIGNING_KEY="S..."
npm run build
```

`npm run build` does three things:

- It computes `SHA-256` over every file in `announcements/`.
- It compares each hash with the receipt stored in `publications.json`.
- For files with no receipt, it signs `nirium-audit-v1:<sha256>` with the
  Stellar key, calls `anchorAuditRecord()` from the published `nirium` SDK,
  and writes the returned CID to `publications.json`.

The default node is `https://nirium-agent.fly.dev` and the default tag is
`wave11-tamper-evident-announcements`. Override them with
`NIRIUM_AUDIT_URL` and `ANNOUNCEMENT_TAG` if needed; the tag must start with
`wave11-`.

When every announcement already has a receipt, the key is not needed:

```bash
npm run check
```

The deployable static site is written to `site/`. It contains the generated
HTML, a raw Markdown copy of each announcement, and `publications.json`. Serve
that directory from any static host, including GitHub Pages. `site/` is a build
output; generate it locally and do not commit it to the repository.

The 32-second terminal demo linked from the pull request shows the three
published receipts, one `npx nirium-cli verify` run, and the tamper refusal.

## Published demo receipts

These are real `stellar:testnet` anchors, created on 19 and 20 November 2026
with keys generated for this example. The signers are public; their secret
keys are not in this repository.

| Announcement | SHA-256 | CID | Signer |
|---|---|---|---|
| `2026-11-17-audit-trail-testnet.md` | `5d6e4cdb4d22db850479241f89c752aed9ec719426106db4862937519522301a` | [`QmYwzPgYhUjwyUHUo8mrxuQsCePuBvRb6kbD72fUe4sB5V`](https://nirium.xyz/verify?cid=QmYwzPgYhUjwyUHUo8mrxuQsCePuBvRb6kbD72fUe4sB5V) | `GAMFEIR44BGT5WAS7MQY5R5ARCQGKAXYHGYK4HPXCJMLZAETJOTJNIYI` |
| `2026-11-18-publication-policy.md` | `12db19cd1bd3dfd546115039957b6417f8e567846d23b95257ee27dba9ff6103` | [`QmSpqbrNwioZpcMU1PyZBQsguNGCGGemM31iNa47f4ShKt`](https://nirium.xyz/verify?cid=QmSpqbrNwioZpcMU1PyZBQsguNGCGGemM31iNa47f4ShKt) | `GB72CIDC6JU2UVKIMX6TKJDPT2GYZEB3JOMBWOX5B45PWHSPYSU2Q2NI` |
| `2026-11-19-incident-note.md` | `17b7ffd3ba9b81decd662675cfd718c4d9a2bf57b9af316b036d629ad906ff68` | [`QmNRNwyka6RMciaz54fKLqniyHwt2CjdAY362WrjePwGS4`](https://nirium.xyz/verify?cid=QmNRNwyka6RMciaz54fKLqniyHwt2CjdAY362WrjePwGS4) | `GAMFEIR44BGT5WAS7MQY5R5ARCQGKAXYHGYK4HPXCJMLZAETJOTJNIYI` |

Verify each one with the existing CLI. These anchors are hash-only, so
`--hash` compares the declaration with the hash you already have:

```bash
npx nirium-cli verify QmYwzPgYhUjwyUHUo8mrxuQsCePuBvRb6kbD72fUe4sB5V --hash 5d6e4cdb4d22db850479241f89c752aed9ec719426106db4862937519522301a
npx nirium-cli verify QmSpqbrNwioZpcMU1PyZBQsguNGCGGemM31iNa47f4ShKt --hash 12db19cd1bd3dfd546115039957b6417f8e567846d23b95257ee27dba9ff6103
npx nirium-cli verify QmNRNwyka6RMciaz54fKLqniyHwt2CjdAY362WrjePwGS4 --hash 17b7ffd3ba9b81decd662675cfd718c4d9a2bf57b9af316b036d629ad906ff68
```

To check the local announcement text itself, pass the file as evidence:

```bash
npx nirium-cli verify QmYwzPgYhUjwyUHUo8mrxuQsCePuBvRb6kbD72fUe4sB5V --evidence site/announcements/2026-11-17-audit-trail-testnet.md
```

All three hash checks passed. Representative output:

```text
🔍 Nirium Audit Verifier
CID:            QmYwzPgYhUjwyUHUo8mrxuQsCePuBvRb6kbD72fUe4sB5V
--------------------------------------------------
✔ HASH:        MATCH (5d6e4cdb4d22db85...) [hash-only]
✔ SIGNATURE:   VALID (Signed by GAMFEIR44BGT5WAS7MQY5R5ARCQGKAXYHGYK4HPXCJMLZAETJOTJNIYI)
   Statement:  nirium-audit-v1:5d6e4cdb4d22db850479241f89c752aed9ec719426106db4862937519522301a
   Agent ID:   nirium-announcements-demo
--------------------------------------------------
✅ VERIFICATION PASSED
```

The other two CIDs produced the same `HASH: MATCH`, `SIGNATURE: VALID` and
`VERIFICATION PASSED` result for their own hashes and statements.

## Tamper case

After publication, one line was appended to
`announcements/2026-11-18-publication-policy.md` and the build was run again.
It refused before anchoring anything or overwriting `site/`:

```text
$ npm run build

> nirium-tamper-evident-announcements-example@0.1.0 build
> node --import tsx src/build.ts

announcement-build: TAMPER DETECTED: a published announcement no longer matches its receipt.
  2026-11-18-publication-policy.md
    published sha256: 12db19cd1bd3dfd546115039957b6417f8e567846d23b95257ee27dba9ff6103
    current sha256:   d3ed18a9de1e403ae2085cf55b74aaf57d131e0b95ca7ad51c170af3afa4ce92
Refusing to anchor or write the site. Restore the file, or publish the
change as a new announcement with a new filename.

exit_status=1
```

The file was restored byte-for-byte afterwards, and `npm run check` passed
again. A removed published file is treated the same way: its receipt cannot
silently disappear with it.

## What a receipt proves, and what it does not

A receipt proves two things: the announcement file has not changed since its
hash was anchored, and the Stellar key whose public address is shown signed
the statement `nirium-audit-v1:<sha256>`. Because this example anchors a hash
rather than a record, the text itself stays off IPFS; `--evidence` checks a
local copy against the declared hash, and `--hash` checks the declaration and
signature.

A receipt does **not** prove that the announcement's content is true,
accurate, complete or legally valid. It is an integrity seal and an authorship
claim, not notarization. The `anchoredAt` value is the Nirium node's clock,
not a Stellar ledger timestamp, and this example does not claim otherwise.

This directory does not implement a verifier. Readers use the existing
`nirium-cli` or the hosted page at `nirium.xyz/verify`.

## Tests and typecheck

```bash
npm test
npm run typecheck
```

The tests do not reach the network: they replace `globalThis.fetch`, assert
that `POST /api/audit/log` receives only the hash, tag and signed `agent`
attestation, and serve deterministic CIDs. One test edits a published file and
asserts that the build throws `TAMPER DETECTED` without calling the API or
rewriting the site.
