# Changelog

All notable changes to the `nirium-mcp` package are documented here.

## Unreleased

## 0.6.11 - 2026-11-22

README: the Audit Trail note said IPFS content "cannot be deleted". Corrected: nobody can guarantee deletion from IPFS, because anyone with the CID may have kept a copy; the advice is unchanged (anchor a hash, not personal data). No code change.

## 0.6.10 - 2026-11-21

From #388 (thanks to @sparkysolutions10-pixel):

- An empty `AGENT_API_URL`, `STELLAR_SECRET_KEY`, `NIRIUM_API_KEY` or `SOROBAN_RPC_URL` now counts as unset and falls back to the default. Before, an empty `SOROBAN_RPC_URL` turned testnet payments off and an empty `AGENT_API_URL` broke every call. Options passed in code still win.
- If the x402 signer or the MPP client can't start (for example, a malformed `STELLAR_SECRET_KEY`), paid tools are turned off and say why ("Payment tools unavailable: Failed to initialize ...") instead of failing later with an opaque error.
- The server is built by an exported `createNiriumMcpServer(options)`, which the new test suite uses. `npx nirium-mcp` starts the same way as before.
- A test for every tool, run in CI together with the clean-install check.

## 0.6.9 - 2026-11-19

`anchor_audit_record`: the tool description no longer says "immutable integrity seal". It now says tamper-evident, not tamper-proof (a changed document no longer matches its CID). README: same wording, and says `anchoredAt` comes from the node's clock.

## 0.6.8 - 2026-11-17

README: a short note on what a receipt adds over the ledger, with a link to the design FAQ. No code change.

## 0.6.7 - 2026-11-17

Package description and keywords updated. No code change.

## 0.6.6 - 2026-11-16

### Changed

- `deploy_treasury_vault`, `deposit_to_treasury_vault`, `set_treasury_rebalance_manager` and `build_treasury_rebalance` now say they are invite-only on mainnet (institutional key; the agent returns 403 to free keys since 16-nov-2026) and open on testnet. Withdraw is unchanged. Descriptions and README only, no behaviour change.

## 0.6.5 - 2026-11-12

### Changed

- README leads with Audit Trail (`anchor_audit_record`) and how to verify its receipts. Docs only, no tool change.

## 0.6.4 - 2026-11-05

### Fixed

- `npm install nirium-mcp` left the server unable to boot at all on a clean install - `Cannot find package 'viem'` from `mppx`'s own EVM client code (`mppx/dist/evm/client/Charge.js`), a peer dependency `mppx` requires but never declares in `peerDependenciesMeta` ([#118](https://github.com/nirium-protocol/nirium/issues/118)). `viem` is now a direct dependency, so npm installs it automatically.
- Descriptions (`package.json`, README, and the `get_reporting_summary` tool text) no longer say "x402/MPP" as if both were settling payments. No MPP payment has ever settled; the MPP tools are described as experimental.
- The local-dev `AGENT_API_URL` default (README and `src/index.ts`'s own usage example) was `http://127.0.0.1:3001` - the documented quickstart runs the agent on `3002` via `master.ts`. Now `3002`.

### Changed

- `@x402/core`/`@x402/fetch`/`@x402/stellar` ^2.28.0 -> ^2.29.0.

## 0.6.3 - 2026-10-11

### Added

- README: documents the 11 Treasury tools (`get_treasury_info`, `get_treasury_vault`, `get_treasury_vaults`, `get_treasury_strategy_asset`, `deploy_treasury_vault`, `deposit_to_treasury_vault`, `withdraw_from_treasury_vault`, `set_treasury_rebalance_manager`, `build_treasury_rebalance`, `submit_treasury_tx`, `execute_treasury_rebalance`), missing since they shipped. Text taken from each tool's own description in the code. Says which build an unsigned XDR, which signs with Nirium's own key (`execute_treasury_rebalance`, invite-only), and under what condition.

### Fixed

- `prepublishOnly: npm run build` added, so a future publish can't skip the build the way 0.6.1 did.
- README: "Run from source" and the LICENSE link pointed to the old `nirium-sdk` repo.
- Removed long dashes from README.

## 0.6.2 - 2026-10-11

Replaces 0.6.1, which was published broken (see below). No code change beyond the version bump.

### Fixed

- 0.6.1 was published from a directory where `npm install` had failed (the preexisting `@stellar/stellar-sdk` peer conflict with `@stellar/mpp`) and `npm run build` never ran, so the tarball shipped without `dist/`. `nirium-mcp@0.6.1` is deprecated on npm; do not install it.

## 0.6.1 - 2026-10-11

No new tools and no change to any tool. Package metadata and the reported version only.

### Changed

- The server version, the startup log line and the code header no longer have `0.6.0` written by hand. The version is read from `package.json`, so the server reports the version that was installed (0.6.0 reported itself correctly only until the next bump).
- `package.json` `repository` now points to `nirium-protocol/nirium` with `directory: packages/mcp`, and `bugs.url` to `nirium-protocol/nirium/issues` (both pointed to the old `nirium-sdk` repo).
