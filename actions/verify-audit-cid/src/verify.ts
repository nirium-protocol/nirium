import crypto from 'node:crypto';
import { StrKey } from '@stellar/stellar-sdk';

export type SignatureStatus = 'valid' | 'invalid' | 'absent';

export interface AuditDocument {
  version?: string;
  node?: string;
  content_sha256?: string;
  record?: Record<string, unknown>;
  agent?: {
    id?: string;
    key: string;
    alg?: string;
    statement?: string;
    signature: string;
  };
  network?: string;
  tag?: string;
  anchoredAt?: string;
}

export interface VerifyResult {
  ok: boolean;
  cid?: string;
  gateway?: string;
  url?: string;
  hashMatch: boolean;
  expectedHash: string;
  computedHash: string;
  signatureStatus: SignatureStatus;
  signerKey?: string;
  statement?: string;
  declaredStatement?: string;
  agentId?: string;
  error?: string;
}

export interface FetchAndVerifyOptions {
  gateway?: string;
  gateways?: string[];
  fetchFn?: typeof fetch;
  timeoutMs?: number;
  retries?: number;
}

// Tried in order until one answers. Filebase's dedicated gateway goes first:
// it is not shared with other npm/IPFS consumers, so it does not hit the
// rate limit that ipfs.io and dweb.link apply to their public gateways
// (confirmed live, 6 Nov 2026: 5/5 requests 200 on Filebase, while ipfs.io
// has returned 429 for this CID). ipfs.io and dweb.link stay as fallback
// in case Filebase itself has an outage.
export const DEFAULT_GATEWAYS: readonly string[] = [
  'https://nirium.myfilebase.com/ipfs/',
  'https://ipfs.io/ipfs/',
  'https://dweb.link/ipfs/',
];

export function normalizeGatewayUrl(gatewayUrl: string, cid: string): string {
  const trimmed = gatewayUrl.trim().replace(/\/+$/, '');
  if (!trimmed) {
    throw new Error('Gateway URL must not be empty');
  }
  if (trimmed.endsWith('/ipfs')) {
    return `${trimmed}/${cid}`;
  }
  return `${trimmed}/ipfs/${cid}`;
}

export function decodeStellarPublicKey(gAddress: string): Buffer {
  if (!/^G[A-Z2-7]{55}$/.test(gAddress)) {
    throw new Error(`Invalid Stellar public key format: ${gAddress}`);
  }
  const rawBytes = StrKey.decodeEd25519PublicKey(gAddress);
  return Buffer.from(rawBytes);
}

export function verifyEd25519Signature(pubKeyGAddress: string, statement: string, base64Signature: string): boolean {
  try {
    const rawPubKey = decodeStellarPublicKey(pubKeyGAddress);
    const spkiHeader = Buffer.from('302a300506032b6570032100', 'hex');
    const keyObject = crypto.createPublicKey({
      key: Buffer.concat([spkiHeader, rawPubKey]),
      format: 'der',
      type: 'spki',
    });

    const signatureBuf = Buffer.from(base64Signature, 'base64');
    return crypto.verify(null, Buffer.from(statement), keyObject, signatureBuf);
  } catch {
    return false;
  }
}

export function computeRecordHash(record: Record<string, unknown> | undefined): string {
  const recordStr = record ? JSON.stringify(record) : '';
  return crypto.createHash('sha256').update(recordStr).digest('hex');
}

export function verifyAuditDocument(doc: AuditDocument, cid?: string): VerifyResult {
  if (!doc || typeof doc !== 'object') {
    return {
      ok: false,
      cid,
      hashMatch: false,
      expectedHash: '',
      computedHash: '',
      signatureStatus: 'absent',
      error: 'Invalid audit document format',
    };
  }

  const expectedHash = doc.content_sha256 || '';
  const computedHash = computeRecordHash(doc.record);
  const hashMatch = expectedHash.length > 0 && expectedHash === computedHash;

  let signatureStatus: SignatureStatus = 'absent';
  let signerKey: string | undefined;
  let statement: string | undefined;
  let declaredStatement: string | undefined;
  let agentId: string | undefined;

  if (doc.agent && doc.agent.key && doc.agent.signature) {
    signerKey = doc.agent.key;
    agentId = doc.agent.id;
    statement = `nirium-audit-v1:${computedHash}`;
    declaredStatement = doc.agent.statement;

    const isValidSig = verifyEd25519Signature(signerKey, statement, doc.agent.signature);
    signatureStatus = isValidSig ? 'valid' : 'invalid';
  }

  const ok = hashMatch && signatureStatus !== 'invalid';

  return {
    ok,
    cid,
    hashMatch,
    expectedHash,
    computedHash,
    signatureStatus,
    signerKey,
    statement,
    declaredStatement,
    agentId,
  };
}

async function fetchJsonWithTimeout(
  url: string,
  fetchFn: typeof fetch,
  timeoutMs: number,
): Promise<AuditDocument> {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const res = await fetchFn(url, {
      signal: controller.signal,
      headers: {
        accept: 'application/json',
      },
    });
    if (!res.ok) {
      throw new Error(`IPFS gateway returned HTTP ${res.status}`);
    }
    return (await res.json()) as AuditDocument;
  } finally {
    clearTimeout(timeout);
  }
}

export async function fetchAndVerifyCid(
  cid: string,
  options: FetchAndVerifyOptions = {},
): Promise<VerifyResult> {
  const gateways =
    options.gateways && options.gateways.length > 0
      ? options.gateways
      : options.gateway
        ? [options.gateway]
        : DEFAULT_GATEWAYS;

  const fetchFn = options.fetchFn || globalThis.fetch;
  const timeoutMs = options.timeoutMs ?? 15_000;
  const retries = options.retries ?? 1;

  let lastError = '';
  let lastGateway = gateways[0] ?? '';
  let lastUrl = '';

  for (const gw of gateways) {
    let url = '';
    try {
      url = normalizeGatewayUrl(gw, cid);
    } catch (err: unknown) {
      lastError = err instanceof Error ? err.message : String(err);
      lastGateway = gw;
      continue;
    }
    lastGateway = gw;
    lastUrl = url;

    for (let attempt = 0; attempt <= retries; attempt += 1) {
      try {
        const doc = await fetchJsonWithTimeout(url, fetchFn, timeoutMs);
        return {
          ...verifyAuditDocument(doc, cid),
          gateway: gw,
          url,
        };
      } catch (err: unknown) {
        lastError = err instanceof Error ? err.message : String(err);
      }
    }
  }

  return {
    ok: false,
    cid,
    gateway: lastGateway,
    url: lastUrl,
    hashMatch: false,
    expectedHash: '',
    computedHash: '',
    signatureStatus: 'absent',
    error: `Failed to fetch CID from gateway: ${lastError}`,
  };
}
