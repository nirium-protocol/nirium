import 'dotenv/config';
import { Keypair } from '@stellar/stellar-sdk';
import { checkBatch } from './check.js';
import { collectAndAnchorBatch, niriumAnchorer } from './gateway.js';
import { SimulatedSensor } from './sensor.js';
import { BatchStore } from './store.js';

const env = (key: string, fallback = '') => (process.env[key] ?? fallback).trim();

function requireGatewayKeypair(): Keypair {
    const secret = env('GATEWAY_SECRET_KEY');
    if (!secret) {
        throw new Error(
            'Set GATEWAY_SECRET_KEY in .env to your own Stellar testnet secret (S...).\n' +
                'Generate one with: npm run receipts -- --new-key',
        );
    }
    return Keypair.fromSecret(secret);
}

function getFlag(args: string[], flag: string): string | undefined {
    const idx = args.indexOf(flag);
    return idx >= 0 && args[idx + 1] ? args[idx + 1] : undefined;
}

function sleep(ms: number): Promise<void> {
    return new Promise((resolve) => setTimeout(resolve, ms));
}

function createDemoSensors(): SimulatedSensor[] {
    return [
        new SimulatedSensor('temp-bay-1', 'temperature_c', 'C'),
        new SimulatedSensor('humidity-bay-2', 'relative_humidity_pct', '%'),
        new SimulatedSensor('pressure-bay-3', 'barometric_hpa', 'hPa'),
    ];
}

async function runBatches(args: string[]): Promise<number> {
    const gatewayKeypair = requireGatewayKeypair();
    const baseUrl = env('NIRIUM_API_URL', 'https://nirium-agent.fly.dev');
    const apiKey = env('NIRIUM_API_KEY');
    const tag = env('AUDIT_TAG', 'wave11-iot-readings');
    const batchDir = env('BATCH_DIR', '.batches');
    const batchCount = Number(getFlag(args, '--batches') ?? '3');
    const intervalSeconds = Number(getFlag(args, '--interval') ?? env('BATCH_INTERVAL_SECONDS', '2'));

    const store = new BatchStore(batchDir);
    const anchorer = niriumAnchorer(baseUrl, apiKey);
    const sensors = createDemoSensors();

    console.log(`Gateway key: ${gatewayKeypair.publicKey()} | tag: ${tag}`);
    console.log(`Sensors (${sensors.length}):`);
    for (const s of sensors) {
        console.log(`  - ${s.sensorId} (${s.metric}, ${s.unit}) ed25519=${s.publicKey}`);
    }
    console.log('');

    for (let b = 1; b <= batchCount; b++) {
        const batchId = `batch-${String(b).padStart(3, '0')}`;
        const windowStart = new Date().toISOString();

        const readings = [
            sensors[0].emitReading(`${batchId}-r1`, Number((21.4 + b * 0.3).toFixed(2))),
            sensors[1].emitReading(`${batchId}-r2`, Number((48.0 + b * 1.1).toFixed(2))),
            sensors[2].emitReading(`${batchId}-r3`, Number((1013.2 + b * 0.4).toFixed(2))),
        ];
        const windowEnd = new Date().toISOString();

        const receipt = await collectAndAnchorBatch({
            batchId,
            readings,
            windowStart,
            windowEnd,
            store,
            anchorer,
            gatewayKeypair,
            tag,
        });

        const sensorList = receipt.contributingSensors.map((c) => `${c.sensorId}(${c.readingCount})`).join(', ');
        console.log(
            `${receipt.batchId}  sensors=[${sensorList}]  sha256=${receipt.sha256}  cid=${receipt.cid}  anchoredAt=${receipt.anchoredAt}`,
        );

        if (b < batchCount && intervalSeconds > 0) {
            await sleep(intervalSeconds * 1000);
        }
    }

    return 0;
}

function runCheckBatch(args: string[]): number {
    const batchId = args[0];
    if (!batchId) {
        console.error('Usage: check-batch <batch-id>');
        return 2;
    }

    const store = new BatchStore(env('BATCH_DIR', '.batches'));
    const res = checkBatch(batchId, store);

    console.log(`Batch:      ${res.batchId}`);
    console.log(`CID:        ${res.cid}`);
    console.log(`Readings:   ${res.sensorChecks.length} checked, ${res.failedReadings.length} failed`);
    for (const r of res.sensorChecks) {
        console.log(
            `  ${r.valid ? 'PASS' : 'FAIL'} ${r.readingId} (${r.sensorId})${r.reason ? ` — ${r.reason}` : ''}`,
        );
    }
    console.log('');
    if (res.verifyOutput) {
        console.log(res.verifyOutput);
        console.log('');
    }
    console.log(`recomputed ${res.recomputedSha256}`);
    console.log(`anchored   ${res.anchoredSha256}`);

    if (!res.ok) {
        for (const reason of res.failureReasons) {
            console.error(`ERROR: ${reason}`);
        }
        console.log('CHECK FAILED');
        return 1;
    }

    console.log('CHECK PASSED');
    return 0;
}

function runReceipts(args: string[]): number {
    if (args.includes('--new-key')) {
        const kp = Keypair.random();
        console.log(`public  ${kp.publicKey()}`);
        console.log(`secret  ${kp.secret()}`);
        console.log('(put the secret in .env as GATEWAY_SECRET_KEY; never commit it)');
        return 0;
    }

    const store = new BatchStore(env('BATCH_DIR', '.batches'));
    for (const r of store.receipts()) {
        console.log(`${r.batchId}  ${r.cid}  ${r.sha256}  sensors=${r.contributingSensors.length}`);
    }
    return 0;
}

async function main(argv: string[]): Promise<number> {
    const [cmd, ...rest] = argv;
    if (cmd === 'run') return runBatches(rest);
    if (cmd === 'check-batch') return runCheckBatch(rest);
    if (cmd === 'receipts') return runReceipts(rest);
    console.error('Usage: run | check-batch <batch-id> | receipts [--new-key]');
    return 2;
}

main(process.argv.slice(2)).then(
    (code) => {
        process.exitCode = code;
    },
    (err) => {
        console.error(err instanceof Error ? err.message : String(err));
        process.exitCode = 1;
    },
);
