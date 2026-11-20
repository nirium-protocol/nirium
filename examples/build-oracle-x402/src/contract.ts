import {
  Account,
  Contract,
  Keypair,
  StrKey,
  TransactionBuilder,
  nativeToScVal,
  rpc,
  scValToNative,
} from "@stellar/stellar-sdk";

export const TESTNET_PASSPHRASE = "Test SDF Network ; September 2015";
export const DEFAULT_RPC = "https://soroban-testnet.stellar.org";

export interface OnChainReading {
  value: number;
  timestamp: number;
}

export type ReadLatest = () => Promise<OnChainReading>;

export interface ContractOpts {
  contractId: string;
  rpcUrl?: string;
}

function server(rpcUrl?: string): rpc.Server {
  return new rpc.Server(rpcUrl ?? DEFAULT_RPC);
}

/** Free read via simulation; no signature and no fee. */
export function makeReadLatest(opts: ContractOpts): ReadLatest {
  return async () => {
    const srv = server(opts.rpcUrl);
    // Simulation needs a source account; a zero-sequence placeholder works.
    const source = new Account(Keypair.random().publicKey(), "0");
    const tx = new TransactionBuilder(source, { fee: "100", networkPassphrase: TESTNET_PASSPHRASE })
      .addOperation(new Contract(opts.contractId).call("latest"))
      .setTimeout(30)
      .build();
    const sim = await srv.simulateTransaction(tx);
    if (!rpc.Api.isSimulationSuccess(sim) || !sim.result) {
      throw new Error("contract read failed (no value written yet?)");
    }
    const native = scValToNative(sim.result.retval) as { value: bigint | number; timestamp: bigint | number };
    return { value: Number(native.value), timestamp: Number(native.timestamp) };
  };
}

export interface WriteResult {
  hash: string;
  ledger?: number;
}

/**
 * Sign and submit `set(value)` with the given secret. Returns the tx hash once
 * the transaction is final. Throws if the network rejects or the call fails.
 */
export async function writeValue(opts: ContractOpts & { secret: string; value: number }): Promise<WriteResult> {
  const srv = server(opts.rpcUrl);
  const kp = Keypair.fromSecret(opts.secret);
  const account = await srv.getAccount(kp.publicKey());
  const tx = new TransactionBuilder(account, { fee: "100000", networkPassphrase: TESTNET_PASSPHRASE })
    .addOperation(new Contract(opts.contractId).call("set", nativeToScVal(opts.value, { type: "i64" })))
    .setTimeout(60)
    .build();
  // prepareTransaction simulates first: a call the contract would reject
  // (for example a non-oracle signer) fails here with the contract error.
  const prepared = await srv.prepareTransaction(tx);
  prepared.sign(kp);
  const sent = await srv.sendTransaction(prepared);
  if (sent.status === "ERROR") throw new Error(`submit failed: ${JSON.stringify(sent.errorResult)}`);
  const done = await srv.pollTransaction(sent.hash, { attempts: 30 });
  if (done.status !== "SUCCESS") throw new Error(`transaction ${sent.hash} ended with status ${done.status}`);
  return { hash: sent.hash, ledger: done.ledger };
}

export function explorerTx(hash: string): string {
  return `https://stellar.expert/explorer/testnet/tx/${hash}`;
}

export function isValidContractId(id: string): boolean {
  return StrKey.isValidContract(id);
}
