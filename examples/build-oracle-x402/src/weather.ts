// Data source: Open-Meteo (https://open-meteo.com), free, no API key,
// data licensed CC BY 4.0. Credited in the README.
export const DEFAULT_LAT = 6.5244; // Lagos
export const DEFAULT_LON = 3.3792;
export const SOURCE_NAME = "Open-Meteo";
export const SOURCE_URL = "https://open-meteo.com/";

export interface WeatherReading {
  /** Temperature in degrees Celsius as reported by the API. */
  celsius: number;
  /** Observation time reported by the API (ISO 8601, UTC). */
  observedAt: string;
}

export function weatherUrl(lat = DEFAULT_LAT, lon = DEFAULT_LON): string {
  const u = new URL("https://api.open-meteo.com/v1/forecast");
  u.searchParams.set("latitude", String(lat));
  u.searchParams.set("longitude", String(lon));
  u.searchParams.set("current", "temperature_2m");
  u.searchParams.set("timezone", "UTC");
  return u.toString();
}

/** Validates the Open-Meteo response; throws on anything unexpected. */
export function parseWeather(json: unknown): WeatherReading {
  const cur = (json as { current?: { temperature_2m?: unknown; time?: unknown } } | null)?.current;
  const t = cur?.temperature_2m;
  const time = cur?.time;
  if (typeof t !== "number" || !Number.isFinite(t) || typeof time !== "string") {
    throw new Error("unexpected weather response shape");
  }
  if (t < -100 || t > 70) throw new Error(`implausible temperature ${t}`);
  return { celsius: t, observedAt: time };
}

export async function fetchWeather(
  fetchImpl: typeof fetch = fetch,
  lat = DEFAULT_LAT,
  lon = DEFAULT_LON,
): Promise<WeatherReading> {
  const res = await fetchImpl(weatherUrl(lat, lon));
  if (!res.ok) throw new Error(`weather API HTTP ${res.status}`);
  return parseWeather(await res.json());
}

/** On-chain fixed point: hundredths of a degree (18.53 C -> 1853). */
export function toFixed(celsius: number): number {
  return Math.round(celsius * 100);
}

export function fromFixed(value: number | bigint): number {
  return Number(value) / 100;
}
