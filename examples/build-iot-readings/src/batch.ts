import { createHash } from 'node:crypto';
import type { SignedSensorReading } from './sensor.js';

export interface ContributingSensor {
    sensorId: string;
    sensorPublicKey: string;
    readingCount: number;
}

export interface BatchFile {
    version: 'iot-batch-v1';
    batchId: string;
    windowStart: string;
    windowEnd: string;
    contributingSensors: ContributingSensor[];
    readings: SignedSensorReading[];
}

export function sha256Hex(data: Buffer | string): string {
    return createHash('sha256').update(data).digest('hex');
}

export function statementFor(sha256: string): string {
    return `nirium-audit-v1:${sha256}`;
}

export function summarizeContributors(readings: SignedSensorReading[]): ContributingSensor[] {
    const map = new Map<string, ContributingSensor>();
    for (const entry of readings) {
        const { sensorId, sensorPublicKey } = entry.reading;
        const existing = map.get(sensorId);
        if (existing) {
            if (existing.sensorPublicKey !== sensorPublicKey) {
                throw new Error(`Sensor "${sensorId}" changed public key within batch`);
            }
            existing.readingCount += 1;
        } else {
            map.set(sensorId, { sensorId, sensorPublicKey, readingCount: 1 });
        }
    }
    return Array.from(map.values()).sort((a, b) => a.sensorId.localeCompare(b.sensorId));
}

export function buildBatchFile(
    batchId: string,
    readings: SignedSensorReading[],
    windowStart: string,
    windowEnd: string,
): BatchFile {
    if (readings.length === 0) {
        throw new Error(`Cannot build empty batch "${batchId}"`);
    }
    return {
        version: 'iot-batch-v1',
        batchId,
        windowStart,
        windowEnd,
        contributingSensors: summarizeContributors(readings),
        readings,
    };
}

export function serializeBatchFile(batch: BatchFile): string {
    return JSON.stringify(batch, null, 2) + '\n';
}
