# Autonomous grants: an agent proposes, a 2-of-3 DAO signs (testnet)

An agent checks a public, verifiable fact (a pull request is merged). If it is
true, it prepares an **unsigned** payment from the DAO account and proposes it.
Two of the DAO's three signers sign it; only then is it submitted. If the
milestone is not met, nothing is proposed.

Testnet only: no real funds, no mainnet, no custody. Every key is fresh, created
by you, and stays with whoever owns it.

```
src/milestone.ts  GitHub API check: "PR #N in owner/repo is merged"
src/agent.ts      checks the milestone; if met, builds an UNSIGNED payment proposal
src/signer.ts     decode + sign as ONE DAO signer (refuses keys that are not signers)
src/submit.ts     counts valid signatures; submits only at the threshold
src/ledger.ts     Horizon access (the only network boundary besides GitHub)
src/setup.ts      creates the 2-of-3 DAO account on testnet
src/cli.ts        setup | status | propose | inspect | sign | submit | demo-one-signature
test/             offline tests (GitHub stubbed, chain faked; no network)
```

## How it works

1. **DAO account** (`npm run setup`): a fresh account is funded by Friendbot and
   gets three signers (weight 1 each). In the same transaction its own master
   key drops to weight 0 and the low, medium and high thresholds are set to 2.
   After that no single key, including the original one, can move funds. The
   master secret is never written to disk.
2. **Agent** (`npm run propose`): asks the GitHub API whether the PR is merged.
   Only a clear `merged: true` counts. If so it loads the DAO's sequence number,
   builds one XLM payment with a 24-hour time window and writes the unsigned
   XDR as a proposal. The agent is configured with **public addresses only**;
   passing it a secret key is rejected, and it never signs or submits.
3. **Signers** (`npm run sign -- <id> <1|2|3>`): each signer decodes the XDR
   (not a summary), sees exactly what they sign, and adds their own signature.
   A key that is not a DAO signer, or a signer who already signed, is refused.
4. **Submit** (`npm run submit -- <id>`): counts only signatures that verify
   against the transaction hash **and** belong to a current signer on the
   ledger, each signer once. Below the account's payment threshold it refuses and
   never calls the network.

The demo keeps all three signer secrets in `.keys/` (git-ignored) only because
one person creates the whole DAO here. In real use each signer runs `sign` on
their own machine with their own key (`SIGNER_SECRET`), and the agent runs
somewhere that has none of them.

## Run it

Requires Node.js >= 22.12.0.

```bash
cd examples/build-autonomous-grants
npm install
npm run setup                       # creates and funds the DAO, 3 signers and a grantee on testnet
npm run status                      # shows signers, weights and the payment threshold
npm run propose -- --pr 412         # milestone: nirium-protocol/nirium#412 is merged
npm run inspect -- <id>
npm run sign -- <id> 1
npm run submit -- <id>              # refused: 1 of 2
npm run sign -- <id> 2
npm run submit -- <id>              # settled
npm run propose -- --pr 418         # a PR that was closed unmerged: nothing proposed
npm run demo-one-signature -- <id>  # sends ONE signature straight to Horizon (needs one signature, before submit)
npm test                            # offline
```

`propose` also takes `--owner`, `--repo` and `--amount` (XLM, default 50).

## Evidence (stellar:testnet, 2026-11-20)

| Role | Public key |
|---|---|
| DAO account (master weight 0) | `GDOUVML5GMABZUU3KYQALHML7VFROVA7NIJ2D5S35LEA6IZ5P5JQPYWZ` |
| Signer 1 | `GA32HSUP4YJCDD7NKCXKNZ65BC3A5OEHQIIE66SIS3EDWNHC7RFR7GHQ` |
| Signer 2 | `GA3YTKZLDFZAQESE6NF4MOWTP5RVRMI4EQ5RG3GAIKYE3GHF47XX6WB6` |
| Signer 3 | `GCA2J46WNRAYQ6QWT6IM5NWMGAVVFOQRS75S4JBTOIL7M46FZOF6EMO7` |
| Grantee | `GBFKVOWJ3NMJ76FOSUETCPUE2E7BQFON3EA37BHYPTG27J32B3RVQPBG` |

