# x402 policy: Open Policy Agent behind the pre-sign hook

A small, runnable bridge between the SDK's [pre-sign policy hook](../../packages/sdk/README.md#pre-sign-policy-hook-experimental) (`initX402({ policy })`, experimental since 0.16.0) and an [Open Policy Agent](https://www.openpolicyagent.org/) server. Every `x402Fetch()` sends the decoded payment to OPA before signing, and OPA's answer becomes `ALLOW` or `DENY`.

**This is a reference, not a guarantee.** Read [What this does not solve](#what-this-does-not-solve) before relying on it.

## What it does

- **Asks OPA with the decoded context.** `evaluate()` POSTs `{ input: { amount, destination, asset, network, agent } }` to OPA's Data API (`/v1/data/nirium/x402/decision?provenance`). The values come from `ctx.authorization` (what is actually signed) and `ctx.signer`.
- **Ships a small Rego policy** ([`policy/x402.rego`](policy/x402.rego)): a per-payment cap (1 USDC, 7 decimals) and a destination allowlist, with Rego unit tests in [`policy/x402_test.rego`](policy/x402_test.rego).
- **Fails closed.** OPA unreachable, a non-200 answer, a body that is not JSON, an undefined rule, a result that is not `{ allow: boolean, reason?: string }`, or no bundle revision: `evaluate()` throws, and the SDK signs nothing. Nothing in the example catches those errors. A slow OPA is cut by the SDK's deadline (`timeoutMs`): the request gets the hook's abort signal.
- **Bound, short-lived ALLOW.** An `ALLOW` echoes the exact `ctx.contextHash` and carries `expiresAt = now + ttlMs` (default 2 s). `requireExpiry: true` is set on the hook.
- **Bundle revision as policy version.** With `?provenance`, OPA reports the revision of each loaded bundle (`provenance.bundles.<name>.revision`, taken from the bundle's `.manifest`). That revision is the `policyVersion` of every decision, and `currentVersion()` asks OPA for it again right before signing. If the bundle changed in between, the SDK refuses with `STALE`.

## Run OPA

From this directory, with Docker:

```bash
docker run --rm -p 8181:8181 -v "$PWD/policy:/policy:ro" -w / \
  openpolicyagent/opa run --server --addr :8181 --watch --bundle policy
```

Or with the `opa` binary: `opa run --server --addr 127.0.0.1:8181 --watch --bundle policy`.

OPA names a bundle loaded with `--bundle` after the path you pass, so `--bundle policy` reports it as `policy`. If you pass another path, set `bundle` in the config to match. `--watch` reloads the bundle when the files change; bump `revision` in `policy/.manifest` on every change, so that a decision made before it is refused as `STALE`.

```bash
opa test policy -v   # Rego unit tests
```

## Use

```typescript
import { OpaPolicy } from './src/opa-policy.ts';

const opa = new OpaPolicy({
  url: 'http://127.0.0.1:8181',
  path: 'nirium/x402/decision', // default
  bundle: 'policy',             // default: name OPA reports in provenance
  ttlMs: 2_000,
});

agent.initX402({ signer, network: 'stellar:pubnet', policy: opa.hook() });
```

Requires Node >= 22.12 (npm 10), the same as the SDK.

```bash
npm install
npm test        # node:test via tsx, OPA is mocked, no network
npm run typecheck
OPA_URL=http://127.0.0.1:8181 npm start   # demo against the OPA started above
```

The SDK is referenced as `file:../../packages/sdk`. `src/` imports only its types; `test/hook-integration.test.ts` also runs the SDK's real pre-sign gate (`createPolicyGatedSigner` from the built `dist/`, the same one `initX402({ policy })` installs) with a mocked OPA, so build the SDK once (`cd ../../packages/sdk && npm install --legacy-peer-deps && npm run build`, as the SDK CI does) before `typecheck`.

## What this does not solve

These are the limits listed in the SDK README (from [#96](https://github.com/nirium-protocol/nirium/issues/96)). This example does not remove them.

- **L01, pending-capacity reservation.** The Rego policy only looks at one payment. Two concurrent requests are evaluated independently, so an aggregate limit (daily budget, total exposure) is not held here; OPA is stateless per query. For a per-agent daily cap with atomic check-and-commit, see [`x402-policy-daily-budget`](../x402-policy-daily-budget/).
- **L02, same-process signer access.** This is a check on the agent side. Any code in the same process that holds the raw signer (or replaces its `signAuthEntry`) can sign without asking OPA. Nothing on-chain enforces the policy.
- **Version check is not atomic with signing.** As the SDK README says, `currentVersion()` narrows the stale-ALLOW window; it does not close it. It also only detects a change if the bundle revision changes: editing the Rego without bumping `.manifest` is invisible.
- **The OPA connection is yours to secure.** The example uses plain HTTP to a local OPA and no authentication. Anyone who can answer on that URL decides what gets signed.
