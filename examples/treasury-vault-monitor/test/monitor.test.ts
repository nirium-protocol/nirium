import test from 'node:test';
import assert from 'node:assert/strict';
import { checkThresholds, formatStroops, parseVaultReadings } from '../src/monitor.ts';
import { dispatchAlert } from '../src/alert.ts';
import { parseArgs } from '../src/index.ts';
import { VaultReading, VaultState } from '../src/types.ts';

test('formatStroops: formats 7-decimal integer string into human-readable unit', () => {
    assert.equal(formatStroops('10000000'), '1.0000000 (10000000 stroops)');
    assert.equal(formatStroops('10000628'), '1.0000628 (10000628 stroops)');
    assert.equal(formatStroops('0'), '0.0000000 (0 stroops)');
    assert.equal(formatStroops(''), '0.0000000');
});

test('parseVaultReadings: correctly calculates invested and idle ratios from state', () => {
    const mockState: VaultState = {
        vault: 'CDQHTFRWCCJTPWYJABGGKOHKBVPMXTQOKQQBWJF3VQ2LWS63KYC2V7MY',
        totalManagedFunds: [
            {
                asset: 'CC72F57YTPX76HAA64JQOEGHQAPSADQWSY5DWVBR66JINPFDLNCQYHIC',
                idle_amount: '2000000',
                invested_amount: '8000000',
                total_amount: '10000000',
            },
        ],
    };

    const readings = parseVaultReadings(mockState, '2026-11-19T07:30:00Z');
    assert.equal(readings.length, 1);
    const r = readings[0];
    assert.equal(r.vault, mockState.vault);
    assert.equal(r.idleStroops, '2000000');
    assert.equal(r.investedStroops, '8000000');
    assert.equal(r.totalStroops, '10000000');
    assert.equal(r.investedRatioPercent, 80.0);
    assert.equal(r.idleRatioPercent, 20.0);
});

test('checkThresholds: triggers balance shift alert when balance changes exceed threshold', () => {
    const prev: VaultReading = {
        timestamp: '2026-11-19T07:00:00Z',
        vault: 'CVAULT123',
        asset: 'CUSDC',
        idleStroops: '5000000',
        investedStroops: '5000000',
        totalStroops: '10000000', // 1.0 USDC
        investedRatioPercent: 50.0,
        idleRatioPercent: 50.0,
    };

    // Case 1: 2% change (below 5% threshold) -> No alert
    const minorChange: VaultReading = {
        ...prev,
        totalStroops: '10200000', // 1.02 USDC (+2%)
    };
    const noAlerts = checkThresholds(prev, minorChange, { balanceThresholdPercent: 5.0, allocationThresholdPercent: 5.0 });
    assert.equal(noAlerts.length, 0, 'Should not trigger alert for sub-threshold change');

    // Case 2: +15% increase -> Triggers BALANCE_SHIFT alert
    const largeIncrease: VaultReading = {
        ...prev,
        totalStroops: '11500000', // 1.15 USDC (+15%)
    };
    const increaseAlerts = checkThresholds(prev, largeIncrease, { balanceThresholdPercent: 5.0, allocationThresholdPercent: 5.0 });
    assert.equal(increaseAlerts.length, 1);
    assert.equal(increaseAlerts[0].alertType, 'BALANCE_SHIFT');
    assert.equal(increaseAlerts[0].deltaPercent, 15.0);
    assert.ok(increaseAlerts[0].message.includes('increased by 15.00%'));

    // Case 3: -20% decrease -> Triggers BALANCE_SHIFT alert
    const largeDecrease: VaultReading = {
        ...prev,
        totalStroops: '8000000', // 0.8 USDC (-20%)
    };
    const decreaseAlerts = checkThresholds(prev, largeDecrease, { balanceThresholdPercent: 5.0, allocationThresholdPercent: 5.0 });
    assert.equal(decreaseAlerts.length, 1);
    assert.equal(decreaseAlerts[0].alertType, 'BALANCE_SHIFT');
    assert.equal(decreaseAlerts[0].deltaPercent, 20.0);
    assert.ok(decreaseAlerts[0].message.includes('decreased by 20.00%'));
});

