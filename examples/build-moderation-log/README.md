# Build with Nirium: Discord/Telegram Moderation Log Bot with Audit Trail Receipts

A community moderation log bot that anchors every moderation action (warn, mute, message removal, kick, ban) to the **Nirium Audit Trail** testnet. Every decision receives an immutable cryptographic receipt so community members, appeal reviewers, and server owners can independently prove a decision was not rewritten or backdated after the fact.

---

## Cryptographic Guarantees & Privacy

### 1. Zero Raw Personal Data (Hash-Only Anchoring)
Nobody can guarantee that something is deleted from IPFS. Anchoring cleartext user identifiers or chat messages would create irreversible privacy violations.

To prevent this:
- **Moderator IDs**, **Target User IDs**, and **Message Content** are salted with a 32-byte cryptographically secure random salt and hashed with SHA-256 (`hashWithSalt(val, salt)`).
- The public audit anchor payload contains **only** the action type, public server ID, public action ID, timestamp, and salted hashes.
- Raw personal data **never** leaves the local environment or enters the IPFS network.

### 2. Community Key Attestation
Every anchored moderation record is attested by the community's own Stellar keypair:
- Statement format: `nirium-audit-v1:<sha256>`
- Signed with Ed25519 (`Keypair.sign()`)
- Tag format: `wave11-moderation-log` (starts with `wave11-` as required by Nirium Wave 11 standard)

### 3. What a Receipt Proves (and What It Doesn't)
- **What it proves:**
  1. **Proof of Non-Tampering:** The exact moderation record (action, reason, target hash, message hash) existed at the recorded time and has not been altered, rewritten, or deleted.
  2. **Proof of Authority:** The decision was signed and authorized by the specific community Stellar public key (`G...`).
- **What it does NOT prove:**
  1. It does **not** prove that the moderator's accusation was objectively true or fair.
  2. `anchoredAt` is the Nirium audit node's clock, not an on-chain Stellar consensus ledger timestamp.

---

## Live Testnet Demo Server Records

A demonstration community server (`guild_nirium_community_demo`) was created with 5 real moderation actions anchored to `https://nirium-agent.fly.dev/api/audit/log`:

