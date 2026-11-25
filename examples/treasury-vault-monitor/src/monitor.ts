import { ManagedFund, VaultAlert, VaultReading, VaultState } from './types.ts';

/**
 * Format raw stroops (7 decimals) into readable unit string
 */
export function formatStroops(value?: string): string {
    if (!value) return '0.0000000';
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

/**
 * Parse raw VaultState returned by Nirium Agent API into standardized VaultReadings
 */
export function parseVaultReadings(state: VaultState, timestamp = new Date().toISOString()): VaultReading[] {
    const funds: ManagedFund[] = state.totalManagedFunds ?? [];
    if (funds.length === 0) {
        return [
            {
                timestamp,
                vault: state.vault,
                asset: 'N/A',
                idleStroops: '0',
                investedStroops: '0',
                totalStroops: '0',
                investedRatioPercent: 0,
                idleRatioPercent: 0,
            },
        ];
    }

    return funds.map((f) => {
        const idle = BigInt(f.idle_amount || '0');
        const invested = BigInt(f.invested_amount || '0');
        const total = BigInt(f.total_amount || (idle + invested).toString());

        let investedRatioPercent = 0;
        let idleRatioPercent = 0;

        if (total > 0n) {
            investedRatioPercent = Number((invested * 10000n) / total) / 100;
            idleRatioPercent = Number((idle * 10000n) / total) / 100;
        }

        return {
            timestamp,
            vault: state.vault,
            asset: f.asset,
            idleStroops: idle.toString(),
            investedStroops: invested.toString(),
            totalStroops: total.toString(),
            investedRatioPercent,
            idleRatioPercent,
        };
    });
}

/**
 * Evaluate previous vs current reading against configured balance and allocation drift thresholds.
 */
export function checkThresholds(
    prev: VaultReading,
    curr: VaultReading,
    config: { balanceThresholdPercent: number; allocationThresholdPercent: number },
): VaultAlert[] {
    const alerts: VaultAlert[] = [];

    const prevTotal = BigInt(prev.totalStroops || '0');
    const currTotal = BigInt(curr.totalStroops || '0');

    // 1. Balance Shift Detection
    let balanceDeltaPercent = 0;
    if (prevTotal > 0n) {
        const diff = currTotal > prevTotal ? currTotal - prevTotal : prevTotal - currTotal;
        balanceDeltaPercent = Number((diff * 10000n) / prevTotal) / 100;
    } else if (currTotal > 0n) {
        balanceDeltaPercent = 100.0;
    }

    if (balanceDeltaPercent >= config.balanceThresholdPercent) {
        const direction = currTotal >= prevTotal ? 'increased' : 'decreased';
        alerts.push({
            alertType: 'BALANCE_SHIFT',
            vault: curr.vault,
            asset: curr.asset,
            timestamp: curr.timestamp,
            message: `Vault balance ${direction} by ${balanceDeltaPercent.toFixed(2)}% (threshold: ${config.balanceThresholdPercent.toFixed(2)}%)`,
            previousReading: prev,
            currentReading: curr,
            deltaPercent: balanceDeltaPercent,
            thresholdPercent: config.balanceThresholdPercent,
        });
    }

    // 2. Strategy Allocation Drift Detection (invested vs idle ratio shift)
    const allocationDriftPercent = Math.abs(curr.investedRatioPercent - prev.investedRatioPercent);
    if (allocationDriftPercent >= config.allocationThresholdPercent) {
        alerts.push({
            alertType: 'ALLOCATION_DRIFT',
            vault: curr.vault,
            asset: curr.asset,
            timestamp: curr.timestamp,
            message: `Strategy allocation ratio drifted by ${allocationDriftPercent.toFixed(2)}% (threshold: ${config.allocationThresholdPercent.toFixed(2)}%)`,
            previousReading: prev,
            currentReading: curr,
            deltaPercent: allocationDriftPercent,
            thresholdPercent: config.allocationThresholdPercent,
        });
    }

    return alerts;
}
