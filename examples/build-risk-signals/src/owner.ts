import { Keypair, Networks, TransactionBuilder } from '@stellar/stellar-sdk';
import { Agent } from 'nirium';

export const TESTNET_PASSPHRASE = Networks.TESTNET;
export const TESTNET_EXPLORER_TX_BASE = 'https://stellar.expert/explorer/testnet/tx';

export function resolveTestnetPassphrase(value?: string): string {
    const passphrase = (value ?? TESTNET_PASSPHRASE).trim();
    const normalized = passphrase.toLowerCase();
    if (
        normalized.includes('public') ||
        normalized.includes('mainnet') ||
        normalized === Networks.PUBLIC.toLowerCase() ||
        passphrase !== TESTNET_PASSPHRASE
    ) {
        throw new Error(
            `Network passphrase mismatch. Testnet only.\n  expected: ${TESTNET_PASSPHRASE}\n  got:      ${passphrase}`,
        );
    }
    return passphrase;
}

export function publicKeyFromSecret(secret: string): string {
    return Keypair.fromSecret(secret).publicKey();
}

export function signUnsignedXdr(xdr: string, ownerSecret: string, passphrase: string): string {
    resolveTestnetPassphrase(passphrase);
    if (!ownerSecret.startsWith('S') || ownerSecret.length < 56) {
        throw new Error('OWNER_SECRET_KEY must be a Stellar secret seed (S...).');
    }

    const tx = TransactionBuilder.fromXDR(xdr, passphrase);
    tx.sign(Keypair.fromSecret(ownerSecret));
    return tx.toXDR();
}

export async function resolveDemoApiKey(baseUrl: string, address: string): Promise<string> {
    const fromEnv = process.env.NIRIUM_API_KEY?.trim();
    if (fromEnv) return fromEnv;

    const cleanBase = baseUrl.replace(/\/$/, '');
    const response = await fetch(`${cleanBase}/api/public/demo-auth`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ walletAddress: address }),
    });
    const body = await response.text();
    if (!response.ok) {
        throw new Error(`demo-auth failed (${response.status}): ${body}`);
    }

    const data = JSON.parse(body) as Record<string, unknown>;
    const key = [data.apiKey, data.api_key, data.token, data.accessToken].find(
        (v): v is string => typeof v === 'string' && v.length > 0,
    );
    if (!key) {
        throw new Error(`demo-auth did not return a token: ${body}`);
    }
    return key;
}

export function attachBearerIfJwt(token: string, baseUrl: string): void {
    const parts = token.split('.');
    if (!(parts.length === 3 && parts.every((p) => p.length > 0))) return;

    const cleanBase = baseUrl.replace(/\/$/, '');
    const original = globalThis.fetch.bind(globalThis);
    globalThis.fetch = (input: Parameters<typeof fetch>[0], init?: RequestInit) => {
        const url = typeof input === 'string' ? input : input instanceof URL ? input.href : input.url;
        if (!url.startsWith(cleanBase)) {
            return original(input, init);
        }
        const headers = new Headers(init?.headers);
        if (!headers.has('Authorization')) {
            headers.set('Authorization', `Bearer ${token}`);
        }
        return original(input, { ...init, headers });
    };
}

export interface OwnerAgentClient {
    withdrawFromTreasuryVault(options: {
        vault: string;
        from: string;
        shares?: string | number;
        maxSlippageBps?: number;
    }): Promise<{ xdr: string; signWith: string; shares: string; heldShares: string }>;
    buildTreasuryRebalance(options: {
        vault: string;
        caller: string;
        instructions: Array<{ kind: 'Invest' | 'Unwind'; strategy: string; amount: string }>;
    }): Promise<{ xdr: string; signWith: string }>;
    submitTreasuryTx(xdr: string): Promise<{ hash: string; explorer?: string }>;
}

export interface OwnerWithdrawParams {
    vaultId: string;
    ownerSecret: string;
    shares?: string;
    passphrase?: string;
}

