import { Agent, type PayoutRecipient, type PayoutRunOptions } from 'nirium';

/**
 * 10 Confirmed Testnet Recipient Accounts.
 * Generated using Stellar testnet keypairs, funded via Friendbot,
 * and onboarded with self-signed USDC trustlines on Stellar testnet.
 */
export const TESTNET_RECIPIENTS: PayoutRecipient[] = [
    { wallet: 'GAP6R5XPNHSUIIIJGXRGRRKTJT4YPXQQIUWRQ37PXDGSAJVMRDNBCNZG', amount: '0.10' },
    { wallet: 'GD5GYULPOANDMTMIMZ3SNPJAWMAGF4XM5MJ3ZLFL3FSDXSPHHXD3VJFC', amount: '0.10' },
    { wallet: 'GDAOS5AJTSP5SKLOU3VFYEMUQ4VVFSON7OCBLMLW7C2XX3LD3ON7O6WR', amount: '0.10' },
    { wallet: 'GA5ZEMWGPVMXC6CI6Z2VPWOKYNEWLP3R7FR5TCAAWWICPWMKZHECAWKT', amount: '0.10' },
    { wallet: 'GAKAGOHBRPFUEYG5FAG5XOE3TRDCVR6MARKEM6B6GTNPOE4FCBNSIKSK', amount: '0.10' },
    { wallet: 'GCHPQPONZPPFC4YOGCJCQ4FMBOZKH3XUNLTWDAB7IUXLQXT3LFNPGMJI', amount: '0.10' },
    { wallet: 'GBVZ4BUKBH2ZEX7N2QLOIMYPXFXX2VLJGGPQWB5RJPRIS2ORKJYGKE4K', amount: '0.10' },
    { wallet: 'GCXWKNTEFN4BZQZLKZHSA5M3NYFSOVSV6DS7GKRWRY22QED3L4WGUU23', amount: '0.10' },
    { wallet: 'GAGRAVGV4X2HBHJXFQLSWA4BIYLHI7ILVBBM2OSCMM6YY7ECII2W2EGS', amount: '0.10' },
    { wallet: 'GCLLANEY66BZQXSWS54OOB372R7THAP47ELM2OZL2GI75L6JMUDCWIGO', amount: '0.10' },
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
        `  2. Recipient signs the onboarding XDR with their own secret key (ChangeTrust requires recipient's key, not payer's)\n` +
        `  3. Broadcast via agent.submitPayoutOnboard(signedXdr)\n`
    );
}

export function stellarExpertTxUrl(txHash: string): string {
    return `https://stellar.expert/explorer/testnet/tx/${txHash}`;
}

export function stellarExpertAccountUrl(address: string): string {
    return `https://stellar.expert/explorer/testnet/account/${address}`;
}