test('checkThresholds: triggers allocation drift alert when strategy ratio shifts', () => {
    const prev: VaultReading = {
        timestamp: '2026-11-19T07:00:00Z',
        vault: 'CVAULT123',
        asset: 'CUSDC',
        idleStroops: '1000000',
        investedStroops: '9000000',
        totalStroops: '10000000',
        investedRatioPercent: 90.0,
        idleRatioPercent: 10.0,
    };

    // Total balance unchanged, but allocation shifts from 90% invested to 65% invested (25% drift)
    const shifted: VaultReading = {
        ...prev,
        idleStroops: '3500000',
        investedStroops: '6500000',
        totalStroops: '10000000',
        investedRatioPercent: 65.0,
        idleRatioPercent: 35.0,
    };

    const alerts = checkThresholds(prev, shifted, { balanceThresholdPercent: 10.0, allocationThresholdPercent: 5.0 });
    assert.equal(alerts.length, 1);
    assert.equal(alerts[0].alertType, 'ALLOCATION_DRIFT');
    assert.equal(alerts[0].deltaPercent, 25.0);
    assert.ok(alerts[0].message.includes('Strategy allocation ratio drifted by 25.00%'));
});

test('dispatchAlert: dispatches alert to webhook endpoint via POST JSON', async () => {
    let capturedUrl = '';
    let capturedBody: any = null;

    const mockFetch: typeof fetch = async (input, init) => {
        capturedUrl = String(input);
        capturedBody = JSON.parse(String(init?.body));
        return new Response(JSON.stringify({ ok: true }), { status: 200 });
    };

    const alert = {
        alertType: 'BALANCE_SHIFT' as const,
        vault: 'CVAULT123',
        asset: 'CUSDC',
        timestamp: '2026-11-19T07:30:00Z',
        message: 'Vault balance increased by 10.00%',
        previousReading: {
            timestamp: '2026-11-19T07:00:00Z',
            vault: 'CVAULT123',
            asset: 'CUSDC',
            idleStroops: '0',
            investedStroops: '10000000',
            totalStroops: '10000000',
            investedRatioPercent: 100,
            idleRatioPercent: 0,
        },
        currentReading: {
            timestamp: '2026-11-19T07:30:00Z',
            vault: 'CVAULT123',
            asset: 'CUSDC',
            idleStroops: '0',
            investedStroops: '11000000',
            totalStroops: '11000000',
            investedRatioPercent: 100,
            idleRatioPercent: 0,
        },
        deltaPercent: 10.0,
        thresholdPercent: 5.0,
    };

    const res = await dispatchAlert(alert, 'https://alerts.example.com/webhook', mockFetch);
    assert.equal(res.stdoutLogged, true);
    assert.equal(res.webhookSent, true);
    assert.equal(capturedUrl, 'https://alerts.example.com/webhook');
    assert.equal(capturedBody.alert.alertType, 'BALANCE_SHIFT');
    assert.equal(capturedBody.alert.vault, 'CVAULT123');
});

test('parseArgs: correctly parses flags and fallbacks', () => {
    const config = parseArgs([
        '--vault', 'CVAULT999',
        '--interval', '10',
        '--balance-threshold', '3.5',
        '--allocation-threshold', '2.5',
        '--webhook', 'https://hooks.slack.com/services/123',
        '--once',
    ]);

    assert.equal(config.vaultId, 'CVAULT999');
    assert.equal(config.pollIntervalMinutes, 10);
    assert.equal(config.balanceThresholdPercent, 3.5);
    assert.equal(config.allocationThresholdPercent, 2.5);
    assert.equal(config.webhookUrl, 'https://hooks.slack.com/services/123');
    assert.equal(config.once, true);
});
