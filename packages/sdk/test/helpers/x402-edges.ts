/**
 * Shared fixtures for the end-to-end x402 tests: the real @x402/fetch,
 * @x402/core and @x402/stellar ExactStellarScheme run unmodified, and only the
 * edges are simulated in memory (merchant HTTP responses, Soroban RPC latest
 * ledger + simulation, Horizon ledger times). Keys are random and unfunded;
 * nothing is broadcast and no real network is touched.
 *
 * Importing this module patches stellar-sdk and globalThis.fetch for the whole
 * process, so only the e2e test files import it (node:test runs each file in
 * its own process). Needs `npm run build` first: it loads dist/.
 */
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
export const S = require('@stellar/stellar-sdk');
const http = require('@x402/core/http');
export const { USDC_TESTNET_ADDRESS: asset } = require('@x402/stellar');
const dist = require('../../dist/index.js');
export const { Agent, X402PolicyError, X402SpendCapError } = dist;

export const MERCHANT = 'https://merchant.invalid';
export const payTo = S.Keypair.random().publicKey();
let nonce = 1000;
export const counters = { paidRetries: 0, challenges: 0 };

// ── Simulated edges (patched on the same stellar-sdk instance x402 uses) ──
S.rpc.Server.prototype.getLatestLedger = async function () {
    return { sequence: 100, protocolVersion: 23, id: 'fixture' };
};
S.Horizon.Server.prototype.ledgers = function () {
    const q: any = {
        limit: () => q, order: () => q,
        call: async () => ({ records: [{ closed_at: '2026-01-01T00:00:05Z' }, { closed_at: '2026-01-01T00:00:00Z' }] }),
    };
    return q;
};
S.rpc.Server.prototype.simulateTransaction = async function (tx: any) {
    const op = tx.operations[0];
    const call = op.func.invokeContract;
    let auth = op.auth ?? [];
    if (!auth.length) {
        const from = S.Address.fromScAddress(call.args[0].address).toString();
        auth = [new S.xdr.SorobanAuthorizationEntry({
            credentials: S.xdr.SorobanCredentials.sorobanCredentialsAddress(new S.xdr.SorobanAddressCredentials({
                address: new S.Address(from).toScAddress(),
                nonce: S.xdr.Int64.fromString(String(++nonce)),
                signatureExpirationLedger: 0,
                signature: S.xdr.ScVal.scvVoid(),
            })),
            rootInvocation: new S.xdr.SorobanAuthorizedInvocation({
                function: S.xdr.SorobanAuthorizedFunction.sorobanAuthorizedFunctionTypeContractFn(call),
                subInvocations: [],
            }),
        })];
    }
    return {
        _parsed: true, id: 'fixture', latestLedger: 100, events: [], minResourceFee: '0',
        transactionData: new S.SorobanDataBuilder(), result: { auth, retval: S.xdr.ScVal.scvVoid() },
    };
};
S.rpc.Server.prototype.sendTransaction = async function () { throw new Error('BROADCAST_FORBIDDEN'); };

globalThis.fetch = async (input: any, init?: any) => {
    const req = new Request(input, init);
    if (new URL(req.url).origin !== MERCHANT) throw new Error(`NETWORK_FORBIDDEN ${req.url}`);
    const amount = new URL(req.url).searchParams.get('amount') ?? '499';
    const offeredAsset = new URL(req.url).searchParams.get('asset') ?? asset;
    if (req.headers.has('PAYMENT-SIGNATURE')) {
        counters.paidRetries++;
        const payment = http.decodePaymentSignatureHeader(req.headers.get('PAYMENT-SIGNATURE'));
        const tx = S.TransactionBuilder.fromXDR(payment.payload.transaction, S.Networks.TESTNET);
        const entry = tx.operations[0].auth[0];
        const cred = entry.credentials.address;
        const pre = S.buildAuthorizationEntryPreimage(entry, cred.signatureExpirationLedger, S.Networks.TESTNET);
        const sig = S.scValToNative(cred.signature)[0];
        const pk = S.StrKey.encodeEd25519PublicKey(Buffer.from(sig.public_key));
        assert.ok(S.Keypair.fromPublicKey(pk).verify(S.hash(pre.toXDR()), Buffer.from(sig.signature)), 'merchant got a bad signature');
        return new Response(JSON.stringify({ ok: true }), { status: 200, headers: { 'content-type': 'application/json' } });
    }
    counters.challenges++;
    const requirements = {
        x402Version: 2,
        resource: { url: req.url, description: 'local fixture', mimeType: 'application/json' },
        accepts: [{ scheme: 'exact', network: 'stellar:testnet', asset: offeredAsset, amount, payTo, maxTimeoutSeconds: 60, extra: { areFeesSponsored: true } }],
    };
    return new Response(JSON.stringify(requirements), {
        status: 402, headers: { 'PAYMENT-REQUIRED': http.encodePaymentRequiredHeader(requirements), 'content-type': 'application/json' },
    });
};

export function keySigner(kp = S.Keypair.random(), opts: { mutate?: (p: string) => string } = {}) {
    const calls: string[] = [];
    return {
        calls, kp,
        signer: {
            address: kp.publicKey(),
            signAuthEntry: async (preimageXdr: string) => {
                calls.push(preimageXdr);
                const bytes = Buffer.from(opts.mutate ? opts.mutate(preimageXdr) : preimageXdr, 'base64');
                return { signedAuthEntry: Buffer.from(kp.sign(S.hash(bytes))).toString('base64'), signerAddress: kp.publicKey() };
            },
        },
    };
}
export const agent = () => new Agent({ apiKey: 'test-placeholder', baseUrl: 'https://backend.invalid' });
export const init = (a: any, cfg: any) => a.initX402({ network: 'stellar:testnet', rpcUrl: 'https://rpc.invalid', ...cfg });
export const paid = (a: any, amount = '499', extra = '') => a.x402Fetch(`${MERCHANT}/resource?amount=${amount}${extra}`);
