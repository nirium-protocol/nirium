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
    niriumIsRebalanceManagerOnly?: boolean;
    autonomousRebalancing?: string;
}

export interface VaultReading {
    timestamp: string;
    vault: string;
    asset: string;
    idleStroops: string;
    investedStroops: string;
    totalStroops: string;
    investedRatioPercent: number;
    idleRatioPercent: number;
}

export type AlertType = 'BALANCE_SHIFT' | 'ALLOCATION_DRIFT';

export interface VaultAlert {
    alertType: AlertType;
    vault: string;
    asset: string;
    timestamp: string;
    message: string;
    previousReading: VaultReading;
    currentReading: VaultReading;
    deltaPercent: number;
    thresholdPercent: number;
}

export interface MonitorConfig {
    vaultId?: string;
    pollIntervalMinutes: number;
    balanceThresholdPercent: number;
    allocationThresholdPercent: number;
    webhookUrl?: string;
    baseUrl: string;
    apiKey?: string;
    once?: boolean;
}
