#!/usr/bin/env node
// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 Nirium Protocol Contributors

import 'dotenv/config';
import { Agent } from 'nirium';
import { dispatchAlert } from './alert.ts';
import { checkThresholds, formatStroops, parseVaultReadings } from './monitor.ts';
import { MonitorConfig, VaultReading, VaultState } from './types.ts';

const DEFAULT_BASE_URL = 'https://nirium-agent.fly.dev';

export function parseArgs(args: string[]): MonitorConfig {
    const config: MonitorConfig = {
        vaultId: process.env.VAULT_ID?.trim(),
        pollIntervalMinutes: Number(process.env.POLL_INTERVAL_MINUTES || '5'),
        balanceThresholdPercent: Number(process.env.BALANCE_THRESHOLD_PERCENT || '5.0'),
        allocationThresholdPercent: Number(process.env.ALLOCATION_THRESHOLD_PERCENT || '5.0'),
        webhookUrl: process.env.ALERT_WEBHOOK_URL?.trim(),
        baseUrl: (process.env.NIRIUM_BASE_URL || DEFAULT_BASE_URL).replace(/\/$/, ''),
        apiKey: process.env.NIRIUM_API_KEY?.trim(),
        once: false,
    };

    for (let i = 0; i < args.length; i++) {
        const arg = args[i];
        if (arg === '--vault' && args[i + 1]) config.vaultId = args[++i];
        else if (arg === '--interval' && args[i + 1]) config.pollIntervalMinutes = Number(args[++i]);
        else if (arg === '--balance-threshold' && args[i + 1]) config.balanceThresholdPercent = Number(args[++i]);
        else if (arg === '--allocation-threshold' && args[i + 1]) config.allocationThresholdPercent = Number(args[++i]);
        else if (arg === '--webhook' && args[i + 1]) config.webhookUrl = args[++i];
        else if (arg === '--base-url' && args[i + 1]) config.baseUrl = args[++i].replace(/\/$/, '');
        else if (arg === '--once') config.once = true;
    }

    return config;
}

export function printBanner(config: MonitorConfig): void {
    console.log('═══════════════════════════════════════════════════════════════');
    console.log(' Nirium Treasury Vault Monitor — Stellar Testnet');
    console.log(' Strictly READ-ONLY: No keys, no deposits, no withdrawals.');
    console.log('═══════════════════════════════════════════════════════════════');
    console.log(` Agent API:           ${config.baseUrl}`);
    console.log(` Target Vault:        ${config.vaultId || '(auto-select from getTreasuryVaults)'}`);
    console.log(` Poll Interval:       ${config.pollIntervalMinutes} minute(s)`);
    console.log(` Balance Threshold:   ±${config.balanceThresholdPercent}%`);
    console.log(` Allocation Drift:    ±${config.allocationThresholdPercent}%`);
    console.log(` Webhook Alert:       ${config.webhookUrl || 'Disabled (stdout only)'}`);
    console.log(` Mode:                ${config.once ? 'Single Poll (--once)' : 'Continuous Polling'}`);
    console.log('───────────────────────────────────────────────────────────────');
    console.log('');
}

export async function runPollIteration(
    agent: Agent,
    vaultId: string,
    history: Map<string, VaultReading>,
    config: MonitorConfig,
): Promise<{ readings: VaultReading[]; alertsCount: number }> {
    const rawState = (await agent.getTreasuryVault(vaultId)) as unknown as VaultState;
    const readings = parseVaultReadings(rawState);
    let alertsCount = 0;

    for (const curr of readings) {
        console.log(`[${curr.timestamp}] Reading for vault ${curr.vault}:`);
        console.log(`   Asset:    ${curr.asset}`);
        console.log(`   Total:    ${formatStroops(curr.totalStroops)}`);
        console.log(`   Invested: ${formatStroops(curr.investedStroops)} (${curr.investedRatioPercent.toFixed(2)}%)`);
        console.log(`   Idle:     ${formatStroops(curr.idleStroops)} (${curr.idleRatioPercent.toFixed(2)}%)`);

        const prev = history.get(curr.asset);
        if (prev) {
            const alerts = checkThresholds(prev, curr, {
                balanceThresholdPercent: config.balanceThresholdPercent,
                allocationThresholdPercent: config.allocationThresholdPercent,
            });

            for (const alert of alerts) {
                await dispatchAlert(alert, config.webhookUrl);
                alertsCount++;
            }
        }

        // Update history with latest reading
        history.set(curr.asset, curr);
    }

    return { readings, alertsCount };
}

export async function startMonitor(config: MonitorConfig): Promise<void> {
    printBanner(config);

    const agent = new Agent({ baseUrl: config.baseUrl, apiKey: config.apiKey || '' });

    let vaultId = config.vaultId;
    if (!vaultId) {
        console.log('Discovering active testnet vaults via getTreasuryVaults()...');
        const vaultsRes = (await agent.getTreasuryVaults()) as unknown as { vaults?: Array<{ vault: string }> };
        const vaults = vaultsRes.vaults ?? [];
        if (vaults.length === 0) {
            throw new Error('No testnet vaults found on agent node.');
        }
        vaultId = vaults[0].vault;
        console.log(`Auto-selected testnet vault: ${vaultId}`);
        console.log('');
    }

    const history = new Map<string, VaultReading>();

    // Initial poll
    await runPollIteration(agent, vaultId, history, config);

    if (config.once) {
        console.log('Completed single poll execution (--once). Exiting cleanly.');
        return;
    }

    // Polling loop
    const intervalMs = config.pollIntervalMinutes * 60 * 1000;
    console.log(`Next poll scheduled in ${config.pollIntervalMinutes} minute(s)...`);

    const timer = setInterval(async () => {
        try {
            await runPollIteration(agent, vaultId!, history, config);
        } catch (err) {
            console.error('Error during poll iteration:', err instanceof Error ? err.message : err);
        }
    }, intervalMs);

    const shutdown = () => {
        console.log('\nShutting down treasury vault monitor cleanly...');
        clearInterval(timer);
        process.exit(0);
    };

    process.on('SIGINT', shutdown);
    process.on('SIGTERM', shutdown);
}

// Execute CLI when run directly
const isDirect = import.meta.url === `file:///${process.argv[1]?.replace(/\\/g, '/')}`
    || process.argv[1]?.endsWith('index.ts')
    || process.argv[1]?.endsWith('index.js');

if (isDirect) {
    const config = parseArgs(process.argv.slice(2));
    startMonitor(config).catch((err) => {
        console.error('Fatal error:', err instanceof Error ? err.message : err);
        process.exit(1);
    });
}
