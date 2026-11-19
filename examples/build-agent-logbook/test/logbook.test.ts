import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, readFileSync, writeFileSync, readdirSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createHash } from 'node:crypto';
import { Keypair } from '@stellar/stellar-sdk';
import { DEMO_TASKS, RuleBasedAgent } from '../src/agent.js';
import { canonicalJson, hashEntry, statementFor } from '../src/entry.js';
import { niriumAnchorer, runTask } from '../src/logbook.js';
import { checkTask, niriumCliVerify } from '../src/check.js';
import { LocalStore } from '../src/store.js';

const TAG = 'wave11-agent-logbook';

/** Replaces global fetch: records every request and answers like the Audit Trail node. No network. */
function mockNode() {
  const calls: { url: string; body: string }[] = [];
  const anchored = new Map<string, string>(); // cid -> sha256
  const real = globalThis.fetch;
  globalThis.fetch = (async (url: string | URL, init?: RequestInit) => {
    const body = String(init?.body ?? '');
    calls.push({ url: String(url), body });
    const req = JSON.parse(body) as { hash: string };
    const cid = 'Qm' + createHash('sha256').update(req.hash).digest('hex').slice(0, 44);
    anchored.set(cid, req.hash);
    const agent = (JSON.parse(body) as { agent?: { key: string } }).agent;
    return new Response(JSON.stringify({ cid, content_sha256: req.hash, anchoredAt: '2026-11-19T06:00:00.000Z', attestedBy: agent?.key }), { status: 200 });
  }) as typeof fetch;
  return { calls, anchored, restore: () => { globalThis.fetch = real; } };
}

async function runDemo() {
  const dir = mkdtempSync(join(tmpdir(), 'logbook-'));
  const store = new LocalStore(dir);
  const keypair = Keypair.random();
  const node = mockNode();
  try {
    const anchorer = niriumAnchorer('https://nirium-agent.example');
    const receipts = [];
    for (const p of DEMO_TASKS) receipts.push(await runTask(p, { agent: new RuleBasedAgent(), store, anchorer, keypair, tag: TAG }));
    return { dir, store, keypair, node, receipts };
  } finally {
    node.restore();
  }
}

test('five tasks produce five receipts, one per task, each signed by the agent key', async () => {
  const { store, keypair, receipts, node } = await runDemo();
  assert.equal(DEMO_TASKS.length, 5);
  assert.equal(receipts.length, 5);
  assert.equal(new Set(receipts.map((r) => r.taskId)).size, 5);
  assert.equal(new Set(receipts.map((r) => r.cid)).size, 5);
  assert.equal(node.calls.length, 5);
  for (const r of receipts) {
    assert.equal(r.sha256, hashEntry(store.loadEntry(r.taskId)));
    assert.equal(r.attestedBy, keypair.publicKey());
    assert.ok(r.tag.startsWith('wave11-'));
  }
  for (const c of node.calls) {
    assert.ok(c.url.endsWith('/api/audit/log'));
    const b = JSON.parse(c.body);
    const sig = Buffer.from(b.agent.signature, 'base64');
    assert.ok(Keypair.fromPublicKey(b.agent.key).verify(Buffer.from(statementFor(b.hash), 'utf8'), sig));
  }
  assert.deepEqual(store.receipts().map((r) => r.taskId).sort(), receipts.map((r) => r.taskId).sort());
});

test('personal data never leaves the machine: only hash, tag and signature are sent', async () => {
  const { store, receipts, node } = await runDemo();
  const pii = receipts.map((r) => store.loadEntry(r.taskId)).find((e) => e.prompt.includes('@example.com'));
  assert.ok(pii, 'demo includes a prompt with personal data');
  const piiReceipt = receipts.find((r) => r.taskId === pii!.taskId)!;
  for (const c of node.calls) {
    const b = JSON.parse(c.body);
    assert.deepEqual(Object.keys(b).sort(), ['agent', 'hash', 'tag']);
    assert.match(b.hash, /^[0-9a-f]{64}$/);
    for (const secret of ['maria', 'lopez', '555', '0134', 'example.com', 'invoice', 'Redact']) {
      assert.ok(!c.body.toLowerCase().includes(secret.toLowerCase()), `request body leaked "${secret}"`);
    }
  }
  assert.ok(node.calls.some((c) => JSON.parse(c.body).hash === piiReceipt.sha256));
  // the full entry stays local and still has the personal data
  assert.ok(store.loadEntry(pii!.taskId).prompt.includes('maria.lopez@example.com'));
});

test('check-task passes for an untouched entry and fails after the stored entry is edited', async () => {
  const { dir, store, receipts, node } = await runDemo();
  const verify = (cid: string, sha: string) => ({ ok: node.anchored.get(cid) === sha, output: '' });
  for (const r of receipts) assert.equal(checkTask(r.taskId, store, verify).ok, true);

  const target = receipts[3];
  const p = join(dir, 'entries', `${target.taskId}.json`);
  const edited = JSON.parse(readFileSync(p, 'utf8'));
  edited.output = 'celsius_to_fahrenheit -> 99';
  writeFileSync(p, JSON.stringify(edited, null, 2));
  const res = checkTask(target.taskId, store, verify);
  assert.equal(res.ok, false);
  assert.notEqual(res.recomputed, res.anchored);
  assert.equal(readdirSync(join(dir, 'entries')).length, 5);
});

test('the hash covers prompt, tool calls, output and task id, independent of key order', () => {
  const base = { version: 'agent-logbook-v1' as const, taskId: 't1', startedAt: '2026-11-19T00:00:00.000Z', prompt: 'p', toolCalls: [{ tool: 'calculator', input: '1+1', output: 2 }], output: 'o' };
  const h = hashEntry(base);
  assert.equal(h, hashEntry(JSON.parse(canonicalJson(base))));
  assert.equal(h, hashEntry({ output: 'o', toolCalls: base.toolCalls, prompt: 'p', startedAt: base.startedAt, taskId: 't1', version: 'agent-logbook-v1' }));
  for (const change of [{ prompt: 'q' }, { taskId: 't2' }, { output: 'x' }, { toolCalls: [{ tool: 'calculator', input: '1+1', output: 3 }] }]) {
    assert.notEqual(hashEntry({ ...base, ...change }), h);
  }
});

test('refuses tags outside wave11- and keeps nirium verify as the only verifier', async () => {
  const store = new LocalStore(mkdtempSync(join(tmpdir(), 'logbook-')));
  await assert.rejects(runTask('What is 1+1?', { agent: new RuleBasedAgent(), store, anchorer: { anchor: async () => { throw new Error('should not anchor'); } }, keypair: Keypair.random(), tag: 'demo' }), /wave11-/);
  assert.equal(typeof niriumCliVerify, 'function');
});
