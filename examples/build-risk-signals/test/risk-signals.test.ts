import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import test from 'node:test';
import { fileURLToPath } from 'node:url';
import { Account, Asset, BASE_FEE, Keypair, Networks, Operation, TransactionBuilder } from '@stellar/stellar-sdk';
import { evaluateVaultHealth, formatStroops } from '../src/metrics.ts';
import { RiskMonitorAgent, type ReadOnlyVaultClient } from '../src/monitor.ts';
import {
    executeOwnerRebalance,
    executeOwnerWithdraw,
    resolveTestnetPassphrase,
    signUnsignedXdr,
    type OwnerAgentClient,
} from '../src/owner.ts';
import type { VaultState } from '../src/types.ts';

const TEST_DIR = dirname(fileURLToPath(import.meta.url));
const SRC_DIR = join(TEST_DIR, '..', 'src');

const THRESHOLDS = {
    concentrationThresholdPercent: 75,
    minIdleBufferPercent: 25,
};

function makeVaultState(idleStroops: string, investedStroops: string): VaultState {
    const total = (BigInt(idleStroops) + BigInt(investedStroops)).toString();
    return {
        ok: true,
        network: 'testnet',
        vault: 'CVAULT_TEST_001',
        roles: {
            manager: 'GOWNER_TEST_ACCOUNT',
            rebalanceManager: 'GOWNER_TEST_ACCOUNT',
        },
        assets: [
            {
                address: 'CUSDC_TEST',
                strategies: [{ address: 'CSTRATEGY_BLEND_1', name: 'usdc-blend', paused: false }],
            },
        ],
        totalManagedFunds: [
            {
                asset: 'CUSDC_TEST',
                idle_amount: idleStroops,
                invested_amount: investedStroops,
                total_amount: total,
                strategy_allocations: [
                    {
                        strategy_address: 'CSTRATEGY_BLEND_1',
                        amount: investedStroops,
                        paused: false,
                    },
                ],
            },
        ],
    };
}

test('formatStroops formats 7-decimal integer amounts', () => {
    assert.equal(formatStroops('50000000'), '5.0000000 (50000000 stroops)');
    assert.equal(formatStroops('0'), '0.0000000 (0 stroops)');
    assert.equal(formatStroops(undefined), '0.0000000 (0 stroops)');
});

test('evaluateVaultHealth: Reading 1 nominal (50% concentration) and Reading 2 signal raised (90% concentration)', () => {
    // Reading 1: 2.5 USDC idle, 2.5 USDC invested -> 50% strategy concentration -> NOMINAL
    const eval1 = evaluateVaultHealth(
        makeVaultState('25000000', '25000000'),
        THRESHOLDS,
        '2026-11-22T18:00:00.000Z',
    );
    assert.equal(eval1.length, 1);
    assert.equal(eval1[0].reading.maxStrategyConcentrationPercent, 50);
    assert.equal(eval1[0].reading.idleBufferPercent, 50);
    assert.equal(eval1[0].reading.healthStatus, 'NOMINAL');
    assert.equal(eval1[0].signals.length, 0);

    // Reading 2: 0.5 USDC idle, 4.5 USDC invested -> 90% concentration (>=75%) & 10% idle (<25%) -> SIGNAL_RAISED
    const eval2 = evaluateVaultHealth(
        makeVaultState('5000000', '45000000'),
        THRESHOLDS,
        '2026-11-22T18:01:00.000Z',
    );
    assert.equal(eval2.length, 1);
    assert.equal(eval2[0].reading.maxStrategyConcentrationPercent, 90);
    assert.equal(eval2[0].reading.idleBufferPercent, 10);
    assert.equal(eval2[0].reading.healthStatus, 'SIGNAL_RAISED');
    assert.equal(eval2[0].signals.length, 2);
    assert.equal(eval2[0].signals[0].signalType, 'STRATEGY_CONCENTRATION_HIGH');
    assert.equal(eval2[0].signals[0].strategyAddress, 'CSTRATEGY_BLEND_1');
    // Target concentration = min(75 - 10, 100 - 25) = 65% -> 32,500,000 stroops -> unwind 12,500,000 stroops
    assert.equal(eval2[0].signals[0].recommendedUnwindStroops, '12500000');
    assert.equal(eval2[0].signals[1].signalType, 'IDLE_BUFFER_LOW');
});

