import { Agent } from 'nirium';
import { evaluateVaultHealth, formatStroops } from './metrics.ts';
import type {
    MonitorCapabilities,
    MonitorEvaluation,
    ThresholdConfig,
    VaultState,
} from './types.ts';

/**
 * Minimal read-only client contract for the monitor agent.
 * Intentionally excludes all write, XDR-submission, and signing methods.
 */
export interface ReadOnlyVaultClient {
    getTreasuryVault(vaultId: string, holder?: string): Promise<VaultState>;
}

/**
 * Create a strictly read-only vault client backed by Nirium's Agent.
 * No secret key is accepted or stored anywhere in this monitor module.
 */
export function createReadOnlyClient(baseUrl: string): ReadOnlyVaultClient {
    const agent = new Agent({ apiKey: '', baseUrl: baseUrl.replace(/\/$/, '') });
    return {
        getTreasuryVault(vaultId: string, holder?: string): Promise<VaultState> {
            return agent.getTreasuryVault(vaultId, holder) as unknown as Promise<VaultState>;
        },
    };
}

/**
 * Read-only Risk Signal Monitor Agent.
 *
 * Reads DeFindex vault state via `getTreasuryVault()`, computes concentration
 * and idle-buffer metrics, and emits signals when thresholds are crossed.
 * Holds zero private keys and never signs or submits transactions.
 */
export class RiskMonitorAgent {
    private readonly client: ReadOnlyVaultClient;
    private readonly thresholds: ThresholdConfig;

    constructor(client: ReadOnlyVaultClient, thresholds: ThresholdConfig) {
        this.client = client;
        this.thresholds = thresholds;
    }

    getCapabilities(): MonitorCapabilities {
        return {
            canReadVault: true,
            holdsSigningKey: false,
            canMoveFunds: false,
        };
    }

    async pollOnce(vaultId: string, holder?: string, timestamp?: string): Promise<MonitorEvaluation[]> {
        const state = await this.client.getTreasuryVault(vaultId, holder);
        return evaluateVaultHealth(state, this.thresholds, timestamp);
    }
}

export function printEvaluation(index: number, evaluations: MonitorEvaluation[]): void {
    for (const { reading, signals } of evaluations) {
        console.log(`[Reading #${index} | ${reading.timestamp}] Vault ${reading.vault}`);
        console.log(`  Asset:                ${reading.asset}`);
        console.log(`  Total Managed:        ${formatStroops(reading.totalStroops)}`);
        console.log(`  Invested:             ${formatStroops(reading.investedStroops)} (${reading.investedSharePercent.toFixed(2)}%)`);
        console.log(`  Idle Reserve:         ${formatStroops(reading.idleStroops)} (${reading.idleBufferPercent.toFixed(2)}%)`);
        console.log(`  Top Strategy:         ${reading.maxStrategyAddress ?? 'none'}`);
        console.log(`  Max Concentration:    ${reading.maxStrategyConcentrationPercent.toFixed(2)}%`);
        console.log(`  Status:               ${reading.healthStatus}`);

        for (const sig of signals) {
            console.log('');
            console.log(`  [SIGNAL: ${sig.signalType}]`);
            console.log(`    Metric:             ${sig.metricName} = ${sig.metricValuePercent.toFixed(2)}% (threshold: ${sig.thresholdPercent.toFixed(2)}%)`);
            console.log(`    Suggested Unwind:   ${formatStroops(sig.recommendedUnwindStroops)}`);
            console.log(`    Note:               ${sig.message}`);
            console.log('    Custody boundary:   Monitor holds NO signing key. Vault owner key required to authorize any move.');
        }
        console.log('');
    }
}
