import test from 'node:test';
import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import validFixture from './fixtures/valid-audit.json' with { type: 'json' };
import {
  DEFAULT_GATEWAYS,
  fetchAndVerifyCid,
  normalizeGatewayUrl,
  verifyAuditDocument,
} from '../lib/verify.js';

test('offline verify: valid fixture passes both hash and signature checks', () => {
  const result = verifyAuditDocument(validFixture, 'QmSSZdtt3dQ8BqUm62zrKQ85E4BUHYiVfvDgZmHfJsqU1U');

  assert.equal(result.ok, true);
  assert.equal(result.hashMatch, true);
  assert.equal(result.signatureStatus, 'valid');
  assert.equal(result.signerKey, 'GD5AFNPTKVZPNWZWKLOULOE7BN4E7ZC73WV5YMBCULYQXWFCGDESUNOZ');
  assert.equal(result.computedHash, 'ab44f8883af819f7496f2cef29eaea0651f6d97af78aa8088fd8ef4dc4b753c9');
});

test('offline verify: tampered content fixture fails hash match', () => {
  const tamperedFixture = structuredClone(validFixture);
  tamperedFixture.record.outcome = 'refunded_to_client_tampered';

  const result = verifyAuditDocument(tamperedFixture, 'QmSSZdtt3dQ8BqUm62zrKQ85E4BUHYiVfvDgZmHfJsqU1U');

  assert.equal(result.ok, false);
  assert.equal(result.hashMatch, false);
  assert.notEqual(result.computedHash, tamperedFixture.content_sha256);
});

test('offline verify: forged signature fixture fails signature verification', () => {
  const forgedFixture = structuredClone(validFixture);
  forgedFixture.agent.signature = `INVALID${forgedFixture.agent.signature.slice(7)}`;

  const result = verifyAuditDocument(forgedFixture, 'QmSSZdtt3dQ8BqUm62zrKQ85E4BUHYiVfvDgZmHfJsqU1U');

  assert.equal(result.ok, false);
  assert.equal(result.hashMatch, true);
  assert.equal(result.signatureStatus, 'invalid');
});

test('offline verify: handles audit document without agent signature block', () => {
  const noAgentFixture = structuredClone(validFixture);
  delete noAgentFixture.agent;

  const result = verifyAuditDocument(noAgentFixture, 'QmSSZdtt3dQ8BqUm62zrKQ85E4BUHYiVfvDgZmHfJsqU1U');

  assert.equal(result.ok, true);
  assert.equal(result.hashMatch, true);
  assert.equal(result.signatureStatus, 'absent');
});

test('offline verify: rejects statement-substitution attack', () => {
  const attacked = structuredClone(validFixture);
  attacked.record = {
    schema: 'arcusx.dispute.resolution.v1',
    dispute: 'dispute-999',
    outcome: 'MALICIOUS_CONTENT',
    note: 'This record was not attested by the agent.',
  };
  attacked.content_sha256 = crypto
    .createHash('sha256')
    .update(JSON.stringify(attacked.record))
    .digest('hex');

  const result = verifyAuditDocument(attacked, 'QmFAKE');

  assert.equal(result.hashMatch, true);
  assert.equal(result.signatureStatus, 'invalid');
  assert.equal(result.ok, false);
  assert.notEqual(result.declaredStatement, result.statement);
});

test('gateway normalization supports bare gateway and /ipfs gateway forms', () => {
  assert.equal(
    normalizeGatewayUrl('https://ipfs.io', 'QmCID'),
    'https://ipfs.io/ipfs/QmCID',
  );
  assert.equal(
    normalizeGatewayUrl('https://ipfs.io/ipfs/', 'QmCID'),
    'https://ipfs.io/ipfs/QmCID',
  );
});

test('fetchAndVerifyCid verifies JSON from a supplied gateway fetcher', async () => {
  const result = await fetchAndVerifyCid('QmCID', {
    gateway: 'https://gateway.example/ipfs/',
    retries: 0,
    fetchFn: async (url) => {
      assert.equal(String(url), 'https://gateway.example/ipfs/QmCID');
      return new Response(JSON.stringify(validFixture), { status: 200 });
    },
  });

  assert.equal(result.ok, true);
  assert.equal(result.hashMatch, true);
  assert.equal(result.signatureStatus, 'valid');
  assert.equal(result.url, 'https://gateway.example/ipfs/QmCID');
});

test('fetchAndVerifyCid reports HTTP gateway failures', async () => {
  const result = await fetchAndVerifyCid('QmMissing', {
    gateway: 'https://gateway.example',
    retries: 0,
    fetchFn: async () => new Response('not found', { status: 404 }),
  });

  assert.equal(result.ok, false);
  assert.equal(result.error, 'Failed to fetch CID from gateway: IPFS gateway returned HTTP 404');
});

test('fetchAndVerifyCid falls back to the next gateway when the first one fails (issue #185)', async () => {
  const calledUrls = [];
  const result = await fetchAndVerifyCid('QmCID', {
    gateways: ['https://down.example/ipfs/', 'https://up.example/ipfs/'],
    retries: 0,
    fetchFn: async (url) => {
      calledUrls.push(String(url));
      if (String(url).startsWith('https://down.example')) {
        return new Response('too many requests', { status: 429 });
      }
      return new Response(JSON.stringify(validFixture), { status: 200 });
    },
  });

  assert.deepEqual(calledUrls, [
    'https://down.example/ipfs/QmCID',
    'https://up.example/ipfs/QmCID',
  ]);
  assert.equal(result.ok, true);
  assert.equal(result.gateway, 'https://up.example/ipfs/');
  assert.equal(result.url, 'https://up.example/ipfs/QmCID');
});

test('fetchAndVerifyCid reports failure only after every gateway in the list fails', async () => {
  const result = await fetchAndVerifyCid('QmCID', {
    gateways: ['https://down1.example/ipfs/', 'https://down2.example/ipfs/'],
    retries: 0,
    fetchFn: async () => new Response('bad gateway', { status: 502 }),
  });

  assert.equal(result.ok, false);
  assert.equal(result.gateway, 'https://down2.example/ipfs/');
  assert.match(result.error, /HTTP 502/);
});

test('with no gateway/gateways input, verification works out of the box via the default fallback list', async () => {
  const calledUrls = [];
  const result = await fetchAndVerifyCid('QmCID', {
    retries: 0,
    fetchFn: async (url) => {
      calledUrls.push(String(url));
      // Simulate today's real failure mode: ipfs.io (the old sole default)
      // rate-limits, so the first DEFAULT_GATEWAYS entry (Filebase) must be
      // the one that actually answers.
      if (String(url).startsWith(DEFAULT_GATEWAYS[0])) {
        return new Response(JSON.stringify(validFixture), { status: 200 });
      }
      return new Response('too many requests', { status: 429 });
    },
  });

  assert.equal(calledUrls[0], `${DEFAULT_GATEWAYS[0]}QmCID`);
  assert.equal(result.ok, true);
  assert.equal(result.gateway, DEFAULT_GATEWAYS[0]);
});

test('an explicit single gateway input is not treated as a fallback list', async () => {
  const calledUrls = [];
  const result = await fetchAndVerifyCid('QmCID', {
    gateway: 'https://gateway.example/ipfs/',
    retries: 0,
    fetchFn: async (url) => {
      calledUrls.push(String(url));
      return new Response('not found', { status: 404 });
    },
  });

  assert.deepEqual(calledUrls, ['https://gateway.example/ipfs/QmCID']);
  assert.equal(result.ok, false);
  assert.equal(result.gateway, 'https://gateway.example/ipfs/');
});