test('evaluateVaultHealth handles vaults with empty totalManagedFunds', () => {
    const emptyEval = evaluateVaultHealth(
        { vault: 'CVAULT_EMPTY', totalManagedFunds: [] },
        THRESHOLDS,
        '2026-11-22T18:00:00.000Z',
    );
    assert.equal(emptyEval.length, 1);
    assert.equal(emptyEval[0].reading.healthStatus, 'NOMINAL');
    assert.equal(emptyEval[0].signals.length, 0);
});

test('RiskMonitorAgent never holds a signing key and never calls any signer or write method', async () => {
    const ephemeralSecret = Keypair.random().secret();
    const prevOwnerEnv = process.env.OWNER_SECRET_KEY;
    const prevStellarEnv = process.env.STELLAR_SECRET_KEY;
    process.env.OWNER_SECRET_KEY = ephemeralSecret;
    process.env.STELLAR_SECRET_KEY = ephemeralSecret;

    try {
        let getVaultCalls = 0;
        const forbiddenCalls: string[] = [];

        const strictProxy = new Proxy(
            {
                async getTreasuryVault(vaultId: string): Promise<VaultState> {
                    getVaultCalls++;
                    assert.equal(vaultId, 'CVAULT_TEST_001');
                    return makeVaultState('0', '50000000');
                },
            },
            {
                get(target, prop, receiver) {
                    if (prop !== 'getTreasuryVault') {
                        forbiddenCalls.push(String(prop));
                        throw new Error(`Monitor attempted to access non-read property "${String(prop)}"`);
                    }
                    return Reflect.get(target, prop, receiver);
                },
            },
        ) as unknown as ReadOnlyVaultClient;

        const monitor = new RiskMonitorAgent(strictProxy, THRESHOLDS);
        const caps = monitor.getCapabilities();
        assert.deepEqual(caps, {
            canReadVault: true,
            holdsSigningKey: false,
            canMoveFunds: false,
        });

        // Monitor instance must not contain any Stellar secret seed anywhere on its own properties
        for (const [key, val] of Object.entries(monitor)) {
            if (key !== 'client') {
                assert.equal(JSON.stringify(val).includes(ephemeralSecret), false);
            }
        }

        const evals = await monitor.pollOnce('CVAULT_TEST_001', undefined, '2026-11-22T18:02:00.000Z');
        assert.equal(getVaultCalls, 1);
        assert.equal(forbiddenCalls.length, 0);
        assert.equal(evals[0].reading.healthStatus, 'SIGNAL_RAISED');
        assert.equal(evals[0].signals[0].signalType, 'STRATEGY_CONCENTRATION_HIGH');

        // Verify monitor.ts and metrics.ts do not import stellar-sdk signing primitives or read secret env vars
        const monitorSrc = readFileSync(join(SRC_DIR, 'monitor.ts'), 'utf8');
        const metricsSrc = readFileSync(join(SRC_DIR, 'metrics.ts'), 'utf8');
        for (const src of [monitorSrc, metricsSrc]) {
            assert.equal(src.includes('Keypair'), false);
            assert.equal(src.includes('OWNER_SECRET_KEY'), false);
            assert.equal(src.includes('STELLAR_SECRET_KEY'), false);
            assert.equal(src.includes('submitTreasuryTx'), false);
        }
    } finally {
        if (prevOwnerEnv === undefined) delete process.env.OWNER_SECRET_KEY;
        else process.env.OWNER_SECRET_KEY = prevOwnerEnv;
        if (prevStellarEnv === undefined) delete process.env.STELLAR_SECRET_KEY;
        else process.env.STELLAR_SECRET_KEY = prevStellarEnv;
    }
});

