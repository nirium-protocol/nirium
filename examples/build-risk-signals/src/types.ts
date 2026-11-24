export interface StrategyAllocation {
    amount: string;
    paused?: boolean;
    strategy_address: string;
}

export interface ManagedFund {
    asset: string;
    idle_amount?: string;
    invested_amount?: string;
    strategy_allocations?: StrategyAllocation[];
    total_amount?: string;
}

export interface VaultRoles {
    manager?: string;
    rebalanceManager?: string;
    emergencyManager?: string;
    feeReceiver?: string;
}

export interface VaultState {
    ok?: boolean;
    network?: string;
    vault: string;
    roles?: VaultRoles;
    assets?: Array<{
        address: string;
        strategies: Array<{ address: string; name: string; paused?: boolean }>;
    }>;
    totalManagedFunds?: ManagedFund[];
    holderBalance?: string;
    niriumIsRebalanceManagerOnly?: boolean | null;
    autonomousRebalancing?: string;
}

export interface ThresholdConfig {
    concentrationThresholdPercent: number;
    minIdleBufferPercent: number;
}

export interface ConcentrationReading {
    timestamp: string;
    vault: string;
    asset: string;
    idleStroops: string;
    investedStroops: string;
    totalStroops: string;
    maxStrategyAddress: string | null;
    maxStrategyConcentrationPercent: number;
    investedSharePercent: number;
    idleBufferPercent: number;
    healthStatus: 'NOMINAL' | 'SIGNAL_RAISED';
}

export type RiskSignalType = 'STRATEGY_CONCENTRATION_HIGH' | 'IDLE_BUFFER_LOW';

export interface RiskSignal {
    signalType: RiskSignalType;
    vault: string;
    asset: string;
    strategyAddress: string | null;
    timestamp: string;
    metricName: string;
    metricValuePercent: number;
    thresholdPercent: number;
    recommendedUnwindStroops: string;
    message: string;
}

export interface MonitorEvaluation {
    reading: ConcentrationReading;
    signals: RiskSignal[];
}

export interface MonitorCapabilities {
    canReadVault: true;
    holdsSigningKey: false;
    canMoveFunds: false;
}