export interface OwnerWithdrawResult {
    hash: string;
    explorer: string;
    signedBy: string;
    shares: string;
    heldShares: string;
}

/**
 * Build an unsigned withdraw XDR via Nirium, sign it locally with the vault owner key,
 * and broadcast via submitTreasuryTx. Only the owner/shareholder key can authorize withdrawals.
 */
export async function executeOwnerWithdraw(
    client: OwnerAgentClient,
    params: OwnerWithdrawParams,
): Promise<OwnerWithdrawResult> {
    const passphrase = resolveTestnetPassphrase(params.passphrase);
    const ownerPublicKey = publicKeyFromSecret(params.ownerSecret);

    const unsigned = await client.withdrawFromTreasuryVault({
        vault: params.vaultId,
        from: ownerPublicKey,
        ...(params.shares ? { shares: params.shares } : {}),
    });

    if (unsigned.signWith && unsigned.signWith !== ownerPublicKey) {
        throw new Error(
            `Vault expects signature from ${unsigned.signWith}, but OWNER_SECRET_KEY belongs to ${ownerPublicKey}.`,
        );
    }

    const signedXdr = signUnsignedXdr(unsigned.xdr, params.ownerSecret, passphrase);
    const submitted = await client.submitTreasuryTx(signedXdr);
    const explorer = submitted.explorer || `${TESTNET_EXPLORER_TX_BASE}/${submitted.hash}`;

    return {
        hash: submitted.hash,
        explorer,
        signedBy: ownerPublicKey,
        shares: unsigned.shares,
        heldShares: unsigned.heldShares,
    };
}

export interface OwnerRebalanceParams {
    vaultId: string;
    ownerSecret: string;
    strategyAddress: string;
    kind: 'Invest' | 'Unwind';
    amountStroops: string;
    passphrase?: string;
}

export interface OwnerMoveResult {
    hash: string;
    explorer: string;
    signedBy: string;
    kind: 'Invest' | 'Unwind';
    amountStroops: string;
    strategyAddress: string;
}

/**
 * Build an unsigned rebalance XDR via Nirium, sign it locally with the vault owner key,
 * and broadcast via submitTreasuryTx. The owner secret never leaves this process.
 */
export async function executeOwnerRebalance(
    client: OwnerAgentClient,
    params: OwnerRebalanceParams,
): Promise<OwnerMoveResult> {
    const passphrase = resolveTestnetPassphrase(params.passphrase);
    const ownerPublicKey = publicKeyFromSecret(params.ownerSecret);

    const unsigned = await client.buildTreasuryRebalance({
        vault: params.vaultId,
        caller: ownerPublicKey,
        instructions: [
            {
                kind: params.kind,
                strategy: params.strategyAddress,
                amount: params.amountStroops,
            },
        ],
    });

    if (unsigned.signWith && unsigned.signWith !== ownerPublicKey) {
        throw new Error(
            `Vault expects signature from ${unsigned.signWith}, but OWNER_SECRET_KEY belongs to ${ownerPublicKey}.`,
        );
    }

    const signedXdr = signUnsignedXdr(unsigned.xdr, params.ownerSecret, passphrase);
    const submitted = await client.submitTreasuryTx(signedXdr);
    const explorer = submitted.explorer || `${TESTNET_EXPLORER_TX_BASE}/${submitted.hash}`;

    return {
        hash: submitted.hash,
        explorer,
        signedBy: ownerPublicKey,
        kind: params.kind,
        amountStroops: params.amountStroops,
        strategyAddress: params.strategyAddress,
    };
}

export async function createAuthenticatedOwnerAgent(baseUrl: string, ownerPublicKey: string): Promise<Agent> {
    const apiKey = await resolveDemoApiKey(baseUrl, ownerPublicKey);
    attachBearerIfJwt(apiKey, baseUrl);
    return new Agent({ apiKey, baseUrl: baseUrl.replace(/\/$/, '') });
}
