# Nirium — Evidence Index

Last verified live: 4 Nov 2026, against Horizon (mainnet/testnet), the Pinata gateway, GitHub API and npm.

## 1. x402 payments on Stellar (mainnet)

| Evidence | Network | What it proves |
|---|---|---|
| Billing account `GCLBBPON256CV7ATEHM5B54BOKNC7GX53MBINJ42MHVXGDMMZ3ZWKBHP` | mainnet | **36 settled x402 payments**, 3 payers, across 10 distinct days, 9 Jul – 29 Sep 2026 |
| `18f7dcab...e32fb91` (first) … `b34630f6...aeef5788` (last) | mainnet | 10 purchases routed through AgentLedger's (a separate company) policy engine, each settled on Stellar |
| `0c533088...` | mainnet, 3 Sep 2026 | One escrow release (0.4985 USDC), separate from the x402 payments above |

**Honest limit:** the last payment to the billing account was 29 Sep 2026. The AgentLedger batch was an integration test we requested, not organic usage.

## 2. Pre-sign policy hook (testnet)

| Evidence | Network | What it proves |
|---|---|---|
| `eefd5799...6bb81a6b3` | testnet, ledger 4958811, 1 Oct 2026 | One signed ALLOW (0.02 USDC) |
| DENY and STALE cases, same run | testnet | No transaction exists for either — that absence is the proof |
| Issue #96 (public), adversarial collaboration with an external researcher | GitHub | One month of adversarial testing against the hook |

## 3. Audit Trail: verifiable receipts

| Evidence | Network | What it proves |
|---|---|---|
| `QmVWZM1i9qusiTfNAT9QdSFYJNEwQUXtnWuSkrCqRAnGEu` + tx `cc5740ae...06b577808a` | mainnet, 18 Oct 2026 | A receipt binding the hash of a real settled Stellar payment |
| `QmWnt7mQNYB6RgFW9AUPxHsw1B5GerR6bJPHiCZXQLKdCH` + tx `9c37b4bc...653a5f756a` | mainnet, 23 Oct 2026 | Same, for a paid quote |
| `QmUoapw3ya1pNkWChZZCLWq1z2yUZffnrEtt5W3LXc2KzM` | 29 Oct 2026 | Receipt signed with a Stellar key (`nirium-audit-v1:<sha256>`) |
| `nirium.xyz/verify` | live | Anyone can paste any CID and verify it independently |
| `nirium.xyz/keys` | live | Anyone can generate their own key and anchor their own record |

**Honest limit:** the ledger of anchors lives on IPFS, not Stellar itself — present this as "a receipt tied to a Stellar payment," never as "stored on Stellar."

## 4. External users

| Evidence | Network | What it proves |
|---|---|---|
| `angeldavid218`, CID `QmP7kpzFAzB5XNZVvsmmV71WCitiqYqTJN72dBrfC8BaAe` | testnet, 25 Oct | Independent user, own key |
| `santy8151`, CID `QmdiC1867LKxf8HZt7vEeNNL4fthfjkKGkDMJdfLnkm5xp` | testnet, 28 Oct | Independent user, own key |
| Lucas Cifuentes / AegisOS | testnet, 1 Nov | Independent user, own key |
| Alx Hernández / CodeDeityX | testnet, 2 Nov | Independent user, own key |
| Pako Méndez (Costa Rica), CID `QmSXQr1MtxtXHmAWpd2mtJPenfkRWRLH4SCLVLV2HEYTsu` | testnet, 2 Nov | Independent user; returned unprompted and repeated the flow unassisted using a different tool |
| Brayan / Dynerox, CID `QmYsP9hD5CA1PXDu9qqjEGjrvioYn6Fy45ULetKkibxYQZ` | mainnet, 30 Oct | Independent user, own key, workshop attendee |

**Honest limit:** six is a small sample, stated as such. Self-test anchors (`selftest-nirium`) are never counted.

## 5. Evidence-gated escrow release (Trustless Work, testnet)

| Evidence | Network | What it proves |
|---|---|---|
| Contract `CADMJSOMBSHUW2LMETBUOVH2CSVY3EDISY4V7UMH7TDU2LE5XRCEULAG`: deploy `a0ed118a...85719850`, funding `8769aba1...98e4856cf` | testnet, 10/11 Oct 2026 | A real escrow deployed and funded |
| Milestone 1 DENY `Qmbwr5eYNex7pzvCSWVu8Q7h4bvfLzkukDu7XXtR7fnkYs` | testnet | Tampered evidence — nothing releases |
| Milestone 2 ALLOW `QmSpgUkiJnCfdALUtHXocKQ8GtGaG4LsxUWEoUDFDruWXN` | testnet | Valid evidence — the milestone releases |

## 6. MPP (testnet only)

`4d20d864...e6c10236` (pull), `e70cfcb8...df679f167` (push), `be7865f1...9cc228ff03` (pull), ledgers 5200999-5201006, 15 Oct 2026. Never described as live on mainnet.

## 7. Treasury (mainnet, self-funded)

Four `rebalance()` calls on mainnet, 6 Aug 2026 01:54-02:29 UTC, from RebalanceManager `GCEAC7KKHLSPNHEO3N662N57ABRQZQ7QDVIZWQSQAUJZDMHU6ZEH7MNI`: `b7bf6d70...eab00f840a9`, `9f0e7e03...2ecc8b68f033`, `d8bec2b4...f6330b1`, `ccae5347...11a9b7f45`. Team's own funds, self-directed.

## 8. External open-source contributions (GitHub API, updated 4 Nov)

**20 pull requests merged by external maintainers** (18 Eras256, 2 M0nsxx):
- **Nirium (10):** stellar-dev-skill [#96](https://github.com/stellar/stellar-dev-skill/pull/96), [#97](https://github.com/stellar/stellar-dev-skill/pull/97), [#150](https://github.com/stellar/stellar-dev-skill/pull/150); stellar-mpp-sdk [#69](https://github.com/stellar/stellar-mpp-sdk/pull/69); pollar-apps [#30](https://github.com/pollar-xyz/pollar-apps/pull/30); Trustless-Work agentic-escrow-research [#1](https://github.com/Trustless-Work/agentic-escrow-research/pull/1), [#2](https://github.com/Trustless-Work/agentic-escrow-research/pull/2), [#3](https://github.com/Trustless-Work/agentic-escrow-research/pull/3), [#4](https://github.com/Trustless-Work/agentic-escrow-research/pull/4), [#9](https://github.com/Trustless-Work/agentic-escrow-research/pull/9)
- **x402 core (4, shared across the team):** [#3138](https://github.com/x402-foundation/x402/pull/3138), [#3215](https://github.com/x402-foundation/x402/pull/3215), [#3338](https://github.com/x402-foundation/x402/pull/3338), [#3339](https://github.com/x402-foundation/x402/pull/3339)

## 9. Packages

npm: `nirium-cli@3.0.1`, `nirium@0.16.1`, `nirium-mcp@0.6.3`. Listed on skills.stellar.org. `nirium.xyz/stats` is live — our own source, presented as supporting data, not third-party proof.

## 10. Public recognition (verified 3 Nov 2026)

| Event | What it proves |
|---|---|
| **ETH Cinco de Mayo 2026** | Finalist, 10 of 30+ applicants, public tweet from `@ETHCincoDeMayo`, 15 Jul 2026 |
| **BBVA Open Deal / "The Open Deal Room by Stellar"** | 1 of 6 Stellar ecosystem startups invited to pitch investors, 21 May 2026, Torre BBVA CDMX |
