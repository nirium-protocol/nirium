import assert from 'node:assert/strict';
import { appendFile, mkdtemp, readFile, rm, writeFile, mkdir } from 'node:fs/promises';
import { join } from 'node:path';
import test from 'node:test';
import { Keypair } from '@stellar/stellar-sdk';
import { buildSite } from '../src/build.js';

interface AnchorRequest {
  hash: string;
  tag: string;
  agent: { key: string; signature: string; id: string };
}

function announcement(title: string, date: string, body: string): string {
  return `---
title: ${title}
date: ${date}
kind: changelog
---

${body}
`;
}

async function fixtureRoot(): Promise<string> {
  const temporaryRoot = join(process.cwd(), '.test-tmp');
  await mkdir(temporaryRoot, { recursive: true });
  const root = await mkdtemp(join(temporaryRoot, 'announcements-'));
  await mkdir(join(root, 'announcements'));
  await writeFile(
    join(root, 'announcements', '2026-11-17-first.md'),
    announcement('First announcement', '2026-11-17', 'The first body.'),
  );
  await writeFile(
    join(root, 'announcements', '2026-11-18-second.md'),
    announcement('Second announcement', '2026-11-18', 'The second body.'),
  );
  await writeFile(
    join(root, 'announcements', '2026-11-19-third.md'),
    announcement('Third announcement', '2026-11-19', 'The third body.'),
  );
  return root;
}

function mockAuditApi(requests: AnchorRequest[], signer: Keypair): () => void {
  const originalFetch = globalThis.fetch;
  let counter = 0;
  globalThis.fetch = (async (input: RequestInfo | URL, init?: RequestInit): Promise<Response> => {
    assert.equal(String(input), 'https://nirium-agent.fly.dev/api/audit/log');
    assert.equal(init?.method, 'POST');
    const body = JSON.parse(String(init?.body)) as AnchorRequest & { record?: unknown };
    assert.equal(body.record, undefined);
    assert.match(body.tag, /^wave11-/);
    assert.equal(body.agent.key, signer.publicKey());
    assert.equal(
      signer.verify(
        Buffer.from(`nirium-audit-v1:${body.hash}`, 'utf8'),
        Buffer.from(body.agent.signature, 'base64'),
      ),
      true,
    );
    requests.push({
      hash: body.hash,
      tag: body.tag,
      agent: body.agent,
    });
    counter += 1;
    return new Response(JSON.stringify({
      cid: `Qm${String(counter).repeat(44)}`,
      content_sha256: body.hash,
      anchoredAt: `2026-11-19T00:00:0${counter}.000Z`,
      attestedBy: signer.publicKey(),
    }), {
      status: 200,
      headers: { 'content-type': 'application/json' },
    });
  }) as typeof fetch;
  return () => {
    globalThis.fetch = originalFetch;
  };
}

test('anchors each new announcement by hash and writes the static site', async () => {
  const root = await fixtureRoot();
  const signer = Keypair.random();
  const requests: AnchorRequest[] = [];
  const restoreFetch = mockAuditApi(requests, signer);
  try {
    const result = await buildSite({ rootDir: root, signingKey: signer.secret() });
    assert.equal(requests.length, 3);
    assert.equal(result.newlyAnchored.length, 3);
    assert.equal(result.publications.length, 3);

    const manifest = JSON.parse(await readFile(join(root, 'publications.json'), 'utf8')) as {
      schema: string;
      announcements: Array<{ file: string; cid: string; sha256: string }>;
    };
    assert.equal(manifest.schema, 'nirium.announcements.v1');
    assert.deepEqual(
      manifest.announcements.map((entry) => entry.file),
      ['2026-11-17-first.md', '2026-11-18-second.md', '2026-11-19-third.md'],
    );

    const index = await readFile(join(root, 'site', 'index.html'), 'utf8');
    for (const request of requests) {
      assert.match(index, /https:\/\/nirium\.xyz\/verify\?cid=Qm/);
      assert.match(index, new RegExp(request.hash));
    }
    assert.match(index, /npx nirium-cli verify Qm/);

    const copied = await readFile(
      join(root, 'site', 'announcements', '2026-11-17-first.md'),
      'utf8',
    );
    assert.match(copied, /The first body/);
  } finally {
    restoreFetch();
    await rm(root, { recursive: true, force: true });
  }
});

test('a changed announcement aborts before anchoring or rewriting the site', async () => {
  const root = await fixtureRoot();
  const signer = Keypair.random();
  const requests: AnchorRequest[] = [];
  const restoreFetch = mockAuditApi(requests, signer);
  try {
    await buildSite({ rootDir: root, signingKey: signer.secret() });
    const siteBefore = await readFile(join(root, 'site', 'index.html'), 'utf8');
    const manifestBefore = await readFile(join(root, 'publications.json'), 'utf8');
    const requestsBefore = requests.length;

    await appendFile(
      join(root, 'announcements', '2026-11-18-second.md'),
      '\nAn edit after publication.\n',
    );

    let fetchCalled = false;
    globalThis.fetch = (async () => {
      fetchCalled = true;
      throw new Error('The audit API must not be called for tampered content');
    }) as typeof fetch;

    await assert.rejects(
      () => buildSite({ rootDir: root, signingKey: signer.secret() }),
      /TAMPER DETECTED/,
    );
    assert.equal(fetchCalled, false);
    assert.equal(requests.length, requestsBefore);
    assert.equal(await readFile(join(root, 'site', 'index.html'), 'utf8'), siteBefore);
    assert.equal(await readFile(join(root, 'publications.json'), 'utf8'), manifestBefore);
  } finally {
    restoreFetch();
    await rm(root, { recursive: true, force: true });
  }
});
