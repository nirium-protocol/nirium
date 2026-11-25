import assert from 'node:assert/strict';
import type { AddressInfo } from 'node:net';
import test from 'node:test';

import { Keypair } from '@stellar/stellar-sdk';
import { generateText, stepCountIs } from 'ai';
import { Agent, X402SpendCapError } from 'nirium';

import { createScriptedModel } from '../src/scripted-model.js';
import { CHEAP_ROUTE, EXPENSIVE_ROUTE, createApp } from '../src/server.js';
import { createX402PaidFetchTool, readSettlementTx, spendCapReason, type PaidFetchResult } from '../src/x402-tool.js';

const SELLER = 'GCPKZ7PUCFWMDKCKH37TLTSQKH4GDXRUUKGTSQ2Y4426ZNOANYQVWUTG';
const MOCK_FACILITATOR = 'https://mock-facilitator.test';

function json(body: unknown, status = 200, headers: Record<string, string> = {}): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json', ...headers },
  });
}

function settlementHeader(transaction: string): string {
  return Buffer.from(JSON.stringify({ success: true, transaction, network: 'stellar:testnet' })).toString('base64');
}

function spendCapError(url: string): X402SpendCapError {
  return new X402SpendCapError({
    url,
    amount: '20000000',
    asset: 'USDC',
    network: 'stellar:testnet',
    cap: '$1',
    formattedAmount: '2 USDC',
  });
}

function mockFacilitator(realFetch: typeof fetch, calls: string[]): typeof fetch {
  return async (input, init) => {
    const url = new URL(typeof input === 'string' ? input : input instanceof Request ? input.url : input.toString());
    if (url.hostname === '127.0.0.1' || url.hostname === 'localhost') return realFetch(input, init);
    if (url.origin !== MOCK_FACILITATOR) throw new Error(`Unexpected network call to ${url.origin}`);
    calls.push(url.pathname);
    if (url.pathname === '/supported') {
      return json({ kinds: [{ x402Version: 2, scheme: 'exact', network: 'stellar:testnet' }], extensions: [], signers: {} });
    }
    return json({ isValid: false, invalidReason: 'no payment in test' });
  };
}

test('settlement transaction is read from the PAYMENT-RESPONSE header', () => {
  const response = json({ ok: true }, 200, { 'PAYMENT-RESPONSE': settlementHeader('abc123') });
  assert.equal(readSettlementTx(response), 'abc123');
  assert.equal(readSettlementTx(json({ ok: true })), undefined);
  assert.equal(readSettlementTx(json({}, 200, { 'PAYMENT-RESPONSE': 'not-base64-json' })), undefined);
});

test('spend-cap refusal names the amount, the cap, and that nothing was signed', () => {
  const reason = spendCapReason(spendCapError('http://localhost/paid/full-report'), '$1');
  assert.match(reason, /refused before signing/);
  assert.match(reason, /2 USDC/);
  assert.match(reason, /20000000 atomic units/);
  assert.match(reason, /\$1 per-payment cap/);
  assert.match(reason, /Nothing was signed/);
});

test('tool returns the paid body and the settlement transaction', async () => {
  const tool = createX402PaidFetchTool({
    maxAmountPerPayment: '$1',
    x402Fetch: async () => json({ ok: true, route: 'market-summary' }, 200, {
      'PAYMENT-RESPONSE': settlementHeader('deadbeef'),
    }),
  });
  const result = (await tool.execute!({ url: 'http://localhost/paid/market-summary', method: 'GET' }, {} as never)) as PaidFetchResult;
  assert.equal(result.ok, true);
  assert.equal(result.status, 200);
  assert.equal(result.settlementTx, 'deadbeef');
  assert.match(result.body ?? '', /market-summary/);
});

test('tool turns an over-cap refusal into a readable result instead of throwing', async () => {
  const tool = createX402PaidFetchTool({
    maxAmountPerPayment: '$1',
    x402Fetch: async () => {
      throw spendCapError('http://localhost/paid/full-report');
    },
  });
  const result = (await tool.execute!({ url: 'http://localhost/paid/full-report', method: 'GET' }, {} as never)) as PaidFetchResult;
  assert.equal(result.ok, false);
  assert.equal(result.refused, true);
  assert.equal(result.signerCalled, false);
  assert.match(result.reason ?? '', /2 USDC/);
  assert.match(result.reason ?? '', /Nothing was signed/);
});

