import { Keypair, Networks, TransactionBuilder } from '@stellar/stellar-sdk';

export const TESTNET_PASSPHRASE = Networks.TESTNET;

/**
 * Payouts batch run on testnet is testnet-only.
 * Signing with the public passphrase produces an unusable transaction.
 */
export function resolveTestnetPassphrase(value?: string): string {
    const passphrase = (value ?? TESTNET_PASSPHRASE).trim();
    const normalized = passphrase.toLowerCase();
    if (
        normalized.includes('public') ||
        normalized.includes('mainnet') ||
        normalized === Networks.PUBLIC.toLowerCase()
    ) {
        throw wrongPassphraseError(passphrase);
    }
    if (passphrase !== TESTNET_PASSPHRASE) {
        throw wrongPassphraseError(passphrase);
    }
    return passphrase;
}

export function wrongPassphraseError(got: string): Error {
    return new Error(
        `Network passphrase mismatch. This batch payout example is testnet-only.\n` +
            `  expected: ${TESTNET_PASSPHRASE}\n` +
            `  got:      ${got}\n` +
            `Signing with public/mainnet passphrase is out of scope and rejected.`,
    );
}

/**
 * Sign an unsigned XDR with the payer's own keypair.
 * The Nirium Agent is NEVER involved in signing; the secret key never leaves this machine.
 */
export function signUnsignedXdr(xdr: string, secret: string, passphrase: string): string {
    resolveTestnetPassphrase(passphrase);
    if (!secret || !secret.startsWith('S') || secret.length < 56) {
        throw new Error('STELLAR_SECRET_KEY must be a valid Stellar secret seed (S...).');
    }

    try {
        const tx = TransactionBuilder.fromXDR(xdr, passphrase);
        tx.sign(Keypair.fromSecret(secret));
        return tx.toXDR();
    } catch (err) {
        const message = err instanceof Error ? err.message : String(err);
        if (/passphrase|network/i.test(message)) {
            throw wrongPassphraseError(`${passphrase} (${message})`);
        }
        throw err;
    }
}

export function publicKeyFromSecret(secret: string): string {
    if (!secret || !secret.startsWith('S') || secret.length < 56) {
        throw new Error('STELLAR_SECRET_KEY must be a valid Stellar secret seed (S...).');
    }
    return Keypair.fromSecret(secret).publicKey();
}
