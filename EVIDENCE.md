# Nirium: Evidence Index

Last verified live: 5 Nov 2026, against Horizon (mainnet/testnet), the Pinata gateway, GitHub API and npm. Every item below links directly to its own evidence. Check any of them independently.

## 1. x402 payments on Stellar (mainnet)

| Evidence | Network | What it proves |
|---|---|---|
| Billing account [`GCLBBPON...KBHP`](https://stellar.expert/explorer/public/account/GCLBBPON256CV7ATEHM5B54BOKNC7GX53MBINJ42MHVXGDMMZ3ZWKBHP) | mainnet | **36 settled x402 payments**, 3 payers, across 9 distinct days, 9 Jul to 29 Sep 2026 |
| [First tx](https://stellar.expert/explorer/public/tx/18f7dcab48087800cefb319a04c17291376df053805763fe3e952d472e32fb91) to [last tx](https://stellar.expert/explorer/public/tx/b34630f6637d6773ad4f7378dac8690ae6d1809173ff9c9541d22165aeef5788) | mainnet | 10 purchases routed through AgentLedger's (a separate company) policy engine (all to `/market` at 0.05 USDC, 29 Sep 2026), each settled on Stellar. AgentLedger's wallet has settled 15 payments to our endpoints in total since 5 Aug 2026 (0.63 USDC); this row covers only the batch the linked transactions span |
| [Escrow release tx](https://stellar.expert/explorer/public/tx/0c533088ab6326a78b9f79c197b7636ca4662a0d72562968ddea37f370a8192b) | mainnet, 3 Sep 2026 | One escrow release (0.4985 USDC) to our own account, using the team's funds, separate from the x402 payments above |

**Honest limit:** the last payment to the billing account was 29 Sep 2026. None of the 36 comes from an external customer: 21 came from our own test wallets and 15 from AgentLedger's wallet, which our founder initially funded. AgentLedger's founder joined Nirium part-time in October 2026, after these payments. The AgentLedger batch was an integration test we requested, not organic usage, and it predates the pre-sign hook, so it did not go through it.

## 2. Pre-sign policy hook (testnet)

| Evidence | Network | What it proves |
|---|---|---|
| [Signed ALLOW tx](https://stellar.expert/explorer/testnet/tx/eefd57995733c29fd1ba8244b783419015af642073e9c918a0d732a6bb81a6b3) | testnet, ledger 4958811, 1 Oct 2026 | One signed ALLOW (0.02 USDC) |
| DENY and STALE cases, same run | testnet | No transaction exists for either. That absence is the proof |
| AgentLedger run: [tx 1](https://stellar.expert/explorer/testnet/tx/c0646b0e7ac186f26c539bc9ecacda286bb8764cc8d14d5fd33130a01850d5f4), [tx 2](https://stellar.expert/explorer/testnet/tx/63fe315ad191c12d8baab4e7d146dc4b8cd7bb0c0ce97261799021eb5163b71d), [tx 3](https://stellar.expert/explorer/testnet/tx/20b9f5a21f012001488630e4f5be7a64c69f6a39648ad53b092d724df3c9b57c), [public ledger](https://agentpayments.fi/api/x402/ledger?limit=2000) entries 595-604 | testnet, 8-9 Oct 2026 | An integration test with AgentLedger's policy engine: an ALLOW, a HOLD released after human approval, and a concurrent pair where one was allowed and the other blocked. AgentLedger reports this ran through the hook; its ledger does not name the hook |
| [Issue #96](https://github.com/nirium-protocol/nirium/issues/96), [issue #234](https://github.com/nirium-protocol/nirium/issues/234), credit in [PR #98](https://github.com/nirium-protocol/nirium/pull/98) | GitHub, 29 Sep to 2 Nov 2026 | Public adversarial review by an external researcher |

**Honest limit:** the hook has only been exercised on testnet. It has not run against mainnet traffic.

## 3. Audit Trail: verifiable receipts

| Evidence | Network | What it proves |
|---|---|---|
| [CID](https://gateway.pinata.cloud/ipfs/QmVWZM1i9qusiTfNAT9QdSFYJNEwQUXtnWuSkrCqRAnGEu) + [tx](https://stellar.expert/explorer/public/tx/cc5740aebf850194532392a1d216c2af620c70a7c46c8b36a0ea4a06b577808a) | mainnet, 18 Oct 2026 | TIA's receipt, signed with its own key, anchored about 3 seconds after a settled payment. The anchor is hash-only and does not embed the transaction hash |
| [CID](https://gateway.pinata.cloud/ipfs/QmWnt7mQNYB6RgFW9AUPxHsw1B5GerR6bJPHiCZXQLKdCH) + [tx](https://stellar.expert/explorer/public/tx/9c37b4bc38094b529ff8f05bd8b0734761fed0d92861e27ae35783653a5f756a) | mainnet, 23 Oct 2026 | TIA's second receipt, for a paid quote, anchored about 10 seconds after the payment. Same limit |
| [CID](https://gateway.pinata.cloud/ipfs/QmUoapw3ya1pNkWChZZCLWq1z2yUZffnrEtt5W3LXc2KzM) | testnet, 29 Oct 2026 | Our own workshop dry run: a receipt signed with a Stellar key (`nirium-audit-v1:<sha256>`) |
| [CID](https://gateway.pinata.cloud/ipfs/QmboKKkuwck3zvRx2bqnzUdDFkrEtc1VUHo6rrzm9nyBtD) + [tx](https://stellar.expert/explorer/testnet/tx/95717202be514ed0ae6d59d88c5950d79ff94b40dad709a430691ad6c4449b7b) | testnet, 1 Nov 2026 | Our Pollar adapter anchoring a receipt on a payment's success event. Our own self-test, not a feature Pollar has adopted |
| [Reporting summary](https://nirium-agent-mainnet.fly.dev/api/reporting/summary?network=mainnet) | mainnet, live | 33 anchors as of 5 Nov 2026, including our own tests and demos |
| [nirium.xyz/verify](https://nirium.xyz/verify) | live | Anyone can paste any CID and verify it independently |
| `POST /api/audit/log` on [testnet](https://nirium-agent.fly.dev/api/audit/info) and [mainnet](https://nirium-agent-mainnet.fly.dev/api/audit/info) | live | Anyone can anchor a record with no API key, free and rate-limited during the beta. Signing with your own Stellar key is optional. API keys for the rest of the API are at [nirium.xyz/keys](https://nirium.xyz/keys) |

**Honest limit:** the anchors live on IPFS, not on Stellar itself. TIA confirmed that both wallets in its two payments are its own, so those are integration tests, not customer payments.

## 4. External users

| Evidence | Network | What it proves |
|---|---|---|
| `angeldavid218`, [CID](https://gateway.pinata.cloud/ipfs/QmP7kpzFAzB5XNZVvsmmV71WCitiqYqTJN72dBrfC8BaAe), [issue #211](https://github.com/nirium-protocol/nirium/issues/211) | testnet, 25 Oct | Independent user, own key |
| `santy8151`, [CID](https://gateway.pinata.cloud/ipfs/QmdiC1867LKxf8HZt7vEeNNL4fthfjkKGkDMJdfLnkm5xp), [issue #222](https://github.com/nirium-protocol/nirium/issues/222) | testnet, 28 Oct | Independent user, own key |
| Lucas Cifuentes / AegisOS, [CID](https://gateway.pinata.cloud/ipfs/QmT7rXHMhjbHCcrPWARzjEGUXAYMHjkWRLwwd833qXmDue) + [tx](https://stellar.expert/explorer/testnet/tx/6c2adb922821cb464d03fdf46ae5c7ddb383417cf3f861b4731e48a6348a3f42), [issue #233](https://github.com/nirium-protocol/nirium/issues/233) | testnet, 1 Nov | Independent user, own key |
| Aldo Hernández / CodeDeityX, [CID](https://gateway.pinata.cloud/ipfs/QmbG4hLWWCbzr34UJujVbNGw8gPgVohM9dG2eeBQqLyjRp), [issue #234](https://github.com/nirium-protocol/nirium/issues/234) | testnet, 2 Nov | Independent user, own key |
| Pako Méndez (Costa Rica), [workshop CID](https://gateway.pinata.cloud/ipfs/QmS45Gs3KNExpB4jmmkb9pjN81vhwhB3FbF2Z6rrozNstZ), then [unsigned CID](https://gateway.pinata.cloud/ipfs/QmSXQr1MtxtXHmAWpd2mtJPenfkRWRLH4SCLVLV2HEYTsu) and [signed CID](https://gateway.pinata.cloud/ipfs/QmUzKWHGZUc9sNSFuuzWhEk5Sko15w87EBBaNjVVjevcP6), [issue #243](https://github.com/nirium-protocol/nirium/issues/243) | mainnet, 2 Nov, then testnet, 2-3 Nov (UTC) | Independent user, own key at the workshop. Anchored two more records afterward, with two different tools |
| Brayan / Dynerox, [CID](https://gateway.pinata.cloud/ipfs/QmYsP9hD5CA1PXDu9qqjEGjrvioYn6Fy45ULetKkibxYQZ) | mainnet, 30 Oct | Independent user, own key, workshop attendee |

**Honest limit:** six is a small sample, stated as such. Key ownership and not being funded by the team are self-declared. Self-test anchors (`selftest-nirium`) are never counted.

Not counted as users above:

| Evidence | Network | What it proves |
|---|---|---|
| AgentRail, [CID](https://gateway.pinata.cloud/ipfs/QmNjUumAtr2qBqVoJTCFtQvLSGJckhbHXh7VUDiGxMQLca), [repo](https://github.com/SorobanAgents/agentrail) | testnet, 4 Nov | One signed test anchor, with a key the team describes as its contract deployer key. Not production use |
| Edgar Ramírez Flores (TIA), [CID](https://gateway.pinata.cloud/ipfs/QmZZPQLJAjjNqYL7RocrKLpFtmPpveqLPi9GenkvDozb6m) | mainnet, 30 Oct | Workshop attendee, separate personal key. Already part of the TIA integration |

## 5. Evidence-gated escrow release (our pilot on Trustless Work escrow, testnet)

| Evidence | Network | What it proves |
|---|---|---|
| Contract [`CADMJSOM...EULAG`](https://stellar.expert/explorer/testnet/contract/CADMJSOMBSHUW2LMETBUOVH2CSVY3EDISY4V7UMH7TDU2LE5XRCEULAG): [deploy](https://stellar.expert/explorer/testnet/tx/a0ed118a0a02ad87e09f0a743cc90d32199c931baf01b052cf49393e85719850), [funding](https://stellar.expert/explorer/testnet/tx/8769aba1b652b01ee2aafc9083fd1a775722690757e560fb43bd49f98e4856cf) | testnet, 10/11 Oct 2026 | A real escrow deployed and funded |
| Milestone 1 DENY, [CID](https://gateway.pinata.cloud/ipfs/Qmbwr5eYNex7pzvCSWVu8Q7h4bvfLzkukDu7XXtR7fnkYs) | testnet | Tampered evidence. Nothing releases |
| Milestone 2 ALLOW, [CID](https://gateway.pinata.cloud/ipfs/QmSpgUkiJnCfdALUtHXocKQ8GtGaG4LsxUWEoUDFDruWXN) | testnet | Valid evidence. The milestone [was approved](https://stellar.expert/explorer/testnet/tx/e86861557ad2896452a0d9fc5590de341654ddc311d4bbcd5d8763e3f6961e7b) and [released](https://stellar.expert/explorer/testnet/tx/429e550d2f05c6dd6316c8caab13605ee1f222d1ce40731d92c80f7f4bc5fc7c) |

**Honest limit:** we ran this pilot ourselves on Trustless Work's contracts. The release ran under the first version of the check (hash and milestone only). Both records are unsigned.

## 6. MPP (testnet only)

[Pull tx](https://stellar.expert/explorer/testnet/tx/4d20d8648ce001c4e8e894725ad08a8dbcd3904e0024ca440728bc91e6c10236), [push tx](https://stellar.expert/explorer/testnet/tx/e70cfcb884c17d946210a000a627b7a9c316737a61a66ad2e42d905df679f167), [second pull tx](https://stellar.expert/explorer/testnet/tx/be7865f19b4daf9b60993eb4df900098663a55861a357fd7b67a059cc228ff03), ledgers 5200999-5201006, 15 Oct 2026. Never described as live on mainnet.

## 7. Treasury (mainnet, self-funded)

Four `rebalance()` calls on mainnet, 6 Aug 2026 01:54-02:29 UTC, from RebalanceManager [`GCEAC7KK...MNI`](https://stellar.expert/explorer/public/account/GCEAC7KKHLSPNHEO3N662N57ABRQZQ7QDVIZWQSQAUJZDMHU6ZEH7MNI): [tx1](https://stellar.expert/explorer/public/tx/b7bf6d7079aa128081ac2a5091cbff2da2b1e9f2157232209cf03eab00f840a9), [tx2](https://stellar.expert/explorer/public/tx/9f0e7e03cf3f17655b7e1b755c6a3fb5e65c499835424e440e601ecc8b68f033), [tx3](https://stellar.expert/explorer/public/tx/d8bec2b44a0b053d45f843aed21f87e217a2fe87d2761c1e2d3b04318f6330b1), [tx4](https://stellar.expert/explorer/public/tx/ccae5347739e1f65d319f4ce4c2b586661365ffc919e572a758fd2e11a9b7f45). Team's own funds, self-directed.

## 8. External open-source contributions (GitHub API, updated 5 Nov)

**24 pull requests merged by external maintainers** (21 Eras256, 3 M0nsxx). The 18 below are for Nirium and x402 core; the other 6 are for the team's other projects:
- **Nirium (14):** stellar-dev-skill [#96](https://github.com/stellar/stellar-dev-skill/pull/96), [#97](https://github.com/stellar/stellar-dev-skill/pull/97), [#150](https://github.com/stellar/stellar-dev-skill/pull/150); stellar-mpp-sdk [#69](https://github.com/stellar/stellar-mpp-sdk/pull/69); pollar-apps [#30](https://github.com/pollar-xyz/pollar-apps/pull/30); Trustless-Work agentic-escrow-research [#1](https://github.com/Trustless-Work/agentic-escrow-research/pull/1), [#2](https://github.com/Trustless-Work/agentic-escrow-research/pull/2), [#4](https://github.com/Trustless-Work/agentic-escrow-research/pull/4), [#9](https://github.com/Trustless-Work/agentic-escrow-research/pull/9), [#10](https://github.com/Trustless-Work/agentic-escrow-research/pull/10), [#11](https://github.com/Trustless-Work/agentic-escrow-research/pull/11) (Eras256), [#3](https://github.com/Trustless-Work/agentic-escrow-research/pull/3), [#12](https://github.com/Trustless-Work/agentic-escrow-research/pull/12), [#13](https://github.com/Trustless-Work/agentic-escrow-research/pull/13) (M0nsxx)
- **x402 core (4, shared across the team):** [#3138](https://github.com/x402-foundation/x402/pull/3138), [#3215](https://github.com/x402-foundation/x402/pull/3215), [#3338](https://github.com/x402-foundation/x402/pull/3338), [#3339](https://github.com/x402-foundation/x402/pull/3339)

## 9. Packages

npm: [`nirium-cli@3.0.1`](https://www.npmjs.com/package/nirium-cli), [`nirium@0.17.0`](https://www.npmjs.com/package/nirium), [`nirium-mcp@0.6.4`](https://www.npmjs.com/package/nirium-mcp), [`nirium-pollar-adapter@0.6.0`](https://www.npmjs.com/package/nirium-pollar-adapter). PyPI: [`nirium@0.11.1`](https://pypi.org/project/nirium/). Listed on [skills.stellar.org](https://skills.stellar.org). [nirium.xyz/stats](https://nirium.xyz/stats) is live, our own source, presented as supporting data, not third-party proof.

## 10. Public recognition and community (verified 3 Nov 2026, bootcamp and newsletter 5 Nov)

| Event | What it proves |
|---|---|
| **[ETH Cinco de Mayo 2026](https://x.com/ETHCincoDeMayo/status/2077553531834237216)** | Finalist, 10 of 30+ applicants, public tweet 15 Jul 2026 |
| **[BBVA Open Deal / "The Open Deal Room by Stellar"](https://www.youtube.com/watch?v=kpN5YwGz1bk)** | 1 of 6 Stellar ecosystem startups invited to pitch investors, 21 May 2026, Torre BBVA CDMX |
| **[BAF newsletter](https://bafs-newsletter.beehiiv.com/p/recap-de-la-call-becas-hubs-y-un-summit-en-juego-tu-proyecto-est-listo)** | Nirium featured by the Blockchain Acceleration Foundation, 27 Jun 2026 |
| **["Código 402: Agentes que pagan"](https://luma.com/ljzvwv35)** | Online bootcamp, 5 sessions plus Demo Day, 10-27 Nov 2026, hosted by the Blockchain Acceleration Foundation with Fernanda Tello (Country Lead Mexico), Gerardo Vela, Giovanny Amador and Monserrat Mendoza. Sessions: first Stellar payment, charging for an API with x402, an agent that pays within a spending limit, and verifying a payment on the network. Nirium appears as one real case among several, up to 15 minutes per session. Scheduled, so this shows the program exists, not its results |
