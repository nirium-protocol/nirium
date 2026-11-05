# Nirium: Evidence Index

Last verified live: 4 Nov 2026, against Horizon (mainnet/testnet), the Pinata gateway, GitHub API and npm. Every item below links directly to its own evidence. Check any of them independently.

## 1. x402 payments on Stellar (mainnet)

| Evidence | Network | What it proves |
|---|---|---|
| Billing account [`GCLBBPON...KBHP`](https://stellar.expert/explorer/public/account/GCLBBPON256CV7ATEHM5B54BOKNC7GX53MBINJ42MHVXGDMMZ3ZWKBHP) | mainnet | **36 settled x402 payments**, 3 payers, across 10 distinct days, 9 Jul to 29 Sep 2026 |
| [First tx](https://stellar.expert/explorer/public/tx/18f7dcab48087800cefb319a04c17291376df053805763fe3e952d472e32fb91) to [last tx](https://stellar.expert/explorer/public/tx/b34630f6637d6773ad4f7378dac8690ae6d1809173ff9c9541d22165aeef5788) | mainnet | 10 purchases routed through AgentLedger's (a separate company) policy engine, each settled on Stellar |
| [Escrow release tx](https://stellar.expert/explorer/public/tx/0c533088ab6326a78b9f79c197b7636ca4662a0d72562968ddea37f370a8192b) | mainnet, 3 Sep 2026 | One escrow release (0.4985 USDC), separate from the x402 payments above |

**Honest limit:** the last payment to the billing account was 29 Sep 2026. The AgentLedger batch was an integration test we requested, not organic usage.

## 2. Pre-sign policy hook (testnet)

| Evidence | Network | What it proves |
|---|---|---|
| [Signed ALLOW tx](https://stellar.expert/explorer/testnet/tx/eefd57995733c29fd1ba8244b783419015af642073e9c918a0d732a6bb81a6b3) | testnet, ledger 4958811, 1 Oct 2026 | One signed ALLOW (0.02 USDC) |
| DENY and STALE cases, same run | testnet | No transaction exists for either. That absence is the proof |
| [Issue #96](https://github.com/nirium-protocol/nirium/issues/96), adversarial collaboration with an external researcher | GitHub | One month of adversarial testing against the hook |

## 3. Audit Trail: verifiable receipts

| Evidence | Network | What it proves |
|---|---|---|
| [CID](https://gateway.pinata.cloud/ipfs/QmVWZM1i9qusiTfNAT9QdSFYJNEwQUXtnWuSkrCqRAnGEu) + [tx](https://stellar.expert/explorer/public/tx/cc5740aebf850194532392a1d216c2af620c70a7c46c8b36a0ea4a06b577808a) | mainnet, 18 Oct 2026 | A receipt binding the hash of a real settled Stellar payment |
| [CID](https://gateway.pinata.cloud/ipfs/QmWnt7mQNYB6RgFW9AUPxHsw1B5GerR6bJPHiCZXQLKdCH) + [tx](https://stellar.expert/explorer/public/tx/9c37b4bc38094b529ff8f05bd8b0734761fed0d92861e27ae35783653a5f756a) | mainnet, 23 Oct 2026 | Same, for a paid quote |
| [CID](https://gateway.pinata.cloud/ipfs/QmUoapw3ya1pNkWChZZCLWq1z2yUZffnrEtt5W3LXc2KzM) | 29 Oct 2026 | Receipt signed with a Stellar key (`nirium-audit-v1:<sha256>`) |
| [nirium.xyz/verify](https://nirium.xyz/verify) | live | Anyone can paste any CID and verify it independently |
| [nirium.xyz/keys](https://nirium.xyz/keys) | live | Anyone can generate their own key and anchor their own record |

**Honest limit:** the ledger of anchors lives on IPFS, not Stellar itself. Present this as "a receipt tied to a Stellar payment," never as "stored on Stellar."

## 4. External users

| Evidence | Network | What it proves |
|---|---|---|
| `angeldavid218`, [CID](https://gateway.pinata.cloud/ipfs/QmP7kpzFAzB5XNZVvsmmV71WCitiqYqTJN72dBrfC8BaAe), [issue #211](https://github.com/nirium-protocol/nirium/issues/211) | testnet, 25 Oct | Independent user, own key |
| `santy8151`, [CID](https://gateway.pinata.cloud/ipfs/QmdiC1867LKxf8HZt7vEeNNL4fthfjkKGkDMJdfLnkm5xp), [issue #222](https://github.com/nirium-protocol/nirium/issues/222) | testnet, 28 Oct | Independent user, own key |
| Lucas Cifuentes / AegisOS, [CID](https://gateway.pinata.cloud/ipfs/QmT7rXHMhjbHCcrPWARzjEGUXAYMHjkWRLwwd833qXmDue) + [tx](https://stellar.expert/explorer/testnet/tx/6c2adb922821cb464d03fdf46ae5c7ddb383417cf3f861b4731e48a6348a3f42), [issue #233](https://github.com/nirium-protocol/nirium/issues/233) | testnet, 1 Nov | Independent user, own key |
| Alx Hernández / CodeDeityX, [CID](https://gateway.pinata.cloud/ipfs/QmbG4hLWWCbzr34UJujVbNGw8gPgVohM9dG2eeBQqLyjRp), [issue #234](https://github.com/nirium-protocol/nirium/issues/234) | testnet, 2 Nov | Independent user, own key |
| Pako Méndez (Costa Rica), [CID](https://gateway.pinata.cloud/ipfs/QmSXQr1MtxtXHmAWpd2mtJPenfkRWRLH4SCLVLV2HEYTsu) (hash-only, unsigned) + [second anchor, signed with his own key](https://gateway.pinata.cloud/ipfs/QmUzKWHGZUc9sNSFuuzWhEk5Sko15w87EBBaNjVVjevcP6), [issue #243](https://github.com/nirium-protocol/nirium/issues/243) | testnet, 2-3 Nov | Independent user. Returned unprompted twice, repeating the flow unassisted with two different tools |
| Brayan / Dynerox, [CID](https://gateway.pinata.cloud/ipfs/QmYsP9hD5CA1PXDu9qqjEGjrvioYn6Fy45ULetKkibxYQZ) | mainnet, 30 Oct | Independent user, own key, workshop attendee |

**Honest limit:** six is a small sample, stated as such. Self-test anchors (`selftest-nirium`) are never counted.

## 5. Evidence-gated escrow release (Trustless Work, testnet)

| Evidence | Network | What it proves |
|---|---|---|
| Contract [`CADMJSOM...EULAG`](https://stellar.expert/explorer/testnet/contract/CADMJSOMBSHUW2LMETBUOVH2CSVY3EDISY4V7UMH7TDU2LE5XRCEULAG): [deploy](https://stellar.expert/explorer/testnet/tx/a0ed118a0a02ad87e09f0a743cc90d32199c931baf01b052cf49393e85719850), [funding](https://stellar.expert/explorer/testnet/tx/8769aba1b652b01ee2aafc9083fd1a775722690757e560fb43bd49f98e4856cf) | testnet, 10/11 Oct 2026 | A real escrow deployed and funded |
| Milestone 1 DENY, [CID](https://gateway.pinata.cloud/ipfs/Qmbwr5eYNex7pzvCSWVu8Q7h4bvfLzkukDu7XXtR7fnkYs) | testnet | Tampered evidence. Nothing releases |
| Milestone 2 ALLOW, [CID](https://gateway.pinata.cloud/ipfs/QmSpgUkiJnCfdALUtHXocKQ8GtGaG4LsxUWEoUDFDruWXN) | testnet | Valid evidence. The milestone releases |

## 6. MPP (testnet only)

[Pull tx](https://stellar.expert/explorer/testnet/tx/4d20d8648ce001c4e8e894725ad08a8dbcd3904e0024ca440728bc91e6c10236), [push tx](https://stellar.expert/explorer/testnet/tx/e70cfcb884c17d946210a000a627b7a9c316737a61a66ad2e42d905df679f167), [second pull tx](https://stellar.expert/explorer/testnet/tx/be7865f19b4daf9b60993eb4df900098663a55861a357fd7b67a059cc228ff03), ledgers 5200999-5201006, 15 Oct 2026. Never described as live on mainnet.

## 7. Treasury (mainnet, self-funded)

Four `rebalance()` calls on mainnet, 6 Aug 2026 01:54-02:29 UTC, from RebalanceManager [`GCEAC7KK...MNI`](https://stellar.expert/explorer/public/account/GCEAC7KKHLSPNHEO3N662N57ABRQZQ7QDVIZWQSQAUJZDMHU6ZEH7MNI): [tx1](https://stellar.expert/explorer/public/tx/b7bf6d7079aa128081ac2a5091cbff2da2b1e9f2157232209cf03eab00f840a9), [tx2](https://stellar.expert/explorer/public/tx/9f0e7e03cf3f17655b7e1b755c6a3fb5e65c499835424e440e601ecc8b68f033), [tx3](https://stellar.expert/explorer/public/tx/d8bec2b44a0b053d45f843aed21f87e217a2fe87d2761c1e2d3b04318f6330b1), [tx4](https://stellar.expert/explorer/public/tx/ccae5347739e1f65d319f4ce4c2b586661365ffc919e572a758fd2e11a9b7f45). Team's own funds, self-directed.

## 8. External open-source contributions (GitHub API, updated 4 Nov)

**20 pull requests merged by external maintainers** (18 Eras256, 2 M0nsxx):
- **Nirium (10):** stellar-dev-skill [#96](https://github.com/stellar/stellar-dev-skill/pull/96), [#97](https://github.com/stellar/stellar-dev-skill/pull/97), [#150](https://github.com/stellar/stellar-dev-skill/pull/150); stellar-mpp-sdk [#69](https://github.com/stellar/stellar-mpp-sdk/pull/69); pollar-apps [#30](https://github.com/pollar-xyz/pollar-apps/pull/30); Trustless-Work agentic-escrow-research [#1](https://github.com/Trustless-Work/agentic-escrow-research/pull/1), [#2](https://github.com/Trustless-Work/agentic-escrow-research/pull/2), [#3](https://github.com/Trustless-Work/agentic-escrow-research/pull/3), [#4](https://github.com/Trustless-Work/agentic-escrow-research/pull/4), [#9](https://github.com/Trustless-Work/agentic-escrow-research/pull/9)
- **x402 core (4, shared across the team):** [#3138](https://github.com/x402-foundation/x402/pull/3138), [#3215](https://github.com/x402-foundation/x402/pull/3215), [#3338](https://github.com/x402-foundation/x402/pull/3338), [#3339](https://github.com/x402-foundation/x402/pull/3339)

## 9. Packages

npm: [`nirium-cli@3.0.1`](https://www.npmjs.com/package/nirium-cli), [`nirium@0.16.1`](https://www.npmjs.com/package/nirium), [`nirium-mcp@0.6.3`](https://www.npmjs.com/package/nirium-mcp). Listed on [skills.stellar.org](https://skills.stellar.org). [nirium.xyz/stats](https://nirium.xyz/stats) is live, our own source, presented as supporting data, not third-party proof.

## 10. Public recognition (verified 3 Nov 2026)

| Event | What it proves |
|---|---|
| **[ETH Cinco de Mayo 2026](https://x.com/ETHCincoDeMayo/status/2077553531834237216)** | Finalist, 10 of 30+ applicants, public tweet 15 Jul 2026 |
| **[BBVA Open Deal / "The Open Deal Room by Stellar"](https://www.youtube.com/watch?v=kpN5YwGz1bk)** | 1 of 6 Stellar ecosystem startups invited to pitch investors, 21 May 2026, Torre BBVA CDMX |
| **["Código 402: Agentes que pagan"](https://luma.com/ljzvwv35)** | 5-session bootcamp + Demo Day (27 Nov), 10-27 Nov 2026, organized with Fernanda Tello (Blockchain Acceleration Foundation's Country Lead Mexico, Stellar) and Stellar ambassador Gerardo Vela. Covers a first Stellar account and payment, charging an API with x402, a spend-limited autonomous agent (pre-sign policy hook), and verifying a payment on the network (Audit Trail) - not x402 alone; each session adds to a public repo. Up to 15 minutes per session presents Nirium as one real case among several (BAF's neutrality condition) - a channel for adoption, users, integrations and reach, not just a workshop series |
