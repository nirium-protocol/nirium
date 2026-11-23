/**
 * Structure of a disclosure commitment stored locally after anchoring on Nirium.
 */
export interface CommitmentRecord {
  /** Unique commitment identifier (e.g. cmt-a1b2c3d4) */
  id: string;
  /** Name or relative path of the committed report */
  reportName: string;
  /** SHA-256 hash of the raw report content */
  reportSha256: string;
  /** Cryptographic random salt (hex) to prevent dictionary guessing of report content */
  salt: string;
  /** SHA-256 hash of the combined commitment payload: sha256(reportSha256 + ":" + salt) */
  commitmentSha256: string;
  /** IPFS Content Identifier returned by Nirium Audit Trail */
  cid: string;
  /** Timestamp when Nirium node anchored the record */
  anchoredAt: string;
  /** Tag used for the anchor (must start with wave11-) */
  tag: string;
  /** Stellar public key that signed the commitment statement */
  attestedBy: string;
}

export interface RevealResult {
  id: string;
  reportName: string;
  cid: string;
  anchoredCommitmentSha256: string;
  recomputedCommitmentSha256: string;
  ok: boolean;
  tampered: boolean;
  verifyOutput: string;
  message: string;
}
