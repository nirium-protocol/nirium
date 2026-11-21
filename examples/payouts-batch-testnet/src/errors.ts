const INSUFFICIENT = /insufficient|underfunded|balance too low|does not have enough|exceeds balance|not enough|op_underfunded/i;
const MISSING_TRUSTLINE = /trustline entry is missing|no_trust|op_no_trust|missing trustline/i;
const PASSPHRASE = /passphrase|wrong network|network mismatch|invalid network/i;

export function explainFailure(err: unknown): Error {
    const message = extractMessage(err);

    if (MISSING_TRUSTLINE.test(message)) {
        return new Error(
            `Recipient is missing required trustline for the payout asset.\n` +
                `  Use submitPayoutOnboard() with a self-signed trustline XDR to onboard the recipient first.\n` +
                `Original error: ${message}`,
        );
    }

    if (INSUFFICIENT.test(message)) {
        return new Error(
            `Insufficient payer balance to fund this 10-recipient batch payout run.\n` +
                `  Fund your testnet payer account via Friendbot: https://friendbot.stellar.org?addr=<PAYER_ADDRESS>\n` +
                `Original error: ${message}`,
        );
    }

    if (PASSPHRASE.test(message)) {
        return new Error(
            `Network passphrase mismatch: signing requires "Test SDF Network ; September 2015".\n` +
                `Original error: ${message}`,
        );
    }

    return err instanceof Error ? err : new Error(message);
}

export function extractMessage(err: unknown): string {
    if (err instanceof Error) return err.message;
    if (typeof err === 'string') return err;
    try {
        return JSON.stringify(err);
    } catch {
        return String(err);
    }
}

export function isMissingTrustline(err: unknown): boolean {
    return MISSING_TRUSTLINE.test(extractMessage(err));
}

export function isInsufficientBalance(err: unknown): boolean {
    return INSUFFICIENT.test(extractMessage(err));
}
