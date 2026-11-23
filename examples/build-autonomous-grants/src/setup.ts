import { BASE_FEE, Horizon, Keypair, Operation, TransactionBuilder } from '@stellar/stellar-sdk';
import { HORIZON_TESTNET, PASSPHRASE } from './ledger.js';

export interface DaoSetup {
  dao: string;
  grantee: string;
  signers: { n: number; publicKey: string; secret: string }[];
  setupTx: string;
}

async function friendbot(publicKey: string): Promise<void> {
  const r = await fetch(`https://friendbot.stellar.org/?addr=${encodeURIComponent(publicKey)}`);
  if (!r.ok) throw new Error(`friendbot HTTP ${r.status}`);
}

/**
 * Create a DAO account whose only way to authorise anything is 2 of 3 signers.
 * All keys are fresh and yours. The DAO account's own master key is used once,
 * here, to add the signers, set every threshold to 2 and drop its own weight to 0;
 * it is never stored, and after this transaction it can no longer sign anything.
 */
export async function createDao(): Promise<DaoSetup> {
  const master = Keypair.random();
  const grantee = Keypair.random(); // only receives; its secret is discarded
  const signers = [1, 2, 3].map((n) => {
    const kp = Keypair.random();
    return { n, publicKey: kp.publicKey(), secret: kp.secret() };
  });
  await friendbot(master.publicKey());
  await friendbot(grantee.publicKey());

  const server = new Horizon.Server(HORIZON_TESTNET);
  const account = await server.loadAccount(master.publicKey());
  const b = new TransactionBuilder(account, { fee: BASE_FEE, networkPassphrase: PASSPHRASE });
  for (const s of signers) b.addOperation(Operation.setOptions({ signer: { ed25519PublicKey: s.publicKey, weight: 1 } }));
  b.addOperation(Operation.setOptions({ masterWeight: 0, lowThreshold: 2, medThreshold: 2, highThreshold: 2 }));
  const tx = b.setTimeout(60).build();
  tx.sign(master);
  const res = await server.submitTransaction(tx);
  return { dao: master.publicKey(), grantee: grantee.publicKey(), signers, setupTx: res.hash };
}
