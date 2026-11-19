# Test vectors for verifyAuditDocument (nirium-protocol/nirium, actions/verify-audit-cid)

Cite as: github.com/holistis/agent-receipt-verify, vectors/nirium-verify-audit-cid, 2026-11-19.

21 cases for the decision function of the verify-audit-cid Action. They were written from outside, from the two published Audit Trail receipts (the record-mode receipt and the hash-only receipt listed in EVIDENCE.md), without the Nirium SDK or CLI. Every expected result was produced by running the real `verifyAuditDocument` from nirium-protocol/nirium at merge commit f350e205af057c6bc724b1c7bcce5cb8a4d5337e (PR 396) with @stellar/stellar-base 15.0.0, so the vectors say what that code does, not what we think it should do.

Each file holds one case: `document` (the parsed audit document), `expected` (`ok`, `hashMatch`, `hashOnly`, `signatureStatus`) and a `kind`:

- accept (2): the published receipts as they are. Must verify, signature valid.
- reject (14): documents that must not come back verified: a changed record, hash or signature, a signature from another key, a changed signer address, and the three hash-only documents with nothing to check (made-up hash without an agent, signature removed, agent removed).
- accept-by-design (5): documents that verify on purpose, with the signature status to read next to `ok`. A record without a signature passes on its hash and reports `absent` (PR 396 says so). Fields outside the signed statement (tag, network, anchoredAt, agent.id) can change without breaking hash or signature.

Three vectors fail on the code before PR 396 (files 03 to 05, the first three rejects) and pass after it. Run against the version before the fix:

    node run.mjs <path to the old verify module> --expect=21   (18 pass, 3 fail)

How to use it:

    node run.mjs <path to a module that exports verifyAuditDocument> --expect=21

`run.mjs` checks the suite against SHA256SUMS first, then plays every vector and prints one line per case. `--expect=21` makes it fail when the number of vectors is not 21, which is the only way to notice a vector that was removed together with its line in SHA256SUMS. SHA256SUMS is taken over the bytes with CRLF turned into LF, so a Windows checkout with core.autocrlf=true gives the same hashes. The runner imports and runs the module you point it at, so only use code you trust.

In a node:test file the same thing is a loop:

    for (const f of fs.readdirSync(dir).filter((x) => x.endsWith('.json'))) {
      const v = JSON.parse(fs.readFileSync(path.join(dir, f), 'utf8'))
      test(v.id, () => { const r = verifyAuditDocument(structuredClone(v.document)); for (const [k, w] of Object.entries(v.expected)) assert.equal(r[k], w) })
    }

Not covered: fetching through a gateway and the CID check (the Action does not recompute the CID), how the document text is parsed (a record written with an escaped character gives the same parsed record), the live Action, and nirium-cli.

License: Apache-2.0, same as the rest of this repository.
