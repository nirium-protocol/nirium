import { test } from 'node:test';
import assert from 'node:assert/strict';
import type { X402PolicyContext } from 'nirium';

import { settleIfVerified } from '../src/agent.js';
import {
  createDeliveryKeys,
  signDelivery,
  simulateDelivery,
  verifyDelivery,
  withBadSignature,
} from '../src/delivery.js';
import { DailyBudgetPolicy } from '../src/policy/daily-budget-policy.js';
import { DAILY_CAP_ATOMIC, PRICE_ATOMIC } from '../src/constants.js';

const T0 = Date.UTC(2026, 10, 24, 12, 0, 0);

function ctx(amount: string, nonce: string, signer = 'GAGENT'): X402PolicyContext {
  return {
    contextVersion: 1,
    url: 'https://api.example/paid/settle-delivery',
    method: 'GET',
    requirements: {
      scheme: 'exact',
      network: 'stellar:testnet',
      asset: 'CUSDC',
      payTo: 'GMERCHANT',
      amount,
      maxTimeoutSeconds: 60,
    },
    authorization: {
      preimageXdr: '',
      preimageType: 'legacy',
      payloadHash: `p-${nonce}`,
      networkPassphrase: 'Test SDF Network ; September 2015',
      nonce,
      signatureExpirationLedger: 1,
      contractId: 'CUSDC',
      functionName: 'transfer',
      from: signer,
      to: 'GMERCHANT',
      amount,
    },
    signer,
    contextHash: `ctx-${nonce}`,
  };
}

test('a delivery signed by the trusted key verifies, and a mutated one does not', () => {
  const keys = createDeliveryKeys();
  const signed = simulateDelivery(keys, 1, () => new Date('2026-11-24T18:00:00.000Z'));
  assert.equal(verifyDelivery(signed, keys.publicKey), true);
  assert.equal(verifyDelivery(withBadSignature(signed), keys.publicKey), false);
});

test('a signature from a different key is rejected', () => {
  const a = createDeliveryKeys();
  const b = createDeliveryKeys();
  const signed = simulateDelivery(a, 1);
  assert.equal(verifyDelivery(signed, b.publicKey), false);
});

test('a broken signature byte fails verification', () => {
  const keys = createDeliveryKeys();
  const signed = simulateDelivery(keys, 1);
  const flipped = Buffer.from(signed.signature, 'base64');
  flipped[0] = flipped[0] ^ 0xff;
  assert.equal(
    verifyDelivery({ ...signed, signature: flipped.toString('base64') }, keys.publicKey),
    false,
  );
});

test('settleIfVerified skips a bad signature and never calls pay', async () => {
  const keys = createDeliveryKeys();
  const signed = withBadSignature(simulateDelivery(keys, 4));
  let payCalls = 0;
  const outcome = await settleIfVerified({
    signed,
    trustedPublicKey: keys.publicKey,
    pay: async () => {
      payCalls += 1;
      throw new Error('pay must not be called for a bad signature');
    },
    url: 'http://127.0.0.1:3402/paid/settle-delivery',
  });
  assert.equal(payCalls, 0);
  assert.equal(outcome.status, 'skipped');
  if (outcome.status !== 'skipped') return;
  assert.equal(outcome.signerCalled, false);
  assert.match(outcome.reason, /invalid delivery signature/i);
});

test('settleIfVerified calls pay only after a valid signature, and records the settlement hash', async () => {
  const keys = createDeliveryKeys();
  const signed = simulateDelivery(keys, 1);
  const payload = {
    transaction: 'aaaabbbbccccddddeeeeffff0000111122223333444455556666777788889999',
  };
  const header = Buffer.from(JSON.stringify(payload), 'utf8').toString('base64');
  let payCalls = 0;
  const outcome = await settleIfVerified({
    signed,
    trustedPublicKey: keys.publicKey,
    pay: async (url) => {
      payCalls += 1;
      assert.match(url, /deliveryId=del-001/);
      return new Response(JSON.stringify({ ok: true }), {
        status: 200,
        headers: { 'PAYMENT-RESPONSE': header, 'content-type': 'application/json' },
      });
    },
    url: 'http://127.0.0.1:3402/paid/settle-delivery',
  });
  assert.equal(payCalls, 1);
  assert.equal(outcome.status, 'paid');
  if (outcome.status !== 'paid') return;
  assert.equal(outcome.settlementTx, payload.transaction);
});

test('the daily-budget policy allows three $0.02 payments and denies the fourth, without committing it', async () => {
  const policy = new DailyBudgetPolicy({ dailyCap: DAILY_CAP_ATOMIC, now: () => T0 });
  const amount = PRICE_ATOMIC.toString();

  assert.equal((await policy.evaluate(ctx(amount, '1'))).decision, 'ALLOW');
  assert.equal((await policy.evaluate(ctx(amount, '2'))).decision, 'ALLOW');
  assert.equal((await policy.evaluate(ctx(amount, '3'))).decision, 'ALLOW');

  const denied = await policy.evaluate(ctx(amount, '5'));
  assert.equal(denied.decision, 'DENY');
  assert.equal(denied.contextHash, undefined);
  assert.match(denied.reason ?? '', /daily cap 600000 exceeded/);
  assert.equal(policy.store.spent('GAGENT', '2026-11-24'), DAILY_CAP_ATOMIC);
});

test('signing a delivery is deterministic for the same payload and key', () => {
  const keys = createDeliveryKeys();
  const event = {
    deliveryId: 'del-001',
    orderId: 'order-001',
    deliveredAt: '2026-11-24T18:00:00.000Z',
  };
  const a = signDelivery(event, keys.privateKeyPem, keys.publicKey);
  const b = signDelivery(event, keys.privateKeyPem, keys.publicKey);
  assert.equal(a.signature, b.signature);
  assert.equal(verifyDelivery(a, keys.publicKey), true);
});
