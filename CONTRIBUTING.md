# Contributing to Nirium

Thank you for your interest in contributing. This repository holds the open-source developer toolkit: the TypeScript SDK, the Python SDK, the CLI, the MCP server, examples, and docs. It does not contain the agent runtime or the Soroban contracts, which are maintained privately.

> **Note:** Nirium operates under the [Stellar Code of Conduct](https://github.com/nirium-protocol/nirium-core/blob/main/CODE_OF_CONDUCT.md). Violations can be reported to [niriumprotocol@gmail.com](mailto:niriumprotocol@gmail.com) or [community@stellar.org](mailto:community@stellar.org).

---

## Development Setup

### Prerequisites

- Node.js >=22.12.0 (`@stellar/stellar-sdk` 16.x requires it)
- Python 3.10+ (for `packages/sdk-python`)
- Git

### Getting Started

```bash
git clone https://github.com/nirium-protocol/nirium.git
cd nirium

# TypeScript SDK / CLI / MCP server each have their own package.json
cd packages/sdk && npm install && npm run build

# Python SDK
cd packages/sdk-python && pip install -e .
```

### Package Scripts (TypeScript packages)

| Script | Description |
|--------|-------------|
| `npm run build` | Compile TypeScript (`tsc`) |
| `npm run dev` | Watch mode |
| `npm run lint` | ESLint |
| `npm test` | Run the package's tests (Jest in the SDK, `node --test` in the CLI) |

---

## Repository Structure

```
nirium/
├── packages/sdk/           → TypeScript SDK (npm: nirium)
├── packages/sdk-python/    → Python SDK (pip: nirium)
├── packages/mcp/           → MCP server (npm: nirium-mcp)
├── packages/cli/           → CLI (npm: nirium-cli)
├── actions/verify-audit-cid/ → GitHub Action that verifies an Audit Trail CID in CI
├── skills/                 → Agent skill (nirium-agentic-payments)
├── community/              → Contributor programs (Niriumtober badges)
├── docs/                   → Quickstarts and guides
└── examples/               → 24 runnable integrations (TypeScript, Python, Go, Rust, Unity, policy hooks)
```

---

## Contribution Guidelines

### Pull Requests

1. Fork the repository
2. Create a feature branch: `git checkout -b feat/my-feature`
3. Make your changes
4. Run tests and lint for the package(s) you touched
5. Commit using conventional commits (see below)
6. Push and open a PR against `main`

Reviewers will not follow up for missing context - include a clear description of what changed and why.

### Stellar Wave issues (Drips)

Issues labeled [`Stellar Wave`](https://github.com/nirium-protocol/nirium/issues?q=label%3A%22Stellar+Wave%22) are part of [Stellar Wave](https://www.drips.network/wave). Apply on Drips with a short plan; we assign by merit, usually one issue at a time until you have a merged PR here. Each issue lists its own "Done when" and evidence. In short:

- Use your **own** testnet keys (Friendbot is fine). Never ask for, or use, a key or funds from us.
- Put the transaction hashes and receipt CIDs from your own run in the README, and a short screen recording in the PR.
- Link the issue in the PR (`Closes #123`). A PR from outside the team needs one maintainer approval; CI on a fork runs after a maintainer approves it.

Only merged work counts. The running list is in [EVIDENCE.md](EVIDENCE.md), section 14.

Questions about an issue, or want to show what you are building? Join the community on [Telegram](https://t.me/+SbqIpneqUZc2NjJh) or [Discord](https://discord.gg/gAAznKrSQZ). New Wave issues and updates are posted there too. Applications and assignments still happen on Drips, and reviews on GitHub.

### Commit Convention

We follow [Conventional Commits](https://www.conventionalcommits.org/):

| Prefix | Use for |
|--------|---------|
| `feat:` | New feature |
| `fix:` | Bug fix |
| `docs:` | Documentation only |
| `refactor:` | Code change that neither fixes a bug nor adds a feature |
| `test:` | Adding or updating tests |
| `chore:` | Maintenance, tooling, CI |

### AI Assistance Disclosure

Every commit produced with AI assistance carries a `Co-Authored-By: <model> <noreply@anthropic.com>` trailer, where `<model>` is the model that actually produced that commit (for example `Claude Sonnet 5.5` or `Claude Opus 5.5`), never a fixed name. This is a factual disclosure of how the commit was produced - it is never stripped to make a commit look human-authored, and never added where it doesn't apply to fake the opposite. If you use AI assistance in your own contributions, disclose it the same way.

### AI-assisted code review

Pull requests between the two maintainers (@Eras256 and @M0nsxx) are often reviewed with help from Claude: the assistant reads the diff and drafts the review comment. From 15 Nov 2026 every review says so in its first line (`AI-assisted review (Claude)`), followed by what the approving maintainer checked personally, and that maintainer is responsible for the approval.

Many earlier reviews (October and November 2026) were drafted the same way, often in the pull request author's own Claude session, and pasted by the reviewer without saying so. This note is the disclosure for those. An approval in this repository means a second maintainer took responsibility for the change; it is not an independent audit. What you can check independently is authorship: each maintainer commits from their own account.

### Dependency updates

Dependabot (`.github/dependabot.yml`) opens update PRs every Monday for `packages/sdk`, `packages/cli`, `packages/mcp` and the GitHub Actions used in `.github/workflows/`. Each package gets at most one minor/patch PR a week; majors come as separate PRs, and `@stellar/stellar-sdk`, `@x402/*` and `@stellar/mpp` majors are grouped so they move together. Dependabot security updates can also open PRs for the examples (`examples/*`); those get the same review and are held while that example fails its typecheck.

These PRs are reviewed like any other PR: by the code owner of the path (CODEOWNERS requests @M0nsxx for `packages/sdk` and `packages/cli`), and otherwise by a maintainer (@Eras256). Nothing is auto-merged. Before approving, the reviewer checks that the package builds and its tests pass, and, for majors or the Stellar/x402 group, reads the changelog and the peer-dependency note in `.github/workflows/sdk-test.yml`.

### Code Style

- **TypeScript:** strict mode, explicit types for all public APIs
- **Python:** type hints on public functions
- **Comments:** only when the *why* is non-obvious - no narration of what the code does

---

## Security

If you discover a security vulnerability, **do not open a public issue.**

Email: **niriumprotocol@gmail.com**

Include: description, reproduction steps, potential impact, and any suggested remediation.

If the **Secret Scan** check fails on your PR, treat the key as leaked: revoke or rotate it, remove it from your branch (amend/rebase so no commit contains it), and push again. If it is a false positive or a public test vector, add a narrow, commented entry to `.gitleaks.toml` instead of disabling the check.

---

## License

By contributing, you agree that your contributions will be licensed under the [Apache-2.0 License](LICENSE).

---

*Updated November 22, 2026*
