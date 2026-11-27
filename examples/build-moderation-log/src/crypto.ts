import { createHash, randomBytes } from "node:crypto";
import { Keypair } from "@stellar/stellar-sdk";

/**
 * Deterministically sorts object keys for canonical JSON serialization.
 */
export function canonicalJson(obj: unknown): string {
  if (obj === null || typeof obj !== "object") {
    return JSON.stringify(obj);
  }
  if (Array.isArray(obj)) {
    return "[" + obj.map(canonicalJson).join(",") + "]";
  }
  const keys = Object.keys(obj as Record<string, unknown>).sort();
  const entries = keys.map(
    (key) =>
      `${JSON.stringify(key)}:${canonicalJson((obj as Record<string, unknown>)[key])}`,
  );
  return "{" + entries.join(",") + "}";
}

/**
 * Computes SHA-256 hash formatted as lowercase hex string.
 */
export function sha256Hex(data: string | Buffer): string {
  return createHash("sha256").update(data).digest("hex");
}

/**
 * Generates a random cryptographic salt (hex).
 */
export function generateSalt(bytes = 32): string {
  return randomBytes(bytes).toString("hex");
}

/**
 * Hashes PII (user IDs, message content) using SHA-256 with a secret salt.
 * Guarantees zero plaintext personal data is anchored on IPFS / public networks.
 */
export function hashWithSalt(value: string, salt: string): string {
  return createHash("sha256")
    .update(salt)
    .update(":")
    .update(value)
    .digest("hex");
}

/**
 * Formats canonical audit statement required by Nirium protocol.
 */
export function statementFor(sha256: string): string {
  return `nirium-audit-v1:${sha256}`;
}

/**
 * Signs the Nirium audit statement with a Stellar Keypair.
 */
export function signAuditStatement(
  statement: string,
  keypair: Keypair,
): { key: string; signature: string } {
  const statementBuffer = Buffer.from(statement, "utf-8");
  const signatureBuffer = keypair.sign(statementBuffer);
  return {
    key: keypair.publicKey(),
    signature: signatureBuffer.toString("base64"),
  };
}

/**
 * Verifies a Stellar signature over an audit statement.
 */
export function verifyAuditSignature(
  statement: string,
  publicKey: string,
  signatureBase64: string,
): boolean {
  try {
    const keypair = Keypair.fromPublicKey(publicKey);
    return keypair.verify(
      Buffer.from(statement, "utf-8"),
      Buffer.from(signatureBase64, "base64"),
    );
  } catch {
    return false;
  }
}
