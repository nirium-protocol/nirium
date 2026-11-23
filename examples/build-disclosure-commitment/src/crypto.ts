import { createHash, randomBytes } from 'node:crypto';

/**
 * Computes SHA-256 hex digest of a UTF-8 string or Buffer.
 */
export function sha256Hex(data: string | Buffer): string {
  return createHash('sha256').update(data).digest('hex');
}

/**
 * Generates a cryptographically secure random salt (hex string, default 32 bytes = 64 hex chars).
 * Salt prevents dictionary pre-computation attacks against brief or standardized reports.
 */
export function generateSalt(bytes = 32): string {
  return randomBytes(bytes).toString('hex');
}

/**
 * Computes the SHA-256 hash of the report content.
 */
export function hashReport(content: string): string {
  return sha256Hex(content);
}

/**
 * Computes the commitment hash: SHA-256 of canonical `reportSha256:salt`.
 * This is the ONLY string anchored to the public IPFS audit trail.
 */
export function computeCommitmentHash(reportSha256: string, salt: string): string {
  return sha256Hex(`${reportSha256}:${salt}`);
}

/**
 * Audit statement required by Nirium v1 specification for agent signature verification.
 */
export function statementFor(sha256: string): string {
  return `nirium-audit-v1:${sha256}`;
}
