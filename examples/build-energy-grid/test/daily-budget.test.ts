import assert from "node:assert/strict";
import { test } from "node:test";
import {
  Address,
  authorizeEntry,
  hash,
  Keypair,
  Networks,
  nativeToScVal,
  xdr,
} from "@stellar/stellar-sdk";
import { createPolicyGatedSigner, X402PolicyError } from "nirium/dist/x402-policy.js";
import type { X402PolicyContext } from "nirium";

import { DailyBudgetPolicy } from "../src/daily-budget.js";
import { DAILY_BUDGET } from "../src/market-model.js";

const asset = "CBIELTK6YBZJU5UP2WWQEUCYKLPU6AUNZ2BQ4WWFEIE3USCIHMXQDAMA";
const payTo = Keypair.random().publicKey();
const payer = Keypair.random();
const now = Date.UTC(2026, 10, 22, 12, 0, 0);

function context(amount: string, nonce: string): X402PolicyContext {
  return {
    contextVersion: 1,
    url: "http://127.0.0.1:3411/energy/round-1",
    method: "GET",
    requirements: {
      scheme: "exact",
      network: "stellar:testnet",
      asset,
      payTo,
      amount,
      maxTimeoutSeconds: 60,
    },
    authorization: {
      preimageXdr: "",
      preimageType: "legacy",
      payloadHash: `payload-${nonce}`,
      networkPassphrase: Networks.TESTNET,
      nonce,
      signatureExpirationLedger: 100,
      contractId: asset,
      functionName: "transfer",
      from: payer.publicKey(),
      to: payTo,
      amount,
    },
    signer: payer.publicKey(),
    contextHash: `context-${nonce}`,
  };
}

function transferEntry(amount: string, nonce: bigint) {
  return new xdr.SorobanAuthorizationEntry({
    credentials: xdr.SorobanCredentials.sorobanCredentialsAddress(
      new xdr.SorobanAddressCredentials({
        address: new Address(payer.publicKey()).toScAddress(),
        nonce: xdr.Int64.fromString(nonce.toString()),
        signatureExpirationLedger: 100,
        signature: xdr.ScVal.scvVoid(),
      }),
    ),
    rootInvocation: new xdr.SorobanAuthorizedInvocation({
      function: xdr.SorobanAuthorizedFunction.sorobanAuthorizedFunctionTypeContractFn(
        new xdr.InvokeContractArgs({
          contractAddress: new Address(asset).toScAddress(),
          functionName: "transfer",
          args: [
            nativeToScVal(payer.publicKey(), { type: "address" }),
            nativeToScVal(payTo, { type: "address" }),
            nativeToScVal(amount, { type: "i128" }),
          ],
        }),
      ),
      subInvocations: [],
    }),
  });
}

test("three allocations fit the daily budget; a fourth is denied without a signature", async () => {
  const policy = new DailyBudgetPolicy(DAILY_BUDGET, new Set([payTo]), () => now);
  const hook = policy.hook();
  assert.equal((await hook.evaluate(context("100000", "one"), { signal: new AbortController().signal })).decision, "ALLOW");
  assert.equal((await hook.evaluate(context("150000", "two"), { signal: new AbortController().signal })).decision, "ALLOW");
  assert.equal((await hook.evaluate(context("100000", "three"), { signal: new AbortController().signal })).decision, "ALLOW");
  assert.equal(policy.spentToday(payer.publicKey()), DAILY_BUDGET);
  assert.equal((await hook.evaluate(context("100000", "four"), { signal: new AbortController().signal })).decision, "DENY");
  assert.equal(policy.spentToday(payer.publicKey()), DAILY_BUDGET);

  let signatures = 0;
  const gated = createPolicyGatedSigner(
    {
      address: payer.publicKey(),
      signAuthEntry: async (preimage) => {
        signatures++;
        const hashBytes = hash(xdr.HashIdPreimage.fromXDR(preimage, "base64").toXDR());
        return {
          signedAuthEntry: payer.sign(hashBytes).toString("base64"),
          signerAddress: payer.publicKey(),
        };
      },
    },
    hook,
    () => ({
      url: "http://127.0.0.1:3411/energy/round-4",
      method: "GET",
      requirements: {
        scheme: "exact",
        network: "stellar:testnet",
        asset,
        payTo,
        amount: "100000",
        maxTimeoutSeconds: 60,
      },
    }),
  );

  await assert.rejects(
    authorizeEntry(transferEntry("100000", 4n), async (preimage) => {
      const result = await gated.signAuthEntry(preimage.toXDR("base64"), { address: payer.publicKey() });
      return Buffer.from(result.signedAuthEntry, "base64");
    }, 1_000_000, Networks.TESTNET),
    (error: unknown) => error instanceof X402PolicyError && error.outcome === "DENY",
  );
  assert.equal(signatures, 0);
});

test("the policy rejects a producer outside the allowlist", async () => {
  const policy = new DailyBudgetPolicy(DAILY_BUDGET, new Set([payTo]), () => now);
  const ctx = context("100000", "not-ours");
  const changed: X402PolicyContext = {
    ...ctx,
    requirements: { ...ctx.requirements, payTo: Keypair.random().publicKey() },
    authorization: { ...ctx.authorization, to: Keypair.random().publicKey() },
  };
  assert.equal((await policy.hook().evaluate(changed, { signal: new AbortController().signal })).decision, "DENY");
  assert.equal(policy.spentToday(payer.publicKey()), 0n);
});
