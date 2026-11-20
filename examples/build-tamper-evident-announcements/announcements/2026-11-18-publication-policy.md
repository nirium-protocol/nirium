---
title: Any change after publication is visible
date: 2026-11-18
kind: policy
---

Published announcements are append-only. Correcting a typo inside a published
announcement is not allowed: the build compares the file's current hash with
the hash stored when its receipt was created.

If those values differ, the generator stops before anchoring anything or
writing the site. It prints the published and current hashes so the change is
visible rather than silently republished.

## Publishing a correction

- Restore the published file if the edit was accidental.
- If the change is real, add a new announcement with a new filename.
- The new announcement gets its own hash, receipt and verification link.

This is a demo policy for the example. It does not claim that a receipt proves
the content is true; it only makes edits detectable.
