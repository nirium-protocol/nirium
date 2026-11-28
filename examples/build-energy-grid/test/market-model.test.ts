import assert from "node:assert/strict";
import { test } from "node:test";

import {
  cheapestOffer,
  offersForRound,
  priceInUsdcUnits,
  PRODUCER_DEFAULTS,
} from "../src/market-model.js";

test("the cheapest offer changes producer across market rounds", () => {
  const producers = PRODUCER_DEFAULTS.map((producer) => ({
    ...producer,
    port: producer.port,
    prices: producer.prices,
  }));
  assert.equal(cheapestOffer(offersForRound(producers, 1)).producerId, "solar-east");
  assert.equal(cheapestOffer(offersForRound(producers, 2)).producerId, "solar-west");
  assert.equal(cheapestOffer(offersForRound(producers, 3)).producerId, "solar-west");
});

test("USDC price comparison uses exact seven-decimal base units", () => {
  assert.equal(priceInUsdcUnits("$0.01"), 100_000n);
  assert.equal(priceInUsdcUnits("$0.015"), 150_000n);
  assert.throws(() => priceInUsdcUnits("$0.00000001"), /Invalid USDC price/);
});

test("equal prices have a deterministic producer tie-break", () => {
  const offers = offersForRound(
    [
      { id: "solar-west", name: "West", port: 3412, prices: ["$0.01"] },
      { id: "solar-east", name: "East", port: 3411, prices: ["$0.01"] },
    ],
    1,
  );
  assert.equal(cheapestOffer(offers).producerId, "solar-east");
});
