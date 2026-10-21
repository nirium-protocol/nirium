# Contributing to Nirium

Thank you for your interest in contributing. This repository holds the open-source developer toolkit: the TypeScript SDK, the Python SDK, the CLI, the MCP server, examples, and docs. It does not contain the agent runtime or the Soroban contracts, which are maintained privately.

> **Note:** Nirium operates under the [Stellar Code of Conduct](https://github.com/Eras256/Nirium/blob/main/CODE_OF_CONDUCT.md). Violations can be reported to [niriumprotocol@gmail.com](mailto:niriumprotocol@gmail.com) or [community@stellar.org](mailto:community@stellar.org).

---

## Development Setup

### Prerequisites

- Node.js 20+
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
| `npm run test` | Jest |

---

## Repository Structure

```
nirium/
├── packages/sdk/           → TypeScript SDK (npm: nirium)
├── packages/sdk-python/    → Python SDK (pip: nirium)
├── packages/mcp/           → MCP server (npm: nirium-mcp)
├── packages/cli/           → CLI (npm: nirium-cli)
├── docs/                   → Quickstarts and guides
└── examples/               → Runnable integrations (Express, Next.js, treasury vault)
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

Reviewers will not follow up for missing context — include a clear description of what changed and why.

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

Every commit produced with AI assistance carries a `Co-Authored-By: <model> <noreply@anthropic.com>` trailer, where `<model>` is the model that actually produced that commit (for example `Claude Sonnet 5.5` or `Claude Opus 5.5`), never a fixed name. This is a factual disclosure of how the commit was produced — it is never stripped to make a commit look human-authored, and never added where it doesn't apply to fake the opposite. If you use AI assistance in your own contributions, disclose it the same way.

### Dependency updates

Dependabot (`.github/dependabot.yml`) opens update PRs every Monday for `packages/sdk`, `packages/cli`, `packages/mcp` and the GitHub Actions used in `.github/workflows/`. Each package gets at most one minor/patch PR a week; majors come as separate PRs, and `@stellar/stellar-sdk`, `@x402/*` and `@stellar/mpp` majors are grouped so they move together.

These PRs are reviewed like any other PR: by the code owner of the path (CODEOWNERS requests @M0nsxx for `packages/cli`), and otherwise by a maintainer (@Eras256). Nothing is auto-merged. Before approving, the reviewer checks that the package builds and its tests pass, and, for majors or the Stellar/x402 group, reads the changelog and the peer-dependency note in `.github/workflows/sdk-test.yml`.

### Code Style

- **TypeScript:** strict mode, explicit types for all public APIs
- **Python:** type hints on public functions
- **Comments:** only when the *why* is non-obvious — no narration of what the code does

---

## Security

If you discover a security vulnerability, **do not open a public issue.**

Email: **niriumprotocol@gmail.com**

Include: description, reproduction steps, potential impact, and any suggested remediation.

---

## License

By contributing, you agree that your contributions will be licensed under the [Apache-2.0 License](LICENSE).

---

*Updated October 20, 2026*