| Step | Transaction |
|---|---|
| DAO setup: 3 signers, master weight 0, thresholds 2/2/2 (signed by the new account's master key, once) | [`2b4da10e...b2bb3`](https://stellar.expert/explorer/testnet/tx/2b4da10ebc049f096a2f92874fbe035cef172087f87a374e42271bf7a8db2bb3) |
| Payout 50 XLM DAO -> grantee, signed by signers 1 and 2 | [`f5bcb9b3...e86b`](https://stellar.expert/explorer/testnet/tx/f5bcb9b3b94ea2620f843bb886014a2710de9d6a3e25ca6736138c95d593e86b) |

```
$ npm run status
DAO GDOUVML5GMABZUU3KYQALHML7VFROVA7NIJ2D5S35LEA6IZ5P5JQPYWZ
payment threshold: 2
  signer GA32HSUP4YJCDD7NKCXKNZ65BC3A5OEHQIIE66SIS3EDWNHC7RFR7GHQ  weight 1
  signer GA3YTKZLDFZAQESE6NF4MOWTP5RVRMI4EQ5RG3GAIKYE3GHF47XX6WB6  weight 1
  signer GCA2J46WNRAYQ6QWT6IM5NWMGAVVFOQRS75S4JBTOIL7M46FZOF6EMO7  weight 1
  signer GDOUVML5GMABZUU3KYQALHML7VFROVA7NIJ2D5S35LEA6IZ5P5JQPYWZ  weight 0  (master key)
```

### Milestone not met: nothing is proposed

PR #418 was closed without being merged:

```
$ npm run propose -- --pr 418
milestone nirium-protocol/nirium#418: "feat(examples): add build-iot-readings signed sensor batches example (#377)" state=closed merged=false
NOT MET: nothing proposed.
```

No proposal file is written and the chain is not read (also covered offline).

### Milestone met: the proposed XDR (unsigned)

```
$ npm run propose -- --pr 412
milestone nirium-protocol/nirium#412: "feat(examples): add build-oracle-x402 autonomous oracle example (#362)" state=closed merged=true
MET: proposed payout 50 XLM -> GBFKVOWJ3NMJ76FOSUETCPUE2E7BQFON3EA37BHYPTG27J32B3RVQPBG
proposal f5bcb9b3  hash f5bcb9b3b94ea2620f843bb886014a2710de9d6a3e25ca6736138c95d593e86b
unsigned XDR:
AAAAAgAAAADdSrF9MwAc0ptWIAWdi/1LF1QfahOh9lvqyA8jPX9TBwAAAGQAWO5VAAAAAgAAAAEAAAAAAAAAAAAAAABrAVsdAAAAAQAAABBuaXJpdW0tZ3JhbnQ6NDEyAAAAAQAAAAAAAAABAAAAAEqqusnbWJ/4rpUJMT6E0T4YFc3ZAb+E+HzNr6d6DuNYAAAAAAAAAAAdzWUAAAAAAAAAAAA=
```

### One signature is not enough

After signer 1 signs, the example refuses to submit, and the network itself
also rejects a transaction with one signature:

```
$ npm run sign -- f5bcb9b3 1
signed by GA32HSUP4YJCDD7NKCXKNZ65BC3A5OEHQIIE66SIS3EDWNHC7RFR7GHQ
signature djqxuVfDCUA1iEJdzeZ97nbPC07wnXh43cjdNUuk9aZ1GDeC5Fq800gh24cLTFnHI+HQ0GCuR5iNHJIj/K0OCw==

$ npm run submit -- f5bcb9b3
signatures: 1 attached, 1 valid -> weight 1 / 2 required
  OK   GA32HSUP4YJCDD7NKCXKNZ65BC3A5OEHQIIE66SIS3EDWNHC7RFR7GHQ
REFUSED: not enough signatures: weight 1 of 2 required (valid signers: 1)

$ npm run demo-one-signature -- f5bcb9b3
submitting with ONE signature (GA32HSUP4YJCDD7NKCXKNZ65BC3A5OEHQIIE66SIS3EDWNHC7RFR7GHQ) straight to Horizon...
rejected by the network: {"transaction":"tx_bad_auth"}
```

### The two signatures and the settled transaction

```
$ npm run sign -- f5bcb9b3 2
signed by GA3YTKZLDFZAQESE6NF4MOWTP5RVRMI4EQ5RG3GAIKYE3GHF47XX6WB6
signature 2uxcHwvZQeJ2+50orMlMFe6lkqNMvPq3clRqK0C8UZtzmLl6lIGD7vfAJTR/YFosrLF3gQ6tHQ1kdh29u9+JBA==

$ npm run submit -- f5bcb9b3
signatures: 2 attached, 2 valid -> weight 2 / 2 required
  OK   GA32HSUP4YJCDD7NKCXKNZ65BC3A5OEHQIIE66SIS3EDWNHC7RFR7GHQ
  OK   GA3YTKZLDFZAQESE6NF4MOWTP5RVRMI4EQ5RG3GAIKYE3GHF47XX6WB6
SETTLED in ledger 5828193
f5bcb9b3b94ea2620f843bb886014a2710de9d6a3e25ca6736138c95d593e86b
https://stellar.expert/explorer/testnet/tx/f5bcb9b3b94ea2620f843bb886014a2710de9d6a3e25ca6736138c95d593e86b
```

Horizon confirms the transaction is successful, has exactly two signatures,
and is a 50 XLM payment from the DAO account to the grantee.

## What this does and doesn't prove

- The payout needed two of three DAO signers; the agent never held a signing
  key and could not have moved funds alone.
- The agent's check is only as good as the fact it checks: a merged PR says the
  code landed, not that the work is good. The signers still decide, and that
  human review is the point of the multisig.
- GitHub is trusted for the merge status (unauthenticated API, rate-limited; a
  failed or unreadable answer stops the agent instead of proposing).
- A proposal is valid for 24 hours and uses the DAO's next sequence number. If
  the DAO sends another transaction first, the proposal becomes stale and must
  be re-proposed.
- Signers must review what they sign. `sign` prints the decoded transaction;
  do not sign a proposal you have not read.

## Tests

`npm test` (offline): a PR counts only when merged (open and closed-unmerged do
not); an unreadable GitHub answer throws instead of guessing; owner, repo and
PR inputs cannot change the API URL; not met means no proposal and no chain
read; met gives one unsigned payment from the DAO; the agent rejects a secret
key; **one signature, or none, is refused and the ledger is never called**; two
distinct signers submit once with exactly two signatures; duplicate, outsider,
forged and wrong-transaction signatures add no weight; a swapped XDR is not
signed.