| Action ID | Action | Target User Hash (Salted) | Anchored CID | SHA-256 Hash | Anchored At |
| :--- | :--- | :--- | :--- | :--- | :--- |
| `mod-mwscienp-12r7` | **WARN** | `e6e969019b8df790...` | [`QmUrJezMWZw15CF8tsj4ZW7917oxi18sTCYqkrgrrMHChS`](https://ipfs.io/ipfs/QmUrJezMWZw15CF8tsj4ZW7917oxi18sTCYqkrgrrMHChS) | `e27363ab85489af99ee8974006ae09bfffe6c7c87e621ba9c2a05dd19854e9df` | `2026-11-22T21:25:14.764Z` |
| `mod-mwscilt0-2fk3` | **MUTE** | `68c347f71b960c16...` | [`QmSZaccongZ7trqq1LvH7BTfVx7uRLx8atd5uD9VT2pFEd`](https://ipfs.io/ipfs/QmSZaccongZ7trqq1LvH7BTfVx7uRLx8atd5uD9VT2pFEd) | `af43ef9ed18bbec4426f338eea900fedc0b14475f0c411e62860654f62ab68dd` | `2026-11-22T21:25:23.911Z` |
| `mod-mwscisr0-lz61` | **MESSAGE_REMOVAL** | `265c71da517bc582...` | [`QmQci6hVcRAX8GX4hN5LCHi5RPqqramQkf3N1Gw5FMxQZa`](https://ipfs.io/ipfs/QmQci6hVcRAX8GX4hN5LCHi5RPqqramQkf3N1Gw5FMxQZa) | `c37195c36455532cf3155ab418a99511e07ef84dea80b87ead1df8f35e805ded` | `2026-11-22T21:25:32.890Z` |
| `mod-mwscizvx-jgih` | **KICK** | `3f2347eb10526e85...` | [`QmY6fcPmTDKJc2Pt6AGyZQd1mAnvfGi49QVho1PqRrHaoc`](https://ipfs.io/ipfs/QmY6fcPmTDKJc2Pt6AGyZQd1mAnvfGi49QVho1PqRrHaoc) | `fb9eba9cb4771ec9d448b8993a2f8e6d2af8edabb3859ec9ea03de5903de5b50` | `2026-11-22T21:25:42.089Z` |
| `mod-mwscj71d-lxhe` | **BAN** | `ab40d2bb4fbda7ff...` | [`QmRem2Trtiy1uwqKzc6ahR6cxRLL3WLt5GFE1Y6KLnidNq`](https://ipfs.io/ipfs/QmRem2Trtiy1uwqKzc6ahR6cxRLL3WLt5GFE1Y6KLnidNq) | `b50e79b2d89ba9caa256dbd3868b0bddf4e635c0d79277309118ce42cdeb6520` | `2026-11-22T21:25:51.358Z` |

**Community Signer Public Key:** `GDAIIS2ERWGIUJZTA4UMH43C5NOBGDCLNKPUDXLXD27JUO5FDA5T6USE`

---

## Live Verification Evidence (`nirium-cli verify`)

All CIDs are verifiable using the standard CLI (`npx nirium-cli verify <cid> --hash <sha256>`):

### Action 1 (`warn`):
```bash
$ npx nirium-cli verify QmUrJezMWZw15CF8tsj4ZW7917oxi18sTCYqkrgrrMHChS --hash e27363ab85489af99ee8974006ae09bfffe6c7c87e621ba9c2a05dd19854e9df
🔍 Nirium Audit Verifier
CID:            QmUrJezMWZw15CF8tsj4ZW7917oxi18sTCYqkrgrrMHChS
--------------------------------------------------
✔ HASH:        MATCH (e27363ab85489af9...) [hash-only]
✔ SIGNATURE:   VALID (Signed by GDAIIS2ERWGIUJZTA4UMH43C5NOBGDCLNKPUDXLXD27JUO5FDA5T6USE)
   Statement:  nirium-audit-v1:e27363ab85489af99ee8974006ae09bfffe6c7c87e621ba9c2a05dd19854e9df
   Agent ID:   moderation-log-bot
--------------------------------------------------
✅ VERIFICATION PASSED
```

### Action 2 (`mute`):
```bash
$ npx nirium-cli verify QmSZaccongZ7trqq1LvH7BTfVx7uRLx8atd5uD9VT2pFEd --hash af43ef9ed18bbec4426f338eea900fedc0b14475f0c411e62860654f62ab68dd
🔍 Nirium Audit Verifier
CID:            QmSZaccongZ7trqq1LvH7BTfVx7uRLx8atd5uD9VT2pFEd
--------------------------------------------------
✔ HASH:        MATCH (af43ef9ed18bbec4...) [hash-only]
✔ SIGNATURE:   VALID (Signed by GDAIIS2ERWGIUJZTA4UMH43C5NOBGDCLNKPUDXLXD27JUO5FDA5T6USE)
   Statement:  nirium-audit-v1:af43ef9ed18bbec4426f338eea900fedc0b14475f0c411e62860654f62ab68dd
   Agent ID:   moderation-log-bot
--------------------------------------------------
✅ VERIFICATION PASSED
```

### Action 3 (`message_removal`):
```bash
$ npx nirium-cli verify QmQci6hVcRAX8GX4hN5LCHi5RPqqramQkf3N1Gw5FMxQZa --hash c37195c36455532cf3155ab418a99511e07ef84dea80b87ead1df8f35e805ded
🔍 Nirium Audit Verifier
CID:            QmQci6hVcRAX8GX4hN5LCHi5RPqqramQkf3N1Gw5FMxQZa
--------------------------------------------------
✔ HASH:        MATCH (c37195c36455532c...) [hash-only]
✔ SIGNATURE:   VALID (Signed by GDAIIS2ERWGIUJZTA4UMH43C5NOBGDCLNKPUDXLXD27JUO5FDA5T6USE)
   Statement:  nirium-audit-v1:c37195c36455532cf3155ab418a99511e07ef84dea80b87ead1df8f35e805ded
   Agent ID:   moderation-log-bot
--------------------------------------------------
✅ VERIFICATION PASSED
```

### Action 4 (`kick`):
```bash
$ npx nirium-cli verify QmY6fcPmTDKJc2Pt6AGyZQd1mAnvfGi49QVho1PqRrHaoc --hash fb9eba9cb4771ec9d448b8993a2f8e6d2af8edabb3859ec9ea03de5903de5b50
🔍 Nirium Audit Verifier
CID:            QmY6fcPmTDKJc2Pt6AGyZQd1mAnvfGi49QVho1PqRrHaoc
--------------------------------------------------
✔ HASH:        MATCH (fb9eba9cb4771ec9...) [hash-only]
✔ SIGNATURE:   VALID (Signed by GDAIIS2ERWGIUJZTA4UMH43C5NOBGDCLNKPUDXLXD27JUO5FDA5T6USE)
   Statement:  nirium-audit-v1:fb9eba9cb4771ec9d448b8993a2f8e6d2af8edabb3859ec9ea03de5903de5b50
   Agent ID:   moderation-log-bot
--------------------------------------------------
✅ VERIFICATION PASSED
```

### Action 5 (`ban`):
```bash
$ npx nirium-cli verify QmRem2Trtiy1uwqKzc6ahR6cxRLL3WLt5GFE1Y6KLnidNq --hash b50e79b2d89ba9caa256dbd3868b0bddf4e635c0d79277309118ce42cdeb6520
🔍 Nirium Audit Verifier
CID:            QmRem2Trtiy1uwqKzc6ahR6cxRLL3WLt5GFE1Y6KLnidNq
--------------------------------------------------
✔ HASH:        MATCH (b50e79b2d89ba9ca...) [hash-only]
✔ SIGNATURE:   VALID (Signed by GDAIIS2ERWGIUJZTA4UMH43C5NOBGDCLNKPUDXLXD27JUO5FDA5T6USE)
   Statement:  nirium-audit-v1:b50e79b2d89ba9caa256dbd3868b0bddf4e635c0d79277309118ce42cdeb6520
   Agent ID:   moderation-log-bot
--------------------------------------------------
✅ VERIFICATION PASSED
```

---

## Tamper Detection Evidence (Editing Stored Record Fails)

If a moderator or rogue database admin attempts to alter an action record after the fact (e.g. changing the reason or modifying the penalized user), the recomputed hash diverges from the immutable IPFS receipt, and `/check` immediately rejects it:

```bash
$ node --import tsx src/cli.ts tamper mod-mwscj71d-lxhe "Changed ban reason secretly"
[TAMPERED] Modified reason for "mod-mwscj71d-lxhe":
  Old Reason: "Malicious impersonation of Nirium core team administrators"
  New Reason: "Changed ban reason secretly"
Run 'check mod-mwscj71d-lxhe' to demonstrate tamper detection!

$ node --import tsx src/cli.ts check mod-mwscj71d-lxhe
Checking action "mod-mwscj71d-lxhe" against anchored receipt...

[CHECK FAILED / TAMPERED] Action does not match receipt!
  Action ID:  mod-mwscj71d-lxhe
  Error:      TAMPERED: Stored record hash (bc462b4356b33c80...) differs from anchored receipt hash (b50e79b2d89ba9ca...)
```

---

## Quick Start & CLI Usage

### 1. Installation
```bash
npm install
```

### 2. Configuration (`.env`)
```bash
cp .env.example .env
```
Fill in your Stellar testnet secret key (`STELLAR_SECRET_KEY=S...`). If omitted, the CLI automatically generates a transient testnet keypair.

### 3. Log a Moderation Action
```bash
node --import tsx src/cli.ts log ban discord_user_9921 "Severe spam in announcements" "Buy tokens at fake.xyz"
```

### 4. Check a Decision Against Its Receipt (`/check <id>`)
```bash
node --import tsx src/cli.ts check mod-mwscienp-12r7
```

### 5. List All Stored Actions
```bash
node --import tsx src/cli.ts list
```

### 6. Run Offline Automated Tests
Tests execute with 100% mocked network calls:
```bash
npm test
```
```
▶ Moderation Log Bot with Nirium Receipts (#381)
  ✔ TC1 - hashes all personal data (user IDs, message content) before anchoring (80.3ms)
  ✔ TC2 - signs statement nirium-audit-v1:<sha256> with community Stellar key (10.9ms)
  ✔ TC3 - enforces wave11- tag prefix (2.4ms)
  ✔ TC4 - confirms a stored action against its receipt using checkAction (5.4ms)
  ✔ TC5 - editing or tampering with the stored record fails /check verification (8.9ms)
✔ Moderation Log Bot with Nirium Receipts (#381) (109.4ms)
ℹ tests 5
ℹ suites 1
ℹ pass 5
ℹ fail 0
```
