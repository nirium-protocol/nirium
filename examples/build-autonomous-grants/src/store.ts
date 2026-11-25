import { chmodSync, existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import type { Proposal } from './agent.js';

export interface DaoInfo {
  dao: string;
  grantee: string;
  signers: string[];
  setupTx: string;
}

/** Local files only. `.keys/` holds the demo signers' secrets (git-ignored); `.grants/` holds proposals. */
export class Store {
  constructor(readonly keysDir = '.keys', readonly grantsDir = '.grants') {
    mkdirSync(join(grantsDir, 'proposals'), { recursive: true });
  }

  saveDao(info: DaoInfo, secrets: { n: number; secret: string }[]): void {
    mkdirSync(this.keysDir, { recursive: true });
    writeFileSync(join(this.keysDir, 'dao.json'), JSON.stringify(info, null, 2) + '\n');
    for (const s of secrets) {
      const p = join(this.keysDir, `signer-${s.n}.secret`);
      writeFileSync(p, s.secret + '\n', { mode: 0o600 });
      try { chmodSync(p, 0o600); } catch { /* best effort on Windows */ }
    }
  }

  dao(): DaoInfo {
    const p = join(this.keysDir, 'dao.json');
    if (!existsSync(p)) throw new Error('no DAO yet: run `npm run setup` first');
    return JSON.parse(readFileSync(p, 'utf8')) as DaoInfo;
  }

  signerSecret(n: number): string {
    if (!Number.isInteger(n) || n < 1 || n > 3) throw new Error('signer must be 1, 2 or 3');
    return readFileSync(join(this.keysDir, `signer-${n}.secret`), 'utf8').trim();
  }

  private path(id: string): string {
    if (!/^[0-9a-f]{8}$/.test(id)) throw new Error(`invalid proposal id: ${id}`);
    return join(this.grantsDir, 'proposals', `${id}.json`);
  }

  saveProposal(p: Proposal): void {
    writeFileSync(this.path(p.id), JSON.stringify(p, null, 2) + '\n');
  }

  loadProposal(id: string): Proposal {
    const p = this.path(id);
    if (!existsSync(p)) throw new Error(`no proposal ${id}`);
    return JSON.parse(readFileSync(p, 'utf8')) as Proposal;
  }
}
