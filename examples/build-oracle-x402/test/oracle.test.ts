/**
 * Offline tests: no test touches the network. `global.fetch` is replaced and
 * only the mock facilitator origin (and the local test server) is answered;
 * anything else throws. The real paid round trip and the on-chain write /
 * negative test are testnet runs documented in the README.
 */
import assert from "node:assert/strict";
import test from "node:test";
import type { AddressInfo } from "node:net";

import { checkAgainstChain, parsePaidAnswer } from "../src/buyer.js";
import { isValidContractId } from "../src/contract.js";
import { createApp, PAID_ROUTE } from "../src/server.js";
import { fetchWeather, fromFixed, parseWeather, toFixed, weatherUrl } from "../src/weather.js";

const MOCK_FACILITATOR = "https://mock-facilitator.test";
const PAY_TO = "GCPKZ7PUCFWMDKCKH37TLTSQKH4GDXRUUKGTSQ2Y4426ZNOANYQVWUTG";
const CONTRACT = "CDLZFC3SYJYDZT7K67VZ75HPJVIEUVNIXF47ZG2FB2RMQQVU2HHGCYSC";

function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), { status, headers: { "Content-Type": "application/json" } });
}

function mockFacilitator(realFetch: typeof fetch): typeof fetch {
  return async (input, init) => {
    const url = new URL(typeof input === "string" ? input : input.toString());
    if (url.hostname === "127.0.0.1" || url.hostname === "localhost") return realFetch(input, init);
    if (url.origin !== MOCK_FACILITATOR) throw new Error(`Unexpected network call to ${url.origin}`);
    if (url.pathname === "/api/x402serve/telemetry") return json({ ok: true });
    if (url.pathname === "/supported") {
      return json({ kinds: [{ x402Version: 2, scheme: "exact", network: "stellar:testnet" }], extensions: [], signers: {} });
    }
    return json({ isValid: false, invalidReason: "no payment in test" });
  };
}

test("weather: parses an Open-Meteo response and rejects bad shapes", () => {
  const ok = parseWeather({ current: { time: "2026-11-20T10:00", temperature_2m: 28.4 } });
  assert.deepEqual(ok, { celsius: 28.4, observedAt: "2026-11-20T10:00" });
  assert.throws(() => parseWeather({}), /shape/);
  assert.throws(() => parseWeather({ current: { time: "x", temperature_2m: "hot" } }), /shape/);
  assert.throws(() => parseWeather({ current: { time: "x", temperature_2m: 900 } }), /implausible/);
});

test("weather: fixed-point round trip keeps hundredths and negatives", () => {
  assert.equal(toFixed(18.53), 1853);
  assert.equal(toFixed(-1.2), -120);
  assert.equal(fromFixed(1853), 18.53);
  assert.equal(fromFixed(BigInt(-120)), -1.2);
});

test("weather: request URL asks for current temperature only, no key", () => {
  const u = new URL(weatherUrl());
  assert.equal(u.origin, "https://api.open-meteo.com");
  assert.equal(u.searchParams.get("current"), "temperature_2m");
  assert.equal([...u.searchParams.keys()].some((k) => /key|token/i.test(k)), false);
});

test("weather: fetchWeather surfaces HTTP errors", async () => {
  await assert.rejects(fetchWeather((async () => json({}, 500)) as typeof fetch), /HTTP 500/);
  const r = await fetchWeather((async () => json({ current: { time: "t", temperature_2m: 20 } })) as typeof fetch);
  assert.equal(r.celsius, 20);
});

test("buyer: paid answer is checked against contract state", () => {
  const paid = { value: 1853, timestamp: 100, celsius: 18.53, contractId: CONTRACT };
  assert.deepEqual(checkAgainstChain(paid, { value: 1853, timestamp: 100 }, CONTRACT), { ok: true, reasons: [] });
  const bad = checkAgainstChain(paid, { value: 1900, timestamp: 101 }, "C" + "A".repeat(55));
  assert.equal(bad.ok, false);
  assert.equal(bad.reasons.length, 3);
});

test("buyer: parsePaidAnswer rejects malformed answers", () => {
  assert.throws(() => parsePaidAnswer(null), /shape/);
  assert.throws(() => parsePaidAnswer({ value: "1" }), /shape/);
});

test("contract id validation", () => {
  assert.equal(isValidContractId(CONTRACT), true);
  assert.equal(isValidContractId(PAY_TO), false);
  assert.equal(isValidContractId("nope"), false);
});

test("unpaid request gets 402 with price and payTo, and never reads the chain or leaks the value", async (t) => {
  const real = global.fetch;
  global.fetch = mockFacilitator(real);
  t.after(() => {
    global.fetch = real;
  });
  let reads = 0;
  const app = createApp({
    payTo: PAY_TO,
    facilitatorApiKey: "test-key",
    facilitatorUrl: MOCK_FACILITATOR,
    contractId: CONTRACT,
    readLatest: async () => {
      reads++;
      return { value: 1853, timestamp: 1 };
    },
  });
  const server = app.listen(0);
  await new Promise<void>((r) => server.once("listening", r));
  t.after(() => server.close());
  const base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;

  const res = await fetch(`${base}${PAID_ROUTE}`);
  assert.equal(res.status, 402);
  const header = res.headers.get("payment-required");
  assert.ok(header, "expected payment-required header");
  const req = JSON.parse(Buffer.from(header, "base64").toString("utf8")) as { accepts: Array<Record<string, unknown>> };
  const accepted = req.accepts[0]!;
  assert.equal(accepted.network, "stellar:testnet");
  assert.equal(accepted.payTo, PAY_TO);
  assert.equal(accepted.amount, "100000"); // $0.01 in 7-decimal USDC units
  const body = (await res.json().catch(() => ({}))) as { value?: unknown };
  assert.equal(body.value, undefined);
  assert.equal(reads, 0);

  const bogus = Buffer.from(JSON.stringify({ x402Version: 2, scheme: "exact", network: "stellar:testnet", payload: {} })).toString("base64");
  const res2 = await fetch(`${base}${PAID_ROUTE}`, { headers: { "PAYMENT-SIGNATURE": bogus } });
  assert.equal(res2.status, 402);
  assert.equal(reads, 0);
});

test("health route is free", async (t) => {
  const real = global.fetch;
  global.fetch = mockFacilitator(real);
  t.after(() => {
    global.fetch = real;
  });
  const app = createApp({
    payTo: PAY_TO,
    facilitatorApiKey: "test-key",
    facilitatorUrl: MOCK_FACILITATOR,
    contractId: CONTRACT,
    readLatest: async () => ({ value: 0, timestamp: 0 }),
  });
  const server = app.listen(0);
  await new Promise<void>((r) => server.once("listening", r));
  t.after(() => server.close());
  const res = await fetch(`http://127.0.0.1:${(server.address() as AddressInfo).port}/health`);
  assert.equal(res.status, 200);
});

test("x402Serve still rejects a non-Stellar payTo", () => {
  assert.throws(
    () =>
      createApp({
        payTo: "nope",
        facilitatorApiKey: "k",
        facilitatorUrl: MOCK_FACILITATOR,
        contractId: CONTRACT,
        readLatest: async () => ({ value: 0, timestamp: 0 }),
      }),
    /payTo/,
  );
});
