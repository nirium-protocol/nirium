/**
 * Offline tests for the Mastra tool. No external network: the seller is a local
 * HTTP server that answers a real x402 v2 challenge, and the SDK, @x402/core and
 * @x402/fetch run unmodified. The over-cap case stops before signing, so no RPC
 * and no funded key are involved. The paid case uses a stub transport, because a
 * real settlement needs a facilitator and a funded testnet account.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import type { AddressInfo } from 'node:net';
import { encodePaymentRequiredHeader, encodePaymentResponseHeader } from '@x402/core/http';
import { createNiriumPayer, type NiriumPayer } from '../src/nirium-payer.ts';
import { createNiriumPayTool, type NiriumPayResult } from '../src/nirium-tool.ts';

/** `execute` may return void or a validation error in Mastra's types; these tests expect a result. */
async function pay(tool: ReturnType<typeof createNiriumPayTool>, input: { url: string }): Promise<NiriumPayResult> {
    const result = await tool.execute!(input);
    assert.ok(result, 'the tool returned no result');
    return result as NiriumPayResult;
}

// Public keys and the USDC testnet SAC only. No secret keys here.
const SELLER = 'GBRAGL6F6CBVIFTU7TJFQQ6HYPND7IUELZ23RMDZSBS6STLW3FOHG225';
const BUYER = 'GDUJVQJMDDHR6UFS7JSWLZBLZ7IW5MWVJ6SY7OVBBUW6OZZ3D7LBHCHF';
const USDC_TESTNET = 'CBIELTK6YBZJU5UP2WWQEUCYKLPU6AUNZ2BQ4WWFEIE3USCIHMXQDAMA';

async function challengeServer(amount: string) {
    const seen: { hasPaymentSignature: boolean }[] = [];
    const server = createServer((req, res) => {
        seen.push({ hasPaymentSignature: req.headers['payment-signature'] !== undefined });
        const requirements = {
            x402Version: 2,
            resource: { url: `http://${req.headers.host}${req.url}`, description: 'local test seller', mimeType: 'application/json' },
            accepts: [{
                scheme: 'exact',
                network: 'stellar:testnet',
                asset: USDC_TESTNET,
                amount,
                payTo: SELLER,
                maxTimeoutSeconds: 60,
                extra: { areFeesSponsored: true },
            }],
        };
        res.writeHead(402, {
            'content-type': 'application/json',
            'PAYMENT-REQUIRED': encodePaymentRequiredHeader(requirements as never),
        });
        res.end(JSON.stringify(requirements));
    });
    await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
    const { port } = server.address() as AddressInfo;
    return { server, seen, url: `http://127.0.0.1:${port}/premium/report` };
}

test('over the cap: the tool returns a refusal, and the signer is never called', async (t) => {
    const { server, seen, url } = await challengeServer('20000000'); // 2 USDC
    t.after(() => server.close());

    const signed: string[] = [];
    const payer = createNiriumPayer({
        signer: {
            address: BUYER,
            signAuthEntry: async (preimage: string) => {
                signed.push(preimage);
                return { signedAuthEntry: preimage, signerAddress: BUYER };
            },
        },
        network: 'stellar:testnet',
        rpcUrl: 'http://127.0.0.1:1', // never reached: the cap stops the payment first
        maxAmountPerPayment: '$0.05',
    });

    const result = await pay(createNiriumPayTool({ payer }), { url });

    assert.equal(result.refused, true);
    assert.equal(result.paid, false);
    assert.equal(result.ok, false);
    assert.equal(result.status, 402);
    assert.equal(result.url, url);
    assert.equal(result.refusal?.code, 'X402_SPEND_CAP_EXCEEDED');
    assert.equal(result.refusal?.amount, '20000000');
    assert.equal(result.refusal?.formattedAmount, '2 USDC');
    assert.equal(result.refusal?.cap, '$0.05');
    assert.match(result.refusal!.reason, /signer was not called/);
    assert.equal(result.transaction, undefined);
    assert.deepEqual(signed, [], 'the signer must not be called for a refused payment');
    assert.deepEqual(seen, [{ hasPaymentSignature: false }], 'one challenge, no payment retry');
});

test('under the cap: the cap does not fire, so the payment proceeds past selection', async (t) => {
    const { server, url } = await challengeServer('100000'); // 0.01 USDC, below the cap
    t.after(() => server.close());

    const payer = createNiriumPayer({
        signer: { address: BUYER, signAuthEntry: async () => ({ signedAuthEntry: '', signerAddress: BUYER }) },
        network: 'stellar:testnet',
        rpcUrl: 'http://127.0.0.1:1', // fails here, which is past the cap check
        maxAmountPerPayment: '$0.05',
    });

    const error = await createNiriumPayTool({ payer }).execute!({ url }).catch((e: unknown) => e);

    assert.ok(error instanceof Error, String(error));
    assert.notEqual((error as { code?: string }).code, 'X402_SPEND_CAP_EXCEEDED');
});

test('paid: the tool returns the body and the settlement transaction hash', async () => {
    const settlement = { success: true, transaction: 'a'.repeat(64), network: 'stellar:testnet', payer: BUYER };
    const payer: NiriumPayer = {
        address: BUYER,
        network: 'stellar:testnet',
        cap: '$0.05',
        x402Fetch: async () => new Response(JSON.stringify({ ok: true, signals: [{ pair: 'XLM/USDC' }] }), {
            status: 200,
            headers: {
                'content-type': 'application/json',
                'PAYMENT-RESPONSE': encodePaymentResponseHeader(settlement as never),
            },
        }),
    };
    const tool = createNiriumPayTool({ payer });

    const result = await pay(tool, { url: 'https://seller.invalid/premium/signals' });

    assert.equal(result.paid, true);
    assert.equal(result.refused, false);
    assert.equal(result.ok, true);
    assert.equal(result.status, 200);
    assert.equal(result.transaction, settlement.transaction);
    assert.deepEqual(result.data, { ok: true, signals: [{ pair: 'XLM/USDC' }] });
    assert.match(tool.description, /\$0\.05 per request/);
});

test('failures other than the cap are rethrown for Mastra to handle', async () => {
    const payer: NiriumPayer = {
        address: BUYER,
        network: 'stellar:testnet',
        cap: '$0.05',
        x402Fetch: async () => { throw new Error('facilitator unreachable'); },
    };

    await assert.rejects(
        createNiriumPayTool({ payer }).execute!({ url: 'https://seller.invalid/premium/signals' }),
        /facilitator unreachable/,
    );
});

test('the cap is required and validated before any payment', () => {
    for (const bad of ['0.05', '$0', '$0.00', '', 'free']) {
        assert.throws(
            () => createNiriumPayer({ secretKey: 'S'.padEnd(56, 'A'), maxAmountPerPayment: bad }),
            /maxAmountPerPayment must look like/,
            JSON.stringify(bad),
        );
    }
});
