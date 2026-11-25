#!/usr/bin/env node
// SPDX-License-Identifier: Apache-2.0

import 'dotenv/config';
import { createReadOnlyClient, printEvaluation, RiskMonitorAgent } from './monitor.ts';
import {
    createAuthenticatedOwnerAgent,
    executeOwnerRebalance,
    executeOwnerWithdraw,
    publicKeyFromSecret,
    resolveTestnetPassphrase,
} from './owner.ts';

const DEFAULT_BASE_URL = 'https://nirium-agent.fly.dev';

function getFlag(args: string[], flag: string): string | undefined {
    const idx = args.indexOf(flag);
    return idx >= 0 && args[idx + 1] ? args[idx + 1] : undefined;
}

function hasFlag(args: string[], flag: string): boolean {
    return args.includes(flag);
}

function sleep(ms: number): Promise<void> {
    return new Promise((resolve) => setTimeout(resolve, ms));
}

async function runMonitorCli(args: string[]): Promise<void> {
    const baseUrl = (getFlag(args, '--base-url') || process.env.NIRIUM_BASE_URL || DEFAULT_BASE_URL).replace(/\/$/, '');
    const vaultId = (getFlag(args, '--vault') || process.env.VAULT_ID || '').trim();
    if (!vaultId) {
        throw new Error('Missing vault ID. Pass --vault <CONTRACT_ID> or set VAULT_ID in .env.');
    }

    const concentrationThresholdPercent = Number(
        getFlag(args, '--threshold') || process.env.CONCENTRATION_THRESHOLD_PERCENT || '75',
    );
    const minIdleBufferPercent = Number(
        getFlag(args, '--min-idle') || process.env.MIN_IDLE_BUFFER_PERCENT || '25',
    );
    const readingsTarget = hasFlag(args, '--once')
        ? 1
        : Number(getFlag(args, '--readings') || '2');
    const intervalSeconds = Number(
        getFlag(args, '--interval') || process.env.POLL_INTERVAL_SECONDS || '10',
    );

    const monitor = new RiskMonitorAgent(createReadOnlyClient(baseUrl), {
        concentrationThresholdPercent,
        minIdleBufferPercent,
    });
    const caps = monitor.getCapabilities();

    console.log('===============================================================');
    console.log(' Nirium Risk Signal Monitor — Stellar Testnet');
    console.log(` Capabilities: readVault=${caps.canReadVault}, holdsSigningKey=${caps.holdsSigningKey}, canMoveFunds=${caps.canMoveFunds}`);
    console.log(` Vault:        ${vaultId}`);
    console.log(` Thresholds:   maxStrategy <= ${concentrationThresholdPercent}% | minIdle >= ${minIdleBufferPercent}%`);
    console.log('===============================================================');
    console.log('');

    for (let i = 1; i <= readingsTarget; i++) {
        const evals = await monitor.pollOnce(vaultId);
        printEvaluation(i, evals);
        if (i < readingsTarget) {
            console.log(`Waiting ${intervalSeconds}s before reading #${i + 1}...`);
            console.log('');
            await sleep(intervalSeconds * 1000);
        }
    }
}

async function runOwnerMoveCli(args: string[]): Promise<void> {
    const baseUrl = (getFlag(args, '--base-url') || process.env.NIRIUM_BASE_URL || DEFAULT_BASE_URL).replace(/\/$/, '');
    const vaultId = (getFlag(args, '--vault') || process.env.VAULT_ID || '').trim();
    const ownerSecret = process.env.OWNER_SECRET_KEY?.trim();
    const passphrase = resolveTestnetPassphrase(process.env.NETWORK_PASSPHRASE);

    if (!vaultId) {
        throw new Error('Missing vault ID. Pass --vault <CONTRACT_ID> or set VAULT_ID in .env.');
    }
    if (!ownerSecret) {
        throw new Error('OWNER_SECRET_KEY is required for owner-move (set in .env, never committed).');
    }

    const concentrationThresholdPercent = Number(
        getFlag(args, '--threshold') || process.env.CONCENTRATION_THRESHOLD_PERCENT || '75',
    );
    const minIdleBufferPercent = Number(
        getFlag(args, '--min-idle') || process.env.MIN_IDLE_BUFFER_PERCENT || '25',
    );

    const monitor = new RiskMonitorAgent(createReadOnlyClient(baseUrl), {
        concentrationThresholdPercent,
        minIdleBufferPercent,
    });
    const evals = await monitor.pollOnce(vaultId);
    printEvaluation(1, evals);

    const signal = evals.flatMap((e) => e.signals).find((s) => s.strategyAddress || s.metricValuePercent > 0);
    const action = getFlag(args, '--action') || 'withdraw';
    const ownerPublicKey = publicKeyFromSecret(ownerSecret);
    const agent = await createAuthenticatedOwnerAgent(baseUrl, ownerPublicKey);

    if (action === 'rebalance') {
        const strategyAddress = getFlag(args, '--strategy') || signal?.strategyAddress;
        const amountStroops = getFlag(args, '--amount') || signal?.recommendedUnwindStroops;
        const kind = (getFlag(args, '--kind') === 'Invest' ? 'Invest' : 'Unwind') as 'Invest' | 'Unwind';

        if (!strategyAddress || !amountStroops || amountStroops === '0') {
            console.log('No threshold signal requiring a rebalance move.');
            return;
        }

        console.log(`Authorized signer (${ownerPublicKey}) signing ${kind} of ${amountStroops} stroops on ${strategyAddress}...`);
        const res = await executeOwnerRebalance(agent, {
            vaultId,
            ownerSecret,
            strategyAddress,
            kind,
            amountStroops,
            passphrase,
        });
        console.log('Signed rebalance confirmed on Stellar testnet:');
        console.log(`  Signed by: ${res.signedBy}`);
        console.log(`  Tx Hash:   ${res.hash}`);
        console.log(`  Explorer:  ${res.explorer}`);
        return;
    }

    if (!signal && !getFlag(args, '--shares')) {
        console.log('No threshold signal raised. Pass --shares <amount> to withdraw explicitly.');
        return;
    }

    const shares = getFlag(args, '--shares');
    console.log(`Vault Owner (${ownerPublicKey}) authorizing withdrawal${shares ? ` of ${shares} shares` : ' (full balance)'}...`);
    const res = await executeOwnerWithdraw(agent, {
        vaultId,
        ownerSecret,
        shares,
        passphrase,
    });

    console.log('Owner-signed move confirmed on Stellar testnet:');
    console.log(`  Signed by: ${res.signedBy}`);
    console.log(`  Shares:    ${res.shares} (held: ${res.heldShares})`);
    console.log(`  Tx Hash:   ${res.hash}`);
    console.log(`  Explorer:  ${res.explorer}`);
}

async function main(): Promise<void> {
    const [cmd = 'monitor', ...rest] = process.argv.slice(2);
    if (cmd === 'monitor') {
        await runMonitorCli(rest);
        return;
    }
    if (cmd === 'owner-move') {
        await runOwnerMoveCli(rest);
        return;
    }
    throw new Error(`Unknown command "${cmd}". Use "monitor" or "owner-move".`);
}

main().catch((err) => {
    console.error(err instanceof Error ? err.message : err);
    process.exit(1);
});
