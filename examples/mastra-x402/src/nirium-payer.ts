import { Keypair } from '@stellar/stellar-sdk';
import { Agent, type X402Signer } from 'nirium';

/** What the tool needs from a payer: the SDK's x402Fetch plus the cap it enforces. */
export interface NiriumPayer {
    /** Stellar address that signs (G...). Public information. */
    readonly address: string;
    readonly network: 'stellar:testnet' | 'stellar:pubnet';
    /** Per-payment cap in `$N` form, as the SDK reports it. */
    readonly cap: string;
    x402Fetch(url: string, init?: RequestInit): Promise<Response>;
}

export interface NiriumPayerConfig {
    /**
     * Per-payment cap in USDC, `'$0.05'` form. Required: `@x402/core`'s own
     * default is $1, which is too high for a demo. A payment above the cap is
     * refused before the signer is called.
     */
    maxAmountPerPayment: string;
    /** Raw Stellar secret key (S...). Server-side only. */
    secretKey?: string;
    /** SEP-43 signer (wallet) instead of a raw key. Exactly one of the two. */
    signer?: X402Signer;
    network?: 'stellar:testnet' | 'stellar:pubnet';
    /** Soroban RPC override; defaults to the public endpoint for `network`. */
    rpcUrl?: string;
}

const CAP_PATTERN = /^\$(\d+(?:\.\d+)?)$/;

/**
 * Builds a Nirium SDK x402 payer whose per-payment cap is fixed at init time.
 * `maxAmountPerPayment` is enforced by `@x402/core` while it selects payment
 * requirements, which happens before the auth entry is built and signed.
 */
export function createNiriumPayer(config: NiriumPayerConfig): NiriumPayer {
    if (!CAP_PATTERN.test(config.maxAmountPerPayment) || !(Number(config.maxAmountPerPayment.slice(1)) > 0)) {
        throw new Error(`maxAmountPerPayment must look like '$0.05' (got ${JSON.stringify(config.maxAmountPerPayment)}).`);
    }
    const network = config.network ?? 'stellar:testnet';
    const agent = new Agent({ apiKey: 'mastra-x402-example' });
    agent.initX402({
        secretKey: config.secretKey,
        signer: config.signer,
        network,
        rpcUrl: config.rpcUrl,
        maxAmountPerPayment: config.maxAmountPerPayment,
    });

    return {
        address: config.signer?.address ?? Keypair.fromSecret(config.secretKey!).publicKey(),
        network,
        cap: config.maxAmountPerPayment,
        x402Fetch: (url, init) => agent.x402Fetch(url, init),
    };
}
