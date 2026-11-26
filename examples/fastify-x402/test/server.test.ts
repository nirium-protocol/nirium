/**
 * Offline tests for the paid Fastify route: the 402 (unpaid) and 200 (paid) paths.
 *
 * Nothing leaves the process. There is no socket (requests go through
 * `app.inject()`), and `global.fetch` is replaced with a stub that only
 * answers the mock facilitator origin below and throws for anything else, so a
 * test cannot pass by quietly reaching the real network.
 *
 * What is real: x402Serve(), @x402/express and @x402/core run unchanged, so the
 * 402 body/headers, payment matching and the verify -> handler -> settle order
 * are the production code paths. What is mocked: the facilitator's HTTP answers
 * (/supported, /verify, /settle). The real signed-payment round trip on
 * Stellar testnet is `npm run testnet:proof`.
 */
import assert from 'node:assert/strict'
import test from 'node:test'

import { createApp, PAID_ROUTE } from '../src/server.js'

const MOCK_FACILITATOR = 'https://mock-facilitator.test'
const PAY_TO = 'GCPKZ7PUCFWMDKCKH37TLTSQKH4GDXRUUKGTSQ2Y4426ZNOANYQVWUTG'
const PAYER = 'GBBD47IF6LWK7P7MDEVSCWR7DPUWV3NY3DTQEVFL4NAT4AQH3ZLLFLA5'
const TX_HASH = 'a'.repeat(64)

type Calls = { supported: number; verify: number; settle: number; order: string[] }

function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } })
}

/** Replaces global.fetch for one test; returns what the facilitator saw. */
function mockFacilitator(
  t: test.TestContext,
  opts: { verifyOk?: boolean; settleOk?: boolean } = {},
): Calls {
  const { verifyOk = true, settleOk = true } = opts
  const calls: Calls = { supported: 0, verify: 0, settle: 0, order: [] }
  const realFetch = globalThis.fetch
  globalThis.fetch = (async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = new URL(typeof input === 'string' || input instanceof URL ? input : input.url)
    if (url.origin !== MOCK_FACILITATOR) {
      throw new Error(`Unexpected network call to ${url.origin}: only the mock facilitator is allowed`)
    }
    if (url.pathname === '/supported') {
      calls.supported++
      return json({
        kinds: [{ x402Version: 2, scheme: 'exact', network: 'stellar:testnet' }],
        extensions: [],
        signers: {},
      })
    }
    if (url.pathname === '/verify' && init?.method === 'POST') {
      calls.verify++
      calls.order.push('verify')
      return verifyOk
        ? json({ isValid: true, payer: PAYER })
        : json({ isValid: false, invalidReason: 'invalid_signature', payer: PAYER })
    }
    if (url.pathname === '/settle' && init?.method === 'POST') {
      calls.settle++
      calls.order.push('settle')
      return settleOk
        ? json({ success: true, transaction: TX_HASH, network: 'stellar:testnet', payer: PAYER })
        : json({ success: false, errorReason: 'settle_failed', transaction: '', network: 'stellar:testnet' })
    }
    throw new Error(`Unexpected facilitator call: ${init?.method ?? 'GET'} ${url.pathname}`)
  }) as typeof fetch
  t.after(() => {
    globalThis.fetch = realFetch
  })
  return calls
}

const makeApp = () => createApp({ payTo: PAY_TO, facilitatorUrl: MOCK_FACILITATOR, facilitatorApiKey: 'test-key' })

/** Fastify's light-my-request `inject`, shaped like a fetch call: (path, { headers }) -> Response-ish. */
async function request(app: ReturnType<typeof makeApp>, path: string, init: { headers?: Record<string, string> } = {}) {
  const res = await app.inject({ method: 'GET', url: path, headers: init.headers })
  return {
    status: res.statusCode,
    headers: { get: (name: string) => (res.headers[name.toLowerCase()] as string | undefined) ?? null },
    json: async () => JSON.parse(res.body) as unknown,
  }
}

const decode = (header: string) => JSON.parse(Buffer.from(header, 'base64').toString('utf8'))

