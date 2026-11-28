export interface EnergyOffer {
  producerId: string;
  producerName: string;
  baseUrl: string;
  route: string;
  round: number;
  price: string;
}

export interface ProducerConfig {
  id: string;
  name: string;
  port: number;
  secret: string;
  prices: readonly string[];
}

export const ROUND_COUNT = 4;
export const DAILY_BUDGET = 350_000n;
export const MAX_PAYMENT = "$0.05";

export const PRODUCER_DEFAULTS = [
  {
    id: "solar-east",
    name: "East Ridge Solar",
    port: 3411,
    envName: "SOLAR_EAST_SECRET",
    prices: ["$0.01", "$0.03", "$0.02", "$0.01"],
  },
  {
    id: "solar-west",
    name: "West Field Solar",
    port: 3412,
    envName: "SOLAR_WEST_SECRET",
    prices: ["$0.02", "$0.015", "$0.01", "$0.01"],
  },
] as const;

export function priceInUsdcUnits(price: string): bigint {
  const match = /^\$(\d+)(?:\.(\d{1,7}))?$/.exec(price);
  if (!match) throw new Error(`Invalid USDC price: ${price}`);
  const whole = BigInt(match[1]);
  const fraction = BigInt((match[2] ?? "").padEnd(7, "0"));
  return whole * 10_000_000n + fraction;
}

export function offersForRound(
  producers: readonly Pick<ProducerConfig, "id" | "name" | "port" | "prices">[],
  round: number,
): EnergyOffer[] {
  if (!Number.isInteger(round) || round < 1) throw new Error("round must be a positive integer");
  return producers.map((producer) => {
    const price = producer.prices[round - 1];
    if (!price) throw new Error(`No price configured for ${producer.id}, round ${round}`);
    return {
      producerId: producer.id,
      producerName: producer.name,
      baseUrl: `http://127.0.0.1:${producer.port}`,
      route: `/energy/round-${round}`,
      round,
      price,
    };
  });
}

export function cheapestOffer(offers: readonly EnergyOffer[]): EnergyOffer {
  if (offers.length === 0) throw new Error("Cannot select from an empty offer list");
  return [...offers].sort((a, b) => {
    const priceDifference = priceInUsdcUnits(a.price) - priceInUsdcUnits(b.price);
    if (priceDifference !== 0n) return priceDifference < 0n ? -1 : 1;
    return a.producerId.localeCompare(b.producerId);
  })[0];
}
