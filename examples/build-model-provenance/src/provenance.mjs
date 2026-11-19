// Provenance helpers: hash an artifact, build a private record, anchor a public
// receipt through an Audit Trail node, and check weights against both.
// Uses only the Audit Trail HTTP API (POST /api/audit/log) and the published CLI.
import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { execFileSync, spawnSync } from 'node:child_process';
import { Keypair } from '@stellar/stellar-sdk';

export const SCHEMA = 'nirium-model-provenance/v1';
export const STATEMENT_PREFIX = 'nirium-audit-v1:';
export const TAG_PREFIX = 'wave11-';
export const DEFAULT_URL = 'https://nirium-agent.fly.dev';
const HEX64 = /^[0-9a-f]{64}$/;

export function sha256Hex(buf) {
  return crypto.createHash('sha256').update(buf).digest('hex');
}

export function sha256File(file) {
  // Streamed so multi-GB weights do not need to fit in memory.
  const h = crypto.createHash('sha256');
  const fd = fs.openSync(file, 'r');
  try {
    const chunk = Buffer.allocUnsafe(1 << 20);
    let n;
    while ((n = fs.readSync(fd, chunk, 0, chunk.length, null)) > 0) h.update(chunk.subarray(0, n));
  } finally {
    fs.closeSync(fd);
  }
  return h.digest('hex');
}

// Deterministic JSON (sorted keys, 2-space indent, trailing newline) so the
// record file's bytes, and therefore its sha-256, are reproducible.
export function canonicalize(value) {
  const sort = (v) =>
    Array.isArray(v)
      ? v.map(sort)
      : v && typeof v === 'object'
        ? Object.fromEntries(Object.keys(v).sort().map((k) => [k, sort(v[k])]))
        : v;
  return JSON.stringify(sort(value), null, 2) + '\n';
}

export function gitCommit(cwd = process.cwd()) {
  try {
    return execFileSync('git', ['rev-parse', 'HEAD'], { cwd, stdio: ['ignore', 'pipe', 'ignore'] }).toString().trim();
  } catch {
    return null;
  }
}

// Builds the PRIVATE record. It holds the details you would not publish
// (training config, data source names, commit). Only its hash goes public.
export function buildRecord({ artifactPath, kind = 'model', name, version, config = {}, dataSources = [], codeCommit, createdAt }) {
  if (!['model', 'dataset'].includes(kind)) throw new Error(`kind must be "model" or "dataset", got "${kind}"`);
  if (!name || !version) throw new Error('name and version are required');
  if (!codeCommit) throw new Error('code commit is required (pass --code-commit, or run inside a git checkout)');
  return {
    schema: SCHEMA,
    kind,
    name,
    version,
    artifact: { file: path.basename(artifactPath), bytes: fs.statSync(artifactPath).size, sha256: sha256File(artifactPath) },
    training: { config },
    data_sources: [...dataSources].sort(),
    code: { commit: codeCommit },
    created_at: createdAt ?? new Date().toISOString(),
  };
}

export function recordBytes(record) {
  return Buffer.from(canonicalize(record), 'utf8');
}

export function signerFromSecret(secret) {
  if (!secret) throw new Error('No signer key: set PROVENANCE_SIGNER_SECRET (create one with `npm run keygen`).');
  try {
    return Keypair.fromSecret(secret);
  } catch (err) {
    throw new Error(`Invalid Stellar secret key: ${err.message}`);
  }
}

export function buildTag(record, tag) {
  const t = tag ?? `${TAG_PREFIX}model-provenance-${record.name}-${record.version}`;
  if (!t.startsWith(TAG_PREFIX)) throw new Error(`tag must start with "${TAG_PREFIX}"`);
  return t;
}

// Anchors the record HASH (never the record) and signs
// `nirium-audit-v1:<sha256>` with the Stellar key. Returns the public receipt.
export async function anchorRecord(recordBuf, { keypair, tag, url = DEFAULT_URL, agentId = 'model-provenance', fetchFn = globalThis.fetch }) {
  const sha256 = sha256Hex(recordBuf);
  const statement = `${STATEMENT_PREFIX}${sha256}`;
  const signature = Buffer.from(keypair.sign(Buffer.from(statement, 'utf8'))).toString('base64');
  const res = await fetchFn(`${url.replace(/\/$/, '')}/api/audit/log`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ hash: sha256, tag, agent: { id: agentId, key: keypair.publicKey(), signature } }),
    signal: AbortSignal.timeout(20_000),
  });
  let data = null;
  try { data = await res.json(); } catch { /* non-JSON body */ }
  if (!res.ok) throw new Error(data?.error || `Audit node returned HTTP ${res.status}`);
  if (!data?.cid) throw new Error('Audit node response had no cid');
  return {
    cid: data.cid,
    sha256,
    statement,
    signer: keypair.publicKey(),
    tag,
    anchored_at: data.anchoredAt ?? null,
    gateway_url: data.gatewayUrl ?? null,
    network: 'stellar:testnet',
  };
}

// Public check, exactly what a third party runs: npx nirium-cli verify <cid> --hash <sha256>
export function verifyReceiptWithCli(receipt) {
  const r = spawnSync('npx', ['--yes', 'nirium-cli', 'verify', receipt.cid, '--hash', receipt.sha256, '--json'], { encoding: 'utf8' });
  let parsed = null;
  try { parsed = JSON.parse(r.stdout); } catch { /* keep null */ }
  return { ok: r.status === 0 && parsed?.ok === true, result: parsed, stderr: r.stderr };
}

// check-model: weights vs private record vs public receipt.
// Returns { ok, steps[] }. `verifyReceipt` is injectable so tests run offline.
export function checkModel({ artifactPath, recordBuf, receipt, verifyReceipt = verifyReceiptWithCli }) {
  const steps = [];
  const step = (name, ok, detail) => { steps.push({ name, ok, detail }); return ok; };

  let record;
  try { record = JSON.parse(recordBuf.toString('utf8')); } catch { record = null; }
  if (!step('record parses', record?.schema === SCHEMA, record ? record.schema : 'not JSON')) return { ok: false, steps };

  const actual = sha256File(artifactPath);
  const weightsOk = step('weights match record', actual === record.artifact.sha256,
    actual === record.artifact.sha256 ? actual : `file is ${actual}, record says ${record.artifact.sha256}`);

  const recordHash = sha256Hex(recordBuf);
  const bound = step('record matches receipt', HEX64.test(receipt.sha256) && recordHash === receipt.sha256,
    recordHash === receipt.sha256 ? recordHash : `record is ${recordHash}, receipt says ${receipt.sha256}`);

  let anchored = false;
  if (bound) {
    const v = verifyReceipt(receipt);
    anchored = step('receipt verifies (cid, hash, signature)', v.ok,
      v.ok ? `signer ${receipt.signer}` : (v.result?.error || v.stderr || 'verification failed').toString().trim());
  } else {
    step('receipt verifies (cid, hash, signature)', false, 'skipped: record does not match receipt');
  }
  return { ok: weightsOk && bound && anchored, steps };
}
