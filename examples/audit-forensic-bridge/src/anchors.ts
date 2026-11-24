import fs from 'node:fs/promises';
import path from 'node:path';

export interface AnchoredReceipt {
  cid: string;
  contentSha256: string;
  attestedBy?: string;
}

export const DEFAULT_LOG_PATH = path.resolve(process.cwd(), 'anchors.jsonl');

export async function appendAnchor(receipt: AnchoredReceipt, logPath = DEFAULT_LOG_PATH): Promise<void> {
  await fs.appendFile(logPath, `${JSON.stringify(receipt)}\n`, { encoding: 'utf8', mode: 0o600 });
}

export async function readAnchors(logPath = DEFAULT_LOG_PATH): Promise<AnchoredReceipt[]> {
  let contents: string;
  try {
    contents = await fs.readFile(logPath, 'utf8');
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') return [];
    throw error;
  }

  return contents.split(/\r?\n/).filter(Boolean).map((line, index) => {
    let value: unknown;
    try {
      value = JSON.parse(line);
    } catch {
      throw new Error(`Invalid anchor log at line ${index + 1}`);
    }
    if (!value || typeof value !== 'object') throw new Error(`Invalid anchor log at line ${index + 1}`);
    const receipt = value as Record<string, unknown>;
    if (typeof receipt.cid !== 'string' || typeof receipt.contentSha256 !== 'string') {
      throw new Error(`Invalid anchor log at line ${index + 1}`);
    }
    return {
      cid: receipt.cid,
      contentSha256: receipt.contentSha256,
      ...(typeof receipt.attestedBy === 'string' ? { attestedBy: receipt.attestedBy } : {}),
    };
  });
}
