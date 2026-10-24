import { Agent } from 'nirium';
import { createHash } from 'node:crypto';
import { verifyAuditAttestation } from './attestation.js';
import dotenv from 'dotenv';
import fs from 'node:fs/promises';
import path from 'node:path';

dotenv.config();

const NIRIUM_API_KEY = process.env.NIRIUM_API_KEY || 'nrm_test_key';
const NIRIUM_BASE_URL = process.env.NIRIUM_BASE_URL || 'http://localhost:3002';
const IPFS_GATEWAY = process.env.IPFS_GATEWAY || 'https://ipfs.io/ipfs/';

const agent = new Agent({
  apiKey: NIRIUM_API_KEY,
  baseUrl: NIRIUM_BASE_URL,
});

export interface VerifiedAnchorReportItem {
  cid: string;
  contentSha256: string;
  verified: boolean;
  tamperDetected: boolean;
  signatureValid?: boolean;
  attestedBy?: string;
  reason?: string;
}

export async function fetchAndVerifyAnchors(options?: { from?: string; to?: string }): Promise<{
  totalExported: number;
  verifiedCount: number;
  flaggedCount: number;
  records: VerifiedAnchorReportItem[];
}> {
  const exportData = await agent.getReportingExport('anchors', options);
  const rows = (exportData.rows || exportData.anchors || []) as Array<any>;

  const records: VerifiedAnchorReportItem[] = [];

  for (const row of rows) {
    const cid = row.cid;
    const claimedSha = row.contentSha256 || row.hash;
    const gatewayUrl = `${IPFS_GATEWAY.replace(/\/$/, '')}/${cid}`;

    try {
      const response = await fetch(gatewayUrl, { signal: AbortSignal.timeout(10000) });
      if (!response.ok) {
        records.push({
          cid,
          contentSha256: claimedSha,
          verified: false,
          tamperDetected: false,
          reason: `Gateway returned ${response.status}`,
        });
        continue;
      }

      const rawText = await response.text();
      const actualSha = createHash('sha256').update(rawText, 'utf8').digest('hex');

      if (actualSha !== claimedSha) {
        records.push({
          cid,
          contentSha256: claimedSha,
          verified: false,
          tamperDetected: true,
          reason: `SHA256 mismatch: claimed ${claimedSha} vs fetched ${actualSha}`,
        });
        continue;
      }

      let signatureValid: boolean | undefined = undefined;
      if (row.attestedBy && row.signature) {
        const parsedRecord = JSON.parse(rawText);
        signatureValid = verifyAuditAttestation(parsedRecord, row.attestedBy, row.signature);
      }

      records.push({
        cid,
        contentSha256: actualSha,
        verified: signatureValid !== false,
        tamperDetected: false,
        signatureValid,
        attestedBy: row.attestedBy,
      });
    } catch (err: any) {
      records.push({
        cid,
        contentSha256: claimedSha,
        verified: false,
        tamperDetected: false,
        reason: err.message || 'Fetch failed',
      });
    }
  }

  const verifiedCount = records.filter(r => r.verified).length;
  const flaggedCount = records.length - verifiedCount;

  return {
    totalExported: records.length,
    verifiedCount,
    flaggedCount,
    records,
  };
}

async function run() {
  console.log('[Forensic Audit] Generating verified export...');
  const report = await fetchAndVerifyAnchors();
  const outputPath = path.resolve(process.cwd(), 'audit-verified-report.json');
  await fs.writeFile(outputPath, JSON.stringify(report, null, 2), 'utf8');
  console.log(`[Forensic Audit] Report written to ${outputPath}`);
  console.log(`[Forensic Audit] Verified: ${report.verifiedCount} / ${report.totalExported}`);
}

if (process.env.NODE_ENV !== 'test') {
  run().catch(console.error);
}