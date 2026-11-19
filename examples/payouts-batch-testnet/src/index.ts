/**
 * Nirium Batch Payouts Example on Stellar Testnet (Issue #351).
 *
 * Demonstrates a non-custodial batch payout run for 10 recipients:
 *   1. Payer builds a batch run request via Nirium SDK (`createPayoutRun`)
 *   2. Nirium node returns an UNSIGNED transaction XDR
 *   3. Payer signs the XDR LOCALLY using their own Stellar Keypair
 *   4. Signed XDR is submitted via `submitPayout` and broadcast to Stellar testnet
 *   5. Receipts and run status are printed with Stellar Expert links
 *
 * Security Guarantee:
 *   The secret key NEVER leaves this process and is NEVER logged.
 */
import 'dotenv/config';

import { Agent } from 'nirium';

import { resolveApiKey } from './auth.ts';
import { explainFailure } from './errors.ts';
import {
    buildBatchPayoutOptions,
    reportUntrustedRecipients,
    stellarExpertAccountUrl,
    stellarExpertTxUrl,
    TESTNET_RECIPIENTS,
} from './payout.ts';
import { publicKeyFromSecret, resolveTestnetPassphrase, signUnsignedXdr } from './sign.ts';

const DEFAULT_BASE_URL = 'https://nirium-agent.fly.dev';

async function main(): Promise<void> {
    const secret = process.env.STELLAR_SECRET_KEY?.trim();
    if (!secret) {
        console.error('Error: STELLAR_SECRET_KEY is required in environment.');
        console.error('Copy .env.example to .env and set your testnet secret seed (S...).');
        process.exit(1);
    }

    const passphrase = resolveTestnetPassphrase(process.env.NETWORK_PASSPHRASE);
    const payerPublicKey = publicKeyFromSecret(secret);
    const baseUrl = (process.env.NIRIUM_BASE_URL ?? DEFAULT_BASE_URL).replace(/\/$/, '');
    const apiKey = await resolveApiKey(baseUrl, payerPublicKey);

    console.log('================================================================');
    console.log('Nirium Batch Payouts Quickstart (Stellar Testnet, Non-Custodial)');
    console.log('================================================================');
    console.log(`Payer Public Key : ${payerPublicKey}`);
    console.log(`Payer Explorer   : ${stellarExpertAccountUrl(payerPublicKey)}`);
    console.log(`Nirium Agent URL : ${baseUrl}`);
    console.log(`Passphrase       : ${passphrase}`);
    console.log(`Recipients Count : ${TESTNET_RECIPIENTS.length}`);
    console.log(`Client Signing   : ENABLED (Secret key never leaves this machine)\n`);

    const agent = new Agent({
        baseUrl,
        apiKey,
    });

    try {
        console.log('1. Building 10-recipient batch payout run...');
        const payoutOptions = buildBatchPayoutOptions({
            recipients: TESTNET_RECIPIENTS,
            asset: 'USDC',
            treasury: payerPublicKey,
        });

        console.log(`   Asset            : ${payoutOptions.asset}`);
        console.log(`   Recipients       : ${payoutOptions.recipients.length}`);
        console.log(`   Acknowledged     : ${payoutOptions.acknowledgeTerms}`);

        // Step 1: Create payout run (returns unsigned XDR)
        console.log('\n2. Calling Nirium SDK createPayoutRun()...');
        const run = await agent.createPayoutRun(payoutOptions);
        console.log(`   Run ID           : ${run.runId}`);
        console.log(`   Total Amount     : ${run.totalAmount ?? 'N/A'}`);

        // Check for any recipients lacking trustlines
        if (Array.isArray(run.untrustedRecipients) && run.untrustedRecipients.length > 0) {
            console.log('\n' + reportUntrustedRecipients(run.untrustedRecipients as string[]));
            console.log('Onboarding untrusted recipients: Each recipient signs their own ChangeTrust XDR...');
            for (const untrustedAddr of run.untrustedRecipients as string[]) {
                try {
                    const onboardRes = await agent.onboardPayoutRecipient(untrustedAddr, { asset: 'USDC' });
                    if (onboardRes.xdr) {
                        // ChangeTrust must be signed by the recipient's private key, NOT the payer's
                        const recipientSecret =
                            process.env[`RECIPIENT_SECRET_${untrustedAddr}`] ||
                            process.env.RECIPIENT_SECRET_KEY;
                        if (recipientSecret) {
                            const signedOnboard = signUnsignedXdr(onboardRes.xdr, recipientSecret, passphrase);
                            await agent.submitPayoutOnboard(signedOnboard);
                            console.log(`   Successfully submitted recipient-signed trustline for: ${untrustedAddr}`);
                        } else {
                            console.log(`   Unsigned ChangeTrust XDR generated for recipient: ${untrustedAddr}`);
                            console.log(`   (ChangeTrust requires recipient's key. Supply RECIPIENT_SECRET_${untrustedAddr} to auto-sign locally.)`);
                        }
                    }
                } catch (onboardErr) {
                    console.warn(`   Could not auto-onboard ${untrustedAddr}:`, onboardErr);
                }
            }
        }

        if (!run.xdr) {
            throw new Error(`Agent returned run without unsigned XDR (status: ${JSON.stringify(run)})`);
        }

        // Step 2: Sign locally
        console.log('\n3. Signing transaction XDR locally with payer secret key...');
        const signedXdr = signUnsignedXdr(run.xdr, secret, passphrase);
        console.log('   XDR signed successfully (client-side only).');

        // Step 3: Submit signed payout
        console.log('\n4. Submitting signed payout run via submitPayout()...');
        const result = await agent.submitPayout(run.runId, signedXdr);

        console.log('\n================================================================');
        console.log('BATCH PAYOUT SUBMITTED SUCCESSFULLY! 🎉');
        console.log('================================================================');
        console.log(`Run ID      : ${result.runId}`);
        if (result.txHash) {
            console.log(`Tx Hash     : ${result.txHash}`);
            console.log(`Explorer    : ${stellarExpertTxUrl(result.txHash)}`);
        }
        if (result.cid) {
            console.log(`Receipt CID : ${result.cid}`);
        }
        console.log('\nRecipients Confirmed on Testnet:');
        TESTNET_RECIPIENTS.forEach((r, idx) => {
            console.log(`  ${idx + 1}. ${r.wallet} (${r.amount} USDC) -> ${stellarExpertAccountUrl(r.wallet)}`);
        });
        console.log('================================================================\n');
    } catch (err) {
        const explained = explainFailure(err);
        console.error('\nBatch payout run failed:');
        console.error(explained.message);
        process.exit(1);
    }
}

// Only run main if executed directly
if (import.meta.url === `file://${process.argv[1]?.replace(/\\/g, '/')}`) {
    main();
}

export { main };
