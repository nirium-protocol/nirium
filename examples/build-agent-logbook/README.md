# Agent Logbook: one signed receipt per task

An AI agent writes a logbook entry after every task — what it was asked, which
tools it called, what it returned, and a task id — keeps the full entry on the
local machine, and anchors only the entry's **SHA-256 hash** to Nirium Audit
Trail, signed with the agent's own Stellar key. Later, `check-task <id>`
recomputes the hash from the stored entry and runs the existing
`nirium verify`; if anyone edits the stored entry, the check fails.

The full entries (prompts can contain personal data) never leave the machine.
Only `hash`, `tag` and the agent's signature are sent to the node.

## What a receipt proves — and what it doesn't

A receipt (CID) proves two things:

- **The entry hasn't changed since it was anchored.** `check-task` recomputes the
  hash from the stored entry; any edit makes it differ from the anchored one.
- **Who signed it.** The agent signed `nirium-audit-v1:<sha256>` with its own
  Stellar key; `nirium verify` checks that signature against the public key.

It does **not** prove:

- that the content of the entry is **true** (the agent could have logged a
  wrong answer, or lied about which tools it called);
- **when** the task ran by any independent clock: `anchoredAt` is the Nirium
  node's clock at anchoring time, not a ledger time, and `startedAt` inside the
  entry is the agent's own claim;
- anything about payments — this example anchors off-chain records only.

This is the kind of fact the chain can't show on its own: a private, off-chain
record of what an agent did, plus who declared it.

## Layout

```
src/entry.ts    logbook entry type, canonical JSON, sha-256
src/agent.ts    a small tool-calling agent (any framework fits AgentRunner)
src/logbook.ts  run a task -> store entry locally -> anchor hash + signature
src/store.ts    local storage for entries and receipts (.logbook/)
src/check.ts    check-task: recompute the hash and run `nirium verify`
src/cli.ts      run | check-task <id> | receipts [--new-key]
test/           offline tests (HTTP is mocked; no network)
```

The demo agent is a deterministic rule-based tool caller (calculator, word
count, date difference, temperature conversion, contact redaction) so the
example runs offline. To use LangChain, the OpenAI Agents SDK, a local model,
etc., implement `AgentRunner.run(prompt)` and return the tool calls and the
final answer; the logbook and receipts don't change.

## Run it

Requires Node.js >= 22.12.0.

```bash
cd examples/build-agent-logbook
npm install
cp .env.example .env
npm run receipts -- --new-key      # prints a fresh testnet keypair; put the secret in .env
npm run run-tasks                  # 5 tasks -> 5 entries in .logbook/ -> 5 receipts
npm run check-task -- <task-id>    # recompute + nirium verify
npm test                           # offline
```

Use **your own** `stellar:testnet` key (never one someone gave you) and never
commit it. The tag must start with `wave11-`. The testnet node is
`https://nirium-agent.fly.dev` (`POST /api/audit/log`, free, no API key).

## Evidence (testnet run, 2026-11-19)

Agent key: `GAVJENJHFSRGUKKEI4X65IJJSZBCEKP57ADSGOGTBGBNWDTM7B7EVJRI`, tag `wave11-agent-logbook`.

| Task | Tool | SHA-256 | CID |
|---|---|---|---|
| task-0724435a | calculator | `4750a7e612d003099d4e869f6729723a8a2b33d48ea2790a4dc5be571ba02e75` | `QmSQHZCc4iTTohMLoHc4FGh3JWoEtcE6WdHXUiusHEq1s4` |
| task-38f005ad | word_count | `8714f05d372e3f1c064e1967ab59b4c353a6d17f90ae0afdb7b932fd4803df27` | `QmccPK7Jasp9h8NMPTDzkD86PBU5DErumUEwa6WQsfnrxw` |
| task-62251e2f | days_between | `3d253386fc42925042cb4648e37614d5b05e78f3796a4475e0279253ea2422b8` | `Qme6oppVT3Vc7UmMhe1Hx62GpEYbSuJ6kh9bukkcED9dxC` |
| task-0b3f979d | celsius_to_fahrenheit | `c9d1d70c023626e46417e8b5a727e07244ae2cbfdd4cab9cbd32e128faaf7178` | `QmbfQDHbGgBeikwXc8GZVZeEFUFqwsWgB9uAWejvS8Y9Hk` |
| task-412d65d3 | redact_contact (prompt with an email and a phone number) | `d5bf2a3896c58be9a25e21cbf3a70b9698b5804b1137c211ebd8519e2a82f3d6` | `QmX7QmUshvwsDdbaR9EbSWMdtuferwHeQjYfdx8DsTvGM2` |

