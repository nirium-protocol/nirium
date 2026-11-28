import assert from "node:assert/strict";
import { test } from "node:test";

import { settlementTransactionHash } from "../src/payment-response.js";

const transactionHash = "ab".repeat(32);

test("extracts a settlement hash from the encoded x402 response header", () => {
  const settlement = Buffer.from(JSON.stringify({
    success: true,
    transaction: transactionHash,
  })).toString("base64");
  const response = new Response(null, { headers: { "PAYMENT-RESPONSE": settlement } });
  assert.equal(settlementTransactionHash(response), transactionHash);
});

test("fails explicitly when the paid response has no transaction hash", () => {
  const response = new Response(null, {
    headers: { "PAYMENT-RESPONSE": Buffer.from('{"success":true}').toString("base64") },
  });
  assert.throws(() => settlementTransactionHash(response), /did not contain a Stellar transaction hash/);
});

test("fails explicitly when there is no settlement header", () => {
  assert.throws(
    () => settlementTransactionHash(new Response(null)),
    /no PAYMENT-RESPONSE settlement header/,
  );
});
