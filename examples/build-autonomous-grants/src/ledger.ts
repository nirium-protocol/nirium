import { Horizon, Networks, Transaction } from '@stellar/stellar-sdk';

export const HORIZON_TESTNET = 'https://horizon-testnet.stellar.org';
export const PASSPHRASE = Networks.TESTNET;

/** What the example needs from the chain. Tests replace it; nothing else touches the network. */
export interface DaoState {
  accountId: string;
  sequence: string;
  signers: { key: string; weight: number }[];
  /** Threshold for medium operations (payments). */
  medThreshold: number;
}

export interface Ledger {
  loadDao(accountId: string): Promise<DaoState>;
  /** Submit a fully signed transaction; resolves with its hash and ledger. */
  submit(tx: Transaction): Promise<{ hash: string; ledger: number }>;
}

export function horizonLedger(url = HORIZON_TESTNET): Ledger {
  const server = new Horizon.Server(url);
  return {
    async loadDao(accountId) {
      const a = await server.loadAccount(accountId);
      return {
        accountId: a.accountId(),
        sequence: a.sequence,
        signers: a.signers.filter((s) => s.type === 'ed25519_public_key').map((s) => ({ key: s.key, weight: s.weight })),
        medThreshold: a.thresholds.med_threshold,
      };
    },
    async submit(tx) {
      const r = await server.submitTransaction(tx);
      return { hash: r.hash, ledger: r.ledger };
    },
  };
}

export function explorerTx(hash: string): string {
  return `https://stellar.expert/explorer/testnet/tx/${hash}`;
}
