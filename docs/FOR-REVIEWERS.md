# Nirium - 10 minutes for a reviewer

Not a Claude Code session, not a deep dive. Five things, in order of how much
you have to trust us to believe them. Every link below is something you can
check yourself right now - none of it depends on taking our word for it.

## 1. Something live, in 30 seconds

```bash
curl https://nirium-agent.fly.dev/api/nodes
```

Real JSON, no auth, right now: the live status of every execution node
(Settlement, Audit Trail, Treasury Rebalance, Payouts, Reporting), which
network each runs on, and which endpoints back it. This is what the whole
project actually is - not a pitch deck, a running API you just hit.

## 2. Treasury Node - real money, on mainnet, with a contract that can't take it

Nirium doesn't hold the vault. It holds the `RebalanceManager` role of a
[DeFindex](https://defindex.io) vault the client owns, and DeFindex's own
`rebalance()` function never takes a destination address - withdrawal isn't
forbidden, it's inexpressible in the contract. That's not our framing; it's
verifiable in DeFindex's own source.

Three things you can check on Stellar Expert directly:

- Vault deployed, client signs: [`93ff6284…78416`](https://stellar.expert/explorer/public/tx/93ff6284cdf03706624c88434a79fba1b213ee547f58e09a9248f75373178416)
- Autonomous invest, **the agent signs** - this is the one that matters: the agent moved funds it doesn't own, and the contract gave it no way to take them out. [`82d73f53…6b3d4`](https://stellar.expert/explorer/public/tx/82d73f537e907140367f9343f63a36704c74a5286aced7a938cee8fffb56b3d4)
- The vault contract itself, roles readable on-chain: [`CAMDXG6L…K57MH`](https://stellar.expert/explorer/public/contract/CAMDXG6L4LXLXXV675KZSHM3BMSETZ4NVMC7JYIQCZ2JTG54OMSK57MH)

The DeFindex vault and its Blend v2 strategy code were audited by OtterSec
(March 2025: 16 findings, 13 of them vulnerabilities, all resolved). The
Etherfuse CETES pool itself is outside that audit. Full writeup with the
same links: [this repo's own README, "Networks"
section](../README.md#networks), and the identical evidence is
cross-referenced in the full [nirium-core
mirror](https://github.com/nirium-protocol/nirium-core) - both our repos
cite the same transactions; the chain is the independent source.

## 3. A real partner integration, not a listed logo

[`nirium-pollar-adapter`](https://github.com/nirium-protocol/nirium-pollar-adapter)
lets a wallet onboarded through [Pollar](https://pollar.xyz) (social login,
zero seed phrase) pay for x402 APIs and sign audit records without touching
a raw Stellar key. Two concrete artifacts:

- **Merged, not just proposed**: [nirium-pollar-adapter PR #1](https://github.com/nirium-protocol/nirium-pollar-adapter/pull/1) (deferred-mode wallet funding) merged 29 Aug 2026.
- **Live demo**: [nirium-pollar-x402-demo.vercel.app](https://nirium-pollar-x402-demo.vercel.app) - log in with Google, pay a real x402 endpoint, holding zero XLM end to end.
- **Two real mainnet transactions**, not just a working demo: a payment [`25ebaf9a…`](https://stellar.expert/explorer/public/tx/25ebaf9aa7e72c1c3edcc43a1c18aaa102c12eee42c57e02fed4fda79af6605d) settled 27 Jul 2026 (evidence anchored at [`QmZiwxidm…`](https://gateway.pinata.cloud/ipfs/QmZiwxidm7pcTqNufxzFyUc7qJrCRN2TKRNwcXkg7vUUwR)), and a user who signed in with Google paying $0.02 USDC on mainnet, [`e4fa3df9…`](https://stellar.expert/explorer/public/tx/e4fa3df9cb225a4d7f64dd0082eb38218ada4b4af3378f288989a5d4b1116ed9), holding zero XLM throughout. Both detailed in [nirium-pollar-adapter's own README](https://github.com/nirium-protocol/nirium-pollar-adapter#readme).

The demo-app integration itself,
[pollar-apps#30](https://github.com/pollar-xyz/pollar-apps/pull/30), was
**merged by Pollar's own maintainer on 31 Aug 2026** (`bb277f6a`).

**Another real integration, publicly thanked by the protocol, not just a logo.** [Trustless-Work/agentic-escrow-research](https://github.com/Trustless-Work/agentic-escrow-research): 4 PRs merged on 21-sep-2026 ([#1](https://github.com/Trustless-Work/agentic-escrow-research/pull/1), [#2](https://github.com/Trustless-Work/agentic-escrow-research/pull/2), [#3](https://github.com/Trustless-Work/agentic-escrow-research/pull/3), [#4](https://github.com/Trustless-Work/agentic-escrow-research/pull/4)), thanked by name by Trustless Work's official account.

**A real escrow cycle, liquidated with real money, not a description of one.** Beyond the 4 merged PRs above, Nirium ran Trustless Work's own Multi-Release escrow contract end to end on mainnet, 3-sep-2026: deploy → fund → approve → release, a real 0.50 USDC, self-directed (one key holding every role, proving the mechanism, not a decision to open this flow to Payouts production - that stays behind legal review). Four confirmed transactions, receiver balance moved by exactly 0.4985 USDC (0.50 minus Trustless Work's fixed 0.3% fee): [`4110dd16…12aefe84`](https://stellar.expert/explorer/public/tx/4110dd16df6c7cdaf50d89f7402e3e51de0ac4f63255f6601e800e3912aefe84) → [`7b181a13…451c09c`](https://stellar.expert/explorer/public/tx/7b181a13160d6d7170f78ba9a4e15309cc0a8f6e20a1db01adfcdb667451c09c) → [`a3aa35a2…4096ca5`](https://stellar.expert/explorer/public/tx/a3aa35a272774547d3ca4ce5a32e361641daac6cf829ecf8951b83a194096ca5) → [`0c533088…a8192b`](https://stellar.expert/explorer/public/tx/0c533088ab6326a78b9f79c197b7636ca4662a0d72562968ddea37f370a8192b). Full detail, including the deploy-path timing evidence, in the [nirium-core mirror's README](https://github.com/nirium-protocol/nirium-core#readme).

## 4. Upstream contributions - bugs fixed in code we don't control

The strongest kind of evidence: a maintainer with no reason to agree if it
weren't real, agreeing.

| Where | What | Status |
|---|---|---|
| [stellar/stellar-dev-skill#96](https://github.com/stellar/stellar-dev-skill/pull/96) | Nirium listed in Stellar's own official developer-skills catalog | **Merged** 15 Aug 2026, reviewed by SDF DevRel |
| [stellar/stellar-dev-skill#97](https://github.com/stellar/stellar-dev-skill/pull/97) | Multiple real production-hardening fixes to the agentic-payments skill (x402/MPP) | **Merged** 5 Sep 2026 |
| [x402-foundation/x402#3171](https://github.com/x402-foundation/x402/issues/3171) | Filed by us against `@x402/core`'s reference implementation; fixed by an unrelated third-party contributor, not us | **Closed** 17 Aug 2026 - external confirmation, not self-reported |
| [stellar/js-stellar-sdk#1655](https://github.com/stellar/js-stellar-sdk/issues/1655) | Delegate-signing path (CAP-71) wasn't seeing signers outside the root node | **Closed** 28 Sep 2026 via maintainer's [PR #1747](https://github.com/stellar/js-stellar-sdk/pull/1747) |
| [stellar/js-stellar-sdk#1683](https://github.com/stellar/js-stellar-sdk/issues/1683) | `authorizeEntry`'s bare-signature fallback ignored `forAddress` | **Closed** 24 Sep 2026 via maintainer's [PR #1742](https://github.com/stellar/js-stellar-sdk/pull/1742) |
| [stellar/js-stellar-sdk#1681](https://github.com/stellar/js-stellar-sdk/issues/1681) | `signAuthEntries` couldn't represent a non-master-key signer for a plain Address credential | **Closed** 26 Sep 2026 - fixed by maintainer's [PR #1743](https://github.com/stellar/js-stellar-sdk/pull/1743) + [#1744](https://github.com/stellar/js-stellar-sdk/pull/1744), closed by us after confirming both merged |
| [stellar/js-stellar-sdk#1700](https://github.com/stellar/js-stellar-sdk/issues/1700) | `needsNonInvokerSigningBy` invisible for custom accounts beyond CAP-71 delegates | **Closed** 25 Sep 2026 - [PR #1745](https://github.com/stellar/js-stellar-sdk/pull/1745) documents the gap as a known limitation; not a code fix |
| [stellar/js-stellar-sdk#1699](https://github.com/stellar/js-stellar-sdk/issues/1699) | Same round, a 5th report - withdrawn by us after our own fix attempt showed it wasn't a bug | **Closed** `not_planned`, self-retracted, never fixed |
| [stellar/stellar-mpp-sdk#72](https://github.com/stellar/stellar-mpp-sdk/pull/72) | Follow-up to our merged [#69](https://github.com/stellar/stellar-mpp-sdk/pull/69) fix (see README's "External validation"): derives the SAC literals from asset code + network passphrase so the typo class can't recur | **Open**, not merged - filed by contributor `jeesunikim`, not us; noted here so "everything closed" isn't overclaimed |
| [Trustless-Work/trustlesswork-sdk-react#6](https://github.com/Trustless-Work/trustlesswork-sdk-react/issues/6) | SAC vs. classic-issuer ambiguity in docs | **Closed** 28 Sep 2026 |
| [stellar/smart-account-kit#7](https://github.com/stellar/smart-account-kit/issues/7) | Uncapped `@stellar/stellar-sdk` peer range let a routine install resolve a version whose API removed a method the library calls in 9+ production files - a live runtime crash | **Closed** 8 Sep 2026 via maintainer's [PR #10](https://github.com/stellar/smart-account-kit/pull/10) (caps the SDK range at `^16.3.0`) |
| [OpenZeppelin/stellar-contracts#865](https://github.com/OpenZeppelin/stellar-contracts/issues/865) | Protocol 28: non-exhaustive `match` on `ContractExecutable` fails to build once soroban-sdk moves to 28.x | **Closed** 26 Sep 2026 via maintainer's [PR #866](https://github.com/OpenZeppelin/stellar-contracts/pull/866) |
| [OpenZeppelin/stellar-contracts#844](https://github.com/OpenZeppelin/stellar-contracts/pull/844) | Proposed fix for a `fee-abstraction` expiration-check bug we filed (#840) | **Closed** - after review the maintainer treated the Lazy-mode value as intended behavior, not a bug; our reading, corrected by theirs |

**Update, 2026-09-28 (checked against the GitHub API that day):** the four
`js-stellar-sdk` rows above replace a single earlier row that grouped all
five issues (including #1699) under "closed via the maintainer's own PR
#1747" - inaccurate on two counts, caught by re-checking each issue's
closing event individually rather than trusting the grouped claim. Only
#1655 closed via #1747; #1683 via a separate PR (#1742); #1681 via two
more PRs (#1743, #1744) that we closed manually after confirming; #1700
via a docs-only PR (#1745) with no behavior change; and #1699 was never
fixed at all - withdrawn `not_planned`.

## 5. GrantFox - the real numbers, not the flattering summary

This repo's GrantFox bounty program, all three campaigns to date
(Official Campaign, FWC26, Third Campaign - the last one wrapped 30 Aug
2026), audited issue by issue against real merged PRs, not counted by
title:

**42 total bounty asks. 20 delivered with a merged PR into `nirium`
itself. 2 more delivered as real, substantive PRs against external target
repos, still open there awaiting that project's own maintainer review - not
yet merged. 4 closed and cleanly recreated as new issues, not abandoned. 16
closed with no deliverable at all, reported honestly rather than omitted.**

Verify the raw numbers yourself:

```bash
gh issue list --repo nirium-protocol/nirium --label "GrantFox OSS" --state all --limit 200 --json number | jq length
```

Board is fully closed - `gh issue list --repo nirium-protocol/nirium
--label "GrantFox OSS" --state open --limit 200` returns `[]`. Nothing
stale left open to re-litigate. **Use `--limit 200`**: `gh issue list`
defaults to 30 results, which silently truncates this exact count if you
omit it - caught 2026-09-28 re-verifying this page.

---

*Every number and link on this page was checked live against its source
(Horizon, GitHub's API, the running API itself) before being written down
- not copied from an internal doc or an earlier draft. Last verified: 23 Oct 2026.*
