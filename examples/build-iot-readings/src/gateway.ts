import { Keypair } from '@stellar/stellar-sdk';
import { Agent as NiriumAgent, type AgentAttestationInput, type AuditAnchor } from 'nirium';
import { buildBatchFile, statementFor } from './batch.js';
import { verifySensorReading, type SignedSensorReading } from './sensor.js';
import type { BatchReceipt, BatchStore } from './store.js';

export interface Anchorer {
    anchor(sha256: string, agent: AgentAttestationInput, tag: string): Promise<AuditAnchor>;
}

/**
 * Anchors through the published SDK: only `hash`, `tag`, and the gateway's
 * ed25519 attestation are sent to POST /api/audit/log.
 */
export function niriumAnchorer(baseUrl: string, apiKey = ''): Anchorer {
    const client = new NiriumAgent({ apiKey, baseUrl: baseUrl.replace(/\/$/, '') });
    return {
        anchor: (hash, agent, tag) => client.anchorAuditRecord({ hash, tag, agent }),
    };
}

export function attestBatch(
    sha256: string,
    gatewayKeypair: Keypair,
    id = 'iot-gateway',
): AgentAttestationInput {
    return {
        key: gatewayKeypair.publicKey(),
        signature: gatewayKeypair.sign(Buffer.from(statementFor(sha256), 'utf8')).toString('base64'),
        id,
    };
}

export interface AnchorBatchOptions {
    batchId: string;
    readings: SignedSensorReading[];
    windowStart: string;
    windowEnd: string;
    store: BatchStore;
    anchorer: Anchorer;
    gatewayKeypair: Keypair;
    tag: string;
    gatewayId?: string;
}

/**
 * Verify all incoming sensor readings, write one local batch file containing the
 * readings and contributing sensors manifest, and anchor ONE hash-only Audit Trail
 * receipt signed with the gateway's Stellar testnet key.
 */
export async function collectAndAnchorBatch(opts: AnchorBatchOptions): Promise<BatchReceipt> {
    if (!opts.tag.startsWith('wave11-')) {
        throw new Error(`Audit tag must start with "wave11-", got "${opts.tag}"`);
    }

    for (const entry of opts.readings) {
        const check = verifySensorReading(entry);
        if (!check.valid) {
            throw new Error(
                `Refusing to batch invalid reading ${check.readingId} (${check.sensorId}): ${check.reason}`,
            );
        }
    }

    const batch = buildBatchFile(opts.batchId, opts.readings, opts.windowStart, opts.windowEnd);
    const { path, sha256 } = opts.store.saveBatch(batch);

    const attestation = attestBatch(sha256, opts.gatewayKeypair, opts.gatewayId ?? 'iot-gateway');
    const anchored = await opts.anchorer.anchor(sha256, attestation, opts.tag);

    const nodeSha = String(
        anchored.contentSha256 ?? (anchored as Record<string, unknown>).content_sha256 ?? '',
    ).toLowerCase();
    if (nodeSha !== sha256) {
        throw new Error(`Node anchored ${nodeSha || 'nothing'}, expected ${sha256}`);
    }
    if (anchored.attestedBy && anchored.attestedBy !== opts.gatewayKeypair.publicKey()) {
        throw new Error(`Node attested ${anchored.attestedBy}, expected ${opts.gatewayKeypair.publicKey()}`);
    }

    const receipt: BatchReceipt = {
        batchId: batch.batchId,
        batchFile: path,
        sha256,
        cid: anchored.cid,
        anchoredAt: anchored.anchoredAt,
        ...(anchored.attestedBy ? { attestedBy: anchored.attestedBy } : {}),
        tag: opts.tag,
        readingCount: batch.readings.length,
        contributingSensors: batch.contributingSensors,
    };

    opts.store.addReceipt(receipt);
    return receipt;
}
