import { createHash } from 'node:crypto';
import { spawnSync } from 'node:child_process';
import { createRequire } from 'node:module';
import { dirname, join } from 'node:path';
import type { Keypair } from '@stellar/stellar-sdk';
import { Agent } from 'nirium';

export const TESTNET_NODE = 'https://nirium-agent.fly.dev';
const AGENT_ID = 'correction-receipt-example';

export const sha256 = (data: string | Buffer): string => createHash('sha256').update(data).digest('hex');

/** What a verifier reports about one CID and one expected hash. */
export interface Verified { ok: boolean; signer: string | null }
export type Verifier = (cid: string, hash: string) => Verified;
export type Anchorer = (hash: string, tag: string, keypair: Keypair) => Promise<string>;

/** Anchors a hash, signed with the caller's own key, through the published SDK. Only the hash leaves the machine. */
export const anchorHash: Anchorer = async (hash, tag, keypair) => {
    const agent = new Agent({ apiKey: '', baseUrl: process.env.NIRIUM_AUDIT_URL ?? TESTNET_NODE });
    // stellar-sdk 17 returns a Uint8Array: wrap it, or toString('base64') gives a wrong value with no error.
    const signature = Buffer.from(keypair.sign(Buffer.from(`nirium-audit-v1:${hash}`, 'utf8'))).toString('base64');
    const { cid } = await agent.anchorAuditRecord({ hash, tag, agent: { id: AGENT_ID, key: keypair.publicKey(), signature } });
    return cid;
};

/** Runs the published `nirium-cli verify`; there is no verifier of our own here. */
export const cliVerify: Verifier = (cid, hash) => {
    const bin = join(dirname(createRequire(import.meta.url).resolve('nirium-cli/package.json')), 'bin', 'nirium.js');
    const res = spawnSync(process.execPath, [bin, 'verify', cid, '--hash', hash, '--require-signature', '--json'], { encoding: 'utf8', timeout: 60_000 });
    try {
        const out = JSON.parse(res.stdout) as { ok?: boolean; hashMatch?: boolean; signatureStatus?: string; signerKey?: string };
        const ok = res.status === 0 && out.ok === true && out.hashMatch === true && out.signatureStatus === 'valid';
        return { ok, signer: out.signerKey ?? null };
    } catch {
        return { ok: false, signer: null };
    }
};
