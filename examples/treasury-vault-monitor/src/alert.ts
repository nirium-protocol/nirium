import { formatStroops } from './monitor.ts';
import { VaultAlert } from './types.ts';

/**
 * Dispatch alert to stdout and optionally to configured webhook URL
 */
export async function dispatchAlert(
    alert: VaultAlert,
    webhookUrl?: string,
    fetchFn: typeof fetch = fetch,
): Promise<{ stdoutLogged: boolean; webhookSent?: boolean; webhookError?: string }> {
    // 1. Stdout structured log
    const icon = alert.alertType === 'BALANCE_SHIFT' ? '💰' : '⚖️';
    console.log('');
    console.log(`🚨 [TREASURY ALERT: ${alert.alertType}] ${icon}`);
    console.log(`   Vault:      ${alert.vault}`);
    console.log(`   Asset:      ${alert.asset}`);
    console.log(`   Trigger:    ${alert.message}`);
    console.log(`   Previous:   Total ${formatStroops(alert.previousReading.totalStroops)} (Invested: ${alert.previousReading.investedRatioPercent.toFixed(2)}%, Idle: ${alert.previousReading.idleRatioPercent.toFixed(2)}%)`);
    console.log(`   Current:    Total ${formatStroops(alert.currentReading.totalStroops)} (Invested: ${alert.currentReading.investedRatioPercent.toFixed(2)}%, Idle: ${alert.currentReading.idleRatioPercent.toFixed(2)}%)`);
    console.log(`   Timestamp:  ${alert.timestamp}`);
    console.log('');

    // 2. Webhook dispatch
    if (webhookUrl) {
        try {
            const res = await fetchFn(webhookUrl, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json', 'User-Agent': 'nirium-treasury-vault-monitor/0.1.0' },
                body: JSON.stringify({
                    source: 'nirium-treasury-vault-monitor',
                    alert,
                }),
            });
            if (res.ok) {
                console.log(`   Webhook dispatched successfully to ${webhookUrl}`);
                return { stdoutLogged: true, webhookSent: true };
            } else {
                const errText = await res.text();
                console.error(`   Webhook returned error ${res.status}: ${errText}`);
                return { stdoutLogged: true, webhookSent: false, webhookError: `HTTP ${res.status}: ${errText}` };
            }
        } catch (err) {
            const errStr = err instanceof Error ? err.message : String(err);
            console.error(`   Webhook request failed: ${errStr}`);
            return { stdoutLogged: true, webhookSent: false, webhookError: errStr };
        }
    }

    return { stdoutLogged: true };
}
