import { Keypair } from '@stellar/stellar-sdk';

export interface SensorReading {
    version: 'iot-reading-v1';
    readingId: string;
    sensorId: string;
    sensorPublicKey: string;
    metric: string;
    value: number;
    unit: string;
    recordedAt: string;
}

export interface SignedSensorReading {
    reading: SensorReading;
    signature: string;
}

export interface ReadingVerification {
    valid: boolean;
    readingId: string;
    sensorId: string;
    reason?: string;
}

/** Deterministic JSON: object keys sorted at every level, no whitespace. */
export function canonicalJson(value: unknown): string {
    if (value === null || typeof value !== 'object') {
        return JSON.stringify(value);
    }
    if (Array.isArray(value)) {
        return `[${value.map(canonicalJson).join(',')}]`;
    }
    const obj = value as Record<string, unknown>;
    const keys = Object.keys(obj)
        .filter((k) => obj[k] !== undefined)
        .sort();
    return `{${keys.map((k) => `${JSON.stringify(k)}:${canonicalJson(obj[k])}`).join(',')}}`;
}

/**
 * Simulated IoT sensor with its own dedicated ed25519 keypair.
 * Signs every telemetry reading locally before forwarding to the gateway.
 */
export class SimulatedSensor {
    readonly sensorId: string;
    readonly metric: string;
    readonly unit: string;
    private readonly keypair: Keypair;

    constructor(sensorId: string, metric: string, unit: string, keypair: Keypair = Keypair.random()) {
        this.sensorId = sensorId;
        this.metric = metric;
        this.unit = unit;
        this.keypair = keypair;
    }

    get publicKey(): string {
        return this.keypair.publicKey();
    }

    emitReading(readingId: string, value: number, recordedAt = new Date().toISOString()): SignedSensorReading {
        const reading: SensorReading = {
            version: 'iot-reading-v1',
            readingId,
            sensorId: this.sensorId,
            sensorPublicKey: this.keypair.publicKey(),
            metric: this.metric,
            value,
            unit: this.unit,
            recordedAt,
        };
        const payload = Buffer.from(canonicalJson(reading), 'utf8');
        const signature = this.keypair.sign(payload).toString('base64');
        return { reading, signature };
    }
}

/**
 * Verify a single sensor reading's ed25519 signature against its declared sensorPublicKey.
 */
export function verifySensorReading(entry: SignedSensorReading): ReadingVerification {
    const readingId = entry?.reading?.readingId ?? '<unknown>';
    const sensorId = entry?.reading?.sensorId ?? '<unknown>';

    if (!entry?.reading?.sensorPublicKey || !entry?.signature) {
        return { valid: false, readingId, sensorId, reason: 'missing sensorPublicKey or signature' };
    }

    try {
        const keypair = Keypair.fromPublicKey(entry.reading.sensorPublicKey);
        const payload = Buffer.from(canonicalJson(entry.reading), 'utf8');
        const sigBytes = Buffer.from(entry.signature, 'base64');
        const ok = keypair.verify(payload, sigBytes);
        return ok
            ? { valid: true, readingId, sensorId }
            : { valid: false, readingId, sensorId, reason: 'invalid ed25519 sensor signature' };
    } catch (err) {
        return {
            valid: false,
            readingId,
            sensorId,
            reason: err instanceof Error ? err.message : String(err),
        };
    }
}
