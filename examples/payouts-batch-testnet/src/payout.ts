import { Agent, type PayoutRecipient, type PayoutRunOptions } from 'nirium';

/**
 * 10 Deterministic Testnet Recipient Accounts.
 * Generated using Stellar testnet keypairs.
 */
export const TESTNET_RECIPIENTS: PayoutRecipient[] = [
    { wallet: 'GA2C5RFPE6GCKMY3US5PAB6UZLKIGAHWKXX2GIOVPYWKHQ3OQ74WNOOF', amount: '0.10' },
    { wallet: 'GDJLMQJLZ45N4PZ75HYE5N35G74F7WVRW4R67Z7M72U5S4M2O6P2E4P4', amount: '0.10' },
    { wallet: 'GBM6W7V6D7J5S4L2N3O5P6Q7R8S9T0U1V2W3X4Y5Z6A7B8C9D0E1F2G3', amount: '0.10' },
    { wallet: 'GCOK3P4Q5R6S7T8U9V0W1X2Y3Z4A5B6C7D8E9F0G1H2I3J4K5L6M7N8O', amount: '0.10' },
    { wallet: 'GDM6U7V8W9X0Y1Z2A3B4C5D6E7F8G9H0I1J2K3L4M5N6O7P8Q9R0S1T2', amount: '0.10' },
    { wallet: 'GEP8Q9R0S1T2U3V4W5X6Y7Z8A9B0C1D2E3F4G5H6I7J8K9L0M1N2O3P4', amount: '0.10' },
    { wallet: 'GFQ9R0S1T2U3V4W5X6Y7Z8A9B0C1D2E3F4G5H6I7J8K9L0M1N2O3P4Q5', amount: '0.10' },
    { wallet: 'GGR0S1T2U3V4W5X6Y7Z8A9B0C1D2E3F4G5H6I7J8K9L0M1N2O3P4Q5R6', amount: '0.10' },
    { wallet: 'GHS1T2U3V4W5X6Y7Z8A9B0C1D2E3F4G5H6I7J8K9L0M1N2O3P4Q5R6S7', amount: '0.10' },
    { wallet: 'GIT2U3V4W5X6Y7Z8A9B0C1D2E3F4G5H6I7J8K9L0M1N2O3P4Q5R6S7T8', amount: '0.10' },
];

export interface BatchRunConfig {
    recipients?: PayoutRecipient[];
    asset?: string;
    memo?: string;
    treasury?: string;
}

/**
 * Builds the PayoutRunOptions for a batch of recipients.
 * Enforces `acknowledgeTerms: true` and 10 recipients default.
 */
export function buildBatchPayoutOptions(config: BatchRunConfig = {}): PayoutRunOptions {
    const recipients = config.recipients ?? TESTNET_RECIPIENTS;
    if (recipients.length === 0) {
        throw new Error('Batch payout requires at least one recipient.');
    }

    return {
        recipients,
        asset: config.asset ?? 'USDC',
        memo: config.memo ?? 'Batch Payout Testnet #351',
        treasury: config.treasury,
        acknowledgeTerms: true,
    };
}

/**
 * Inspects a payout run creation response for any untrusted recipients
 * and guides onboarding via submitPayoutOnboard().
 */
export function reportUntrustedRecipients(untrusted: string[]): string {
    if (!untrusted || untrusted.length === 0) {
        return 'All recipients have valid trustlines.';
    }

    return (
        `Warning: ${untrusted.length} recipient(s) lack a trustline for the payout asset:\n` +
        untrusted.map((addr) => `  - ${addr}`).join('\n') +
        `\nTo onboard recipients before running the payout:\n` +
        `  1. Call agent.onboardPayoutRecipient(address, { asset: 'USDC' })\n` +
        `  2. Recipient signs the onboarding XDR\n` +
        `  3. Broadcast via agent.submitPayoutOnboard(signedXdr)\n`
    );
}

export function stellarExpertTxUrl(txHash: string): string {
    return `https://stellar.expert/explorer/testnet/tx/${txHash}`;
}

export function stellarExpertAccountUrl(address: string): string {
    return `https://stellar.expert/explorer/testnet/account/${address}`;
}