/** A structurally valid x402 v2 payment for the requirement the server just asked for. */
function paymentFor(paymentRequiredHeader: string): string {
  const required = decode(paymentRequiredHeader)
  const payment = { x402Version: 2, accepted: required.accepts[0], payload: { transaction: 'AAAA-test-only' } }
  return Buffer.from(JSON.stringify(payment)).toString('base64')
}

test('unpaid request returns 402 with the x402 payment requirements, never the paid body', async (t) => {
  const facilitator = mockFacilitator(t)
  const app = makeApp()

  const res = await request(app, PAID_ROUTE)

  assert.equal(res.status, 402)
  const header = res.headers.get('payment-required')
  assert.ok(header, 'expected a payment-required response header on a 402')
  const required = decode(header)
  assert.equal(required.x402Version, 2)
  const accepted = required.accepts[0]
  assert.equal(accepted.scheme, 'exact')
  assert.equal(accepted.network, 'stellar:testnet')
  assert.equal(accepted.payTo, PAY_TO)
  assert.equal(accepted.amount, '200000') // $0.02 in 7-decimal USDC base units
  const body = (await res.json().catch(() => ({}))) as { summary?: unknown }
  assert.equal(body.summary, undefined, 'the paid payload must not leak on a 402')
  assert.equal(facilitator.verify, 0)
  assert.equal(facilitator.settle, 0)
})

test('paid request returns 200 with the paid body, and settles after the handler ran', async (t) => {
  const facilitator = mockFacilitator(t)
  const app = makeApp()

  const unpaid = await request(app, PAID_ROUTE)
  const payment = paymentFor(unpaid.headers.get('payment-required')!)
  const res = await request(app, PAID_ROUTE, { headers: { 'PAYMENT-SIGNATURE': payment } })

  assert.equal(res.status, 200)
  const body = (await res.json()) as { ok: boolean; route: string; summary: { asset: string; price: string } }
  assert.equal(body.ok, true)
  assert.equal(body.route, PAID_ROUTE)
  assert.deepEqual(body.summary, { asset: 'USDC', rails: ['x402', 'Stellar testnet'], price: '0.02' })

  // Settlement ran exactly once, after verification, and its receipt reached the client.
  assert.deepEqual(facilitator.order, ['verify', 'settle'])
  const receipt = decode(res.headers.get('payment-response')!)
  assert.equal(receipt.success, true)
  assert.equal(receipt.transaction, TX_HASH)
  assert.equal(receipt.network, 'stellar:testnet')
})

test('a payment the facilitator rejects gets 402 and no paid body, and is never settled', async (t) => {
  const facilitator = mockFacilitator(t, { verifyOk: false })
  const app = makeApp()

  const unpaid = await request(app, PAID_ROUTE)
  const payment = paymentFor(unpaid.headers.get('payment-required')!)
  const res = await request(app, PAID_ROUTE, { headers: { 'PAYMENT-SIGNATURE': payment } })

  assert.equal(res.status, 402)
  assert.equal(((await res.json().catch(() => ({}))) as { summary?: unknown }).summary, undefined)
  assert.equal(facilitator.verify, 1)
  assert.equal(facilitator.settle, 0)
})

test('if settlement fails the paid body is withheld (the guard holds the response until it settles)', async (t) => {
  const facilitator = mockFacilitator(t, { settleOk: false })
  const app = makeApp()

  const unpaid = await request(app, PAID_ROUTE)
  const payment = paymentFor(unpaid.headers.get('payment-required')!)
  const res = await request(app, PAID_ROUTE, { headers: { 'PAYMENT-SIGNATURE': payment } })

  assert.notEqual(res.status, 200)
  assert.equal(((await res.json().catch(() => ({}))) as { summary?: unknown }).summary, undefined)
  assert.equal(facilitator.settle, 1)
})

test('routes outside the paywall stay free', async (t) => {
  mockFacilitator(t)
  const res = await request(makeApp(), '/health')
  assert.equal(res.status, 200)
  assert.deepEqual(await res.json(), { ok: true, service: 'nirium-fastify-x402-example' })
})

test('x402Serve config validation still applies (bad payTo throws at mount)', () => {
  assert.throws(
    () => createApp({ payTo: 'not-a-stellar-address', facilitatorApiKey: 'test-key' }),
    /payTo/,
  )
})
