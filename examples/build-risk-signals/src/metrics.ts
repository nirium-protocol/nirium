import type {
    ConcentrationReading,
    ManagedFund,
    MonitorEvaluation,
    RiskSignal,
    ThresholdConfig,
    VaultState,
} from './types.ts';

/**
 * Format raw stroops (7 decimals) into a human-readable string.
 */
export function formatStroops(value?: string): string {
    if (!value) return '0.0000000 (0 stroops)';
    try {
        const raw = BigInt(value);
        const decimals = 7n;
        const base = 10n ** decimals;
        const whole = raw / base;
        const frac = (raw % base).toString().padStart(Number(decimals), '0');
        return `${whole.toString()}.${frac} (${value} stroops)`;
    } catch {
        return value;
    }
}

function toBasisPercent(part: bigint, total: bigint): number {
    if (total <= 0n || part <= 0n) return 0;
    return Number((part * 10000n) / total) / 100;
}

function computeTargetUnwindStroops(
    maxStrategyAmount: bigint,
    totalAmount: bigint,
    targetMaxSharePercent: number,
): string {
    if (totalAmount <= 0n || maxStrategyAmount <= 0n) return '0';
    const clampedTarget = Math.max(0, Math.min(100, targetMaxSharePercent));
    const targetBps = BigInt(Math.round(clampedTarget * 100));
    const targetAmount = (totalAmount * targetBps) / 10000n;
    if (maxStrategyAmount <= targetAmount) return '0';
    return (maxStrategyAmount - targetAmount).toString();
}

/**
 * Compute per-asset strategy concentration and idle buffer metrics from a vault snapshot,
 * raising signals whenever configured thresholds are crossed.
 */
export function evaluateVaultHealth(
    state: VaultState,
    thresholds: ThresholdConfig,
    timestamp = new Date().toISOString(),
): MonitorEvaluation[] {
    const funds: ManagedFund[] = state.totalManagedFunds ?? [];
    if (funds.length === 0) {
        return [
            {
                reading: {
                    timestamp,
                    vault: state.vault,
                    asset: 'N/A',
                    idleStroops: '0',
                    investedStroops: '0',
                    totalStroops: '0',
                    maxStrategyAddress: null,
                    maxStrategyConcentrationPercent: 0,
                    investedSharePercent: 0,
                    idleBufferPercent: 0,
                    healthStatus: 'NOMINAL',
                },
                signals: [],
            },
        ];
    }

    return funds.map((fund) => {
        const idle = BigInt(fund.idle_amount || '0');
        const invested = BigInt(fund.invested_amount || '0');
        const total = BigInt(fund.total_amount || (idle + invested).toString());

        const allocations = fund.strategy_allocations ?? [];
        let maxStrategyAddress: string | null = null;
        let maxStrategyAmount = 0n;

        for (const alloc of allocations) {
            const amt = BigInt(alloc.amount || '0');
            if (amt >= maxStrategyAmount) {
                maxStrategyAmount = amt;
                maxStrategyAddress = alloc.strategy_address;
            }
        }

        // Fall back to aggregate invested_amount if strategy_allocations was omitted by the node.
        if (allocations.length === 0 && invested > 0n) {
            maxStrategyAmount = invested;
            const firstStrategy = state.assets?.find((a) => a.address === fund.asset)?.strategies[0];
            maxStrategyAddress = firstStrategy?.address ?? null;
        }

        const maxStrategyConcentrationPercent = toBasisPercent(maxStrategyAmount, total);
        const investedSharePercent = toBasisPercent(invested, total);
        const idleBufferPercent = toBasisPercent(idle, total);

        const signals: RiskSignal[] = [];

        if (total > 0n && maxStrategyConcentrationPercent >= thresholds.concentrationThresholdPercent) {
            const targetPercent = Math.min(
                thresholds.concentrationThresholdPercent - 10,
                100 - thresholds.minIdleBufferPercent,
            );
            const recommendedUnwindStroops = computeTargetUnwindStroops(
                maxStrategyAmount,
                total,
                Math.max(0, targetPercent),
            );
            signals.push({
                signalType: 'STRATEGY_CONCENTRATION_HIGH',
                vault: state.vault,
                asset: fund.asset,
                strategyAddress: maxStrategyAddress,
                timestamp,
                metricName: 'maxStrategyConcentrationPercent',
                metricValuePercent: maxStrategyConcentrationPercent,
                thresholdPercent: thresholds.concentrationThresholdPercent,
                recommendedUnwindStroops,
                message:
                    `Single-strategy concentration reached ${maxStrategyConcentrationPercent.toFixed(2)}% ` +
                    `(threshold: ${thresholds.concentrationThresholdPercent.toFixed(2)}%). ` +
                    `Owner review recommended: unwind ${recommendedUnwindStroops} stroops to idle.`,
            });
        }

        if (total > 0n && idleBufferPercent < thresholds.minIdleBufferPercent) {
            const targetIdleBps = BigInt(Math.round(thresholds.minIdleBufferPercent * 100));
            const targetIdle = (total * targetIdleBps) / 10000n;
            const deficit = targetIdle > idle ? (targetIdle - idle).toString() : '0';
            signals.push({
                signalType: 'IDLE_BUFFER_LOW',
                vault: state.vault,
                asset: fund.asset,
                strategyAddress: maxStrategyAddress,
                timestamp,
                metricName: 'idleBufferPercent',
                metricValuePercent: idleBufferPercent,
                thresholdPercent: thresholds.minIdleBufferPercent,
                recommendedUnwindStroops: deficit,
                message:
                    `Idle reserve buffer dropped to ${idleBufferPercent.toFixed(2)}% ` +
                    `(minimum: ${thresholds.minIdleBufferPercent.toFixed(2)}%).`,
            });
        }

        const reading: ConcentrationReading = {
            timestamp,
            vault: state.vault,
            asset: fund.asset,
            idleStroops: idle.toString(),
            investedStroops: invested.toString(),
            totalStroops: total.toString(),
            maxStrategyAddress,
            maxStrategyConcentrationPercent,
            investedSharePercent,
            idleBufferPercent,
            healthStatus: signals.length > 0 ? 'SIGNAL_RAISED' : 'NOMINAL',
        };

        return { reading, signals };
    });
}
