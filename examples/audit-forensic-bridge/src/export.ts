import { spawn } from 'node:child_process';
import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import dotenv from 'dotenv';
import { DEFAULT_LOG_PATH, readAnchors, type AnchoredReceipt } from './anchors.js';

dotenv.config();

export interface CliVerification {
  verified: boolean;
  expectedHash?: string;
  hashStatus?: string;
  signatureStatus?: string;
  error?: string;
}

export interface VerifiedAnchorReportItem extends AnchoredReceipt {
  verified: boolean;
  reason?: string;
}

export interface VerifiedAnchorReport {
  totalExported: number;
  verifiedCount: number;
  flaggedCount: number;
  records: VerifiedAnchorReportItem[];
}

/** The published verifier owns IPFS retrieval, record hashing and signature checks. */
export function verifyCid(cid: string): Promise<CliVerification> {
  if (!/^[a-zA-Z0-9]+$/.test(cid)) return Promise.reject(new Error('Invalid CID in anchor log'));

  return new Promise((resolve, reject) => {
    const windows = process.platform === 'win32';
    const command = windows ? (process.env.ComSpec || 'cmd.exe') : 'npx';
    const args = windows
      ? ['/d', '/s', '/c', `npx --yes nirium-cli@latest verify ${cid} --json`]
      : ['--yes', 'nirium-cli@latest', 'verify', cid, '--json'];
    const child = spawn(command, args, { stdio: ['ignore', 'pipe', 'pipe'] });
    let stdout = '';
    let stderr = '';
    child.stdout.setEncoding('utf8').on('data', (chunk: string) => { stdout += chunk; });
    child.stderr.setEncoding('utf8').on('data', (chunk: string) => { stderr += chunk; });
    child.on('error', reject);
    child.on('close', (code) => {
      try {
        const parsed: unknown = JSON.parse(stdout);
        if (!parsed || typeof parsed !== 'object' || typeof (parsed as CliVerification).verified !== 'boolean') {
          throw new Error('Verifier returned an invalid result');
        }
        const result = parsed as CliVerification;
        resolve({ ...result, verified: code === 0 && result.verified });
      } catch {
        reject(new Error(`Verifier failed for CID ${cid}: ${stderr.trim() || 'invalid JSON output'}`));
      }
    });
  });
}

export async function fetchAndVerifyAnchors(options: {
  logPath?: string;
  verify?: (cid: string) => Promise<CliVerification>;
} = {}): Promise<VerifiedAnchorReport> {
  const receipts = await readAnchors(options.logPath ?? DEFAULT_LOG_PATH);
  const verify = options.verify ?? verifyCid;
  const records: VerifiedAnchorReportItem[] = [];

  for (const receipt of receipts) {
    try {
      const result = await verify(receipt.cid);
      const hashMatchesLog = result.expectedHash?.toLowerCase() === receipt.contentSha256.toLowerCase();
      const verified = result.verified && hashMatchesLog;
      records.push({
        ...receipt,
        verified,
        ...(!verified ? {
          reason: result.expectedHash && !hashMatchesLog
            ? 'Verified document hash differs from the local anchor log'
            : result.error || `Hash: ${result.hashStatus ?? 'unknown'}; signature: ${result.signatureStatus ?? 'unknown'}`,
        } : {}),
      });
    } catch (error) {
      records.push({ ...receipt, verified: false, reason: error instanceof Error ? error.message : 'Verifier failed' });
    }
  }

  const verifiedCount = records.filter((record) => record.verified).length;
  return { totalExported: records.length, verifiedCount, flaggedCount: records.length - verifiedCount, records };
}

async function run(): Promise<void> {
  const report = await fetchAndVerifyAnchors();
  const outputPath = path.resolve(process.cwd(), 'audit-verified-report.json');
  await fs.writeFile(outputPath, JSON.stringify(report, null, 2), 'utf8');
  console.log(`Verified: ${report.verifiedCount}; failed: ${report.flaggedCount}; total: ${report.totalExported}`);
  for (const record of report.records) {
    console.log(`${record.verified ? 'VERIFIED' : 'FAILED'} ${record.cid}${record.reason ? `: ${record.reason}` : ''}`);
  }
  console.log(`Report written to ${outputPath}`);
  if (report.flaggedCount) process.exitCode = 1;
}

if (process.env.NODE_ENV !== 'test' && process.argv[1] && fileURLToPath(import.meta.url) === path.resolve(process.argv[1])) {
  run().catch((error: unknown) => {
    console.error(error instanceof Error ? error.message : 'Export failed');
    process.exitCode = 1;
  });
}
