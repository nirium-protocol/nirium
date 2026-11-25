---
title: Incident note: how a tampered announcement is handled
date: 2026-11-19
kind: incident
---

This note documents the failure path, not a production incident. During the
demo, one already-published announcement was edited after its receipt was
created.

On the next build, the generator reported `TAMPER DETECTED`, showed the
published and current SHA-256 values, and exited with a non-zero status. It did
not anchor the changed file, update `publications.json` or overwrite the site.

## Why the build refuses to continue

Silently replacing the page would leave the old CID looking like it vouched
for new text. Instead, the published file is restored or the correction is
published as a new, separately anchored announcement.

The receipt is only an integrity seal and an authorship claim. It is not a
statement that the content is accurate, and its `anchoredAt` value comes from
the Nirium node's clock rather than a Stellar ledger timestamp.