Each one passes `nirium verify <cid> --hash <sha256>`. Anyone can re-check them
with `npx nirium-cli verify <cid> --hash <sha256>`.

A passing check:

```
$ npm run check-task -- task-0724435a
🔍 Nirium Audit Verifier
CID:            QmSQHZCc4iTTohMLoHc4FGh3JWoEtcE6WdHXUiusHEq1s4
--------------------------------------------------
✔ HASH:        MATCH (4750a7e612d00309...) [hash-only]
✔ SIGNATURE:   VALID (Signed by GAVJENJHFSRGUKKEI4X65IJJSZBCEKP57ADSGOGTBGBNWDTM7B7EVJRI)
   Statement:  nirium-audit-v1:4750a7e612d003099d4e869f6729723a8a2b33d48ea2790a4dc5be571ba02e75
   Agent ID:   agent-logbook
--------------------------------------------------
✅ VERIFICATION PASSED

recomputed 4750a7e612d003099d4e869f6729723a8a2b33d48ea2790a4dc5be571ba02e75
anchored   4750a7e612d003099d4e869f6729723a8a2b33d48ea2790a4dc5be571ba02e75
CHECK PASSED
```

The tampered case: a copy of the logbook where the stored output of
`task-0b3f979d` was edited after anchoring:

```
$ LOGBOOK_DIR=.logbook_tampered npm run check-task -- task-0b3f979d
🔍 Nirium Audit Verifier
CID:            QmbfQDHbGgBeikwXc8GZVZeEFUFqwsWgB9uAWejvS8Y9Hk
--------------------------------------------------
❌ HASH:        MISMATCH (Anchored: c9d1d70c023626e46417e8b5a727e07244ae2cbfdd4cab9cbd32e128faaf7178, Computed: 66e3e36c33ddc87f62b1bae870c984540d6bc0271ba75329ef389460be817b07)
✔ SIGNATURE:   VALID (Signed by GAVJENJHFSRGUKKEI4X65IJJSZBCEKP57ADSGOGTBGBNWDTM7B7EVJRI)
   Statement:  nirium-audit-v1:c9d1d70c023626e46417e8b5a727e07244ae2cbfdd4cab9cbd32e128faaf7178
   Agent ID:   agent-logbook
--------------------------------------------------
❌ VERIFICATION FAILED

recomputed 66e3e36c33ddc87f62b1bae870c984540d6bc0271ba75329ef389460be817b07
anchored   c9d1d70c023626e46417e8b5a727e07244ae2cbfdd4cab9cbd32e128faaf7178
CHECK FAILED
```

(The signature is still valid — it signs the anchored hash — but the stored
entry no longer matches it, so the check fails with a non-zero exit code.)

## Tests

`npm test` runs offline; the SDK's HTTP call is replaced by a mock that records
every request body:

- 5 tasks produce 5 receipts, one per task, each signed by the agent key;
- the request bodies contain only `hash`, `tag` and `agent` — none of the
  personal data from the redaction prompt (name, email, phone) appears in them,
  while the full entry is still kept locally;
- `check-task` passes for untouched entries and fails after a stored entry is edited;
- the hash changes if the prompt, tool calls, output or task id change, and does
  not depend on JSON key order;
- tags outside `wave11-` are refused before anything is anchored.

Out of scope: verifiers, Soroban registries, on-chain batching, x402 receipts,
policy-decision receipts, escrow evidence and reconciliation. No Nirium package
is changed.