test('tool turns any other failure into a readable result', async () => {
  const tool = createX402PaidFetchTool({
    x402Fetch: async () => {
      throw new Error('connection refused');
    },
  });
  const result = (await tool.execute!({ url: 'http://localhost/down', method: 'GET' }, {} as never)) as PaidFetchResult;
  assert.equal(result.ok, false);
  assert.equal(result.refused, false);
  assert.match(result.reason ?? '', /connection refused/);
});

test('the AI SDK tool loop calls the tool, pays once, and explains the refusal', async () => {
  const cheapUrl = 'http://localhost/paid/market-summary';
  const expensiveUrl = 'http://localhost/paid/full-report';
  const calls: string[] = [];
  const tool = createX402PaidFetchTool({
    maxAmountPerPayment: '$1',
    x402Fetch: async (url) => {
      calls.push(url);
      if (url === cheapUrl) {
        return json({ ok: true, route: 'market-summary' }, 200, { 'PAYMENT-RESPONSE': settlementHeader('cafebabe') });
      }
      throw spendCapError(url);
    },
  });

  const result = await generateText({
    model: createScriptedModel({ cheapUrl, expensiveUrl }),
    tools: { payForUrl: tool },
    stopWhen: stepCountIs(4),
    prompt: 'pay the cheap endpoint, then the expensive one',
  });

  assert.deepEqual(calls, [cheapUrl, expensiveUrl]);
  assert.ok(result.steps.length >= 3, `expected at least 3 steps, got ${result.steps.length}`);
  assert.match(result.text, /cafebabe/);
  assert.match(result.text, /2 USDC/);
  assert.match(result.text, /Nothing was signed/);
});

test('the SDK refuses an over-cap 402 before signing and never verifies or settles it', async (t) => {
  const realFetch = globalThis.fetch;
  const facilitatorCalls: string[] = [];
  globalThis.fetch = mockFacilitator(realFetch, facilitatorCalls);
  t.after(() => {
    globalThis.fetch = realFetch;
  });

  const app = createApp({
    payTo: SELLER,
    facilitatorApiKey: 'test-key',
    facilitatorUrl: MOCK_FACILITATOR,
  });
  const server = app.listen(0);
  await new Promise<void>((resolve) => server.once('listening', resolve));
  t.after(() => server.close());
  const base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;

  const agent = new Agent({ apiKey: 'unused-x402-only' });
  agent.initX402({
    secretKey: Keypair.random().secret(),
    network: 'stellar:testnet',
    maxAmountPerPayment: '$1',
  });

  await assert.rejects(
    agent.x402Fetch(`${base}${EXPENSIVE_ROUTE}`),
    (error: unknown) => {
      assert.ok(error instanceof X402SpendCapError, `expected X402SpendCapError, got ${String(error)}`);
      assert.equal(error.signerCalled, false);
      assert.equal(error.amount, '20000000');
      assert.equal(error.cap, '$1');
      return true;
    },
  );

  assert.ok(facilitatorCalls.length > 0);
  assert.deepEqual([...new Set(facilitatorCalls)], ['/supported']);
  assert.equal(facilitatorCalls.includes('/verify'), false);
  assert.equal(facilitatorCalls.includes('/settle'), false);
});

test('an unpaid request to the seller route gets a 402 for the advertised price', async (t) => {
  const realFetch = globalThis.fetch;
  const facilitatorCalls: string[] = [];
  globalThis.fetch = mockFacilitator(realFetch, facilitatorCalls);
  t.after(() => {
    globalThis.fetch = realFetch;
  });

  const app = createApp({
    payTo: SELLER,
    facilitatorApiKey: 'test-key',
    facilitatorUrl: MOCK_FACILITATOR,
    price: '$0.02',
  });
  const server = app.listen(0);
  await new Promise<void>((resolve) => server.once('listening', resolve));
  t.after(() => server.close());
  const base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;

  const res = await fetch(`${base}${CHEAP_ROUTE}`);
  assert.equal(res.status, 402);
  const header = res.headers.get('payment-required');
  assert.ok(header, 'expected a payment-required header');
  const challenge = JSON.parse(Buffer.from(header, 'base64').toString('utf8')) as {
    accepts: Array<{ network?: string; payTo?: string; amount?: string }>;
  };
  assert.equal(challenge.accepts[0]?.network, 'stellar:testnet');
  assert.equal(challenge.accepts[0]?.payTo, SELLER);
  assert.equal(challenge.accepts[0]?.amount, '200000');
  assert.deepEqual([...new Set(facilitatorCalls)], ['/supported']);
});