test('owner signer refuses mainnet passphrase and signs testnet XDR locally without leaking secret', async () => {
    assert.throws(() => resolveTestnetPassphrase(Networks.PUBLIC), /Network passphrase mismatch/);
    assert.equal(resolveTestnetPassphrase(), Networks.TESTNET);

    const ownerKp = Keypair.random();
    const dummyAccount = new Account(ownerKp.publicKey(), '100');
    const unsignedTx = new TransactionBuilder(dummyAccount, {
        fee: BASE_FEE,
        networkPassphrase: Networks.TESTNET,
    })
        .addOperation(
            Operation.payment({
                destination: Keypair.random().publicKey(),
                asset: Asset.native(),
                amount: '1',
            }),
        )
        .setTimeout(60)
        .build();
    const unsignedXdr = unsignedTx.toXDR();

    assert.throws(() => signUnsignedXdr(unsignedXdr, ownerKp.secret(), Networks.PUBLIC), /Network passphrase mismatch/);

    let submittedXdr = '';
    const mockOwnerClient: OwnerAgentClient = {
        async withdrawFromTreasuryVault(opts) {
            assert.equal(opts.from, ownerKp.publicKey());
            return { xdr: unsignedXdr, signWith: ownerKp.publicKey(), shares: '10000000', heldShares: '20000000' };
        },
        async buildTreasuryRebalance(opts) {
            assert.equal(opts.caller, ownerKp.publicKey());
            assert.equal(opts.instructions[0].kind, 'Unwind');
            return { xdr: unsignedXdr, signWith: ownerKp.publicKey() };
        },
        async submitTreasuryTx(xdr: string) {
            submittedXdr = xdr;
            return {
                hash: '0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef',
            };
        },
    };

    const withdrawResult = await executeOwnerWithdraw(mockOwnerClient, {
        vaultId: 'CVAULT_TEST_001',
        ownerSecret: ownerKp.secret(),
        shares: '10000000',
    });
    assert.equal(withdrawResult.signedBy, ownerKp.publicKey());
    assert.equal(withdrawResult.shares, '10000000');
    assert.equal(submittedXdr.includes(ownerKp.secret()), false);

    const result = await executeOwnerRebalance(mockOwnerClient, {
        vaultId: 'CVAULT_TEST_001',
        ownerSecret: ownerKp.secret(),
        strategyAddress: 'CSTRATEGY_BLEND_1',
        kind: 'Unwind',
        amountStroops: '12500000',
    });

    assert.equal(result.signedBy, ownerKp.publicKey());
    assert.equal(submittedXdr.includes(ownerKp.secret()), false);

    const parsedSigned = TransactionBuilder.fromXDR(submittedXdr, Networks.TESTNET);
    assert.equal(parsedSigned.signatures.length, 1);

    // Reject if signWith belongs to a different account than OWNER_SECRET_KEY
    const mismatchClient: OwnerAgentClient = {
        async withdrawFromTreasuryVault() {
            return { xdr: unsignedXdr, signWith: Keypair.random().publicKey(), shares: '10000000', heldShares: '10000000' };
        },
        async buildTreasuryRebalance() {
            return { xdr: unsignedXdr, signWith: Keypair.random().publicKey() };
        },
        async submitTreasuryTx() {
            throw new Error('Should not submit on signer mismatch');
        },
    };
    await assert.rejects(
        () =>
            executeOwnerRebalance(mismatchClient, {
                vaultId: 'CVAULT_TEST_001',
                ownerSecret: ownerKp.secret(),
                strategyAddress: 'CSTRATEGY_BLEND_1',
                kind: 'Unwind',
                amountStroops: '12500000',
            }),
        /Vault expects signature from/,
    );
});
