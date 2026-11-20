import { mulberry32, Sensor } from './sensor.js';
import type { Gateway } from './gateway.js';
import type { LocalStore } from './store.js';

export const SENSOR_SPECS = [
  { id: 'temp-a', metric: 'temperature', unit: 'C', base: 24, spread: 3 },
  { id: 'humid-b', metric: 'humidity', unit: '%', base: 62, spread: 8 },
  { id: 'temp-c', metric: 'temperature', unit: 'C', base: 21, spread: 2 },
] as const;

/** Load (or create) the simulated sensors, each with its own ed25519 key, and pin their public keys. */
export function loadSensors(store: LocalStore): Sensor[] {
  const state = store.simState();
  const sensors = SENSOR_SPECS.map((spec) => {
    const saved = state.find((s) => s.id === spec.id);
    const sensor = new Sensor(spec.id, spec.metric, spec.unit, saved?.seedHex);
    if (saved) sensor.setSeq(saved.seq);
    store.register(sensor.id, sensor.publicKeyHex);
    return sensor;
  });
  return sensors;
}

export function saveSensors(store: LocalStore, sensors: Sensor[], seqs: Map<string, number>): void {
  store.saveSimState(sensors.map((s) => ({ id: s.id, seedHex: s.seedHex(), seq: seqs.get(s.id) ?? 0 })));
}

/**
 * Feed one window of simulated time (one reading per sensor per minute) into the gateway.
 * Returns each sensor's next sequence number.
 */
export function simulateWindow(
  sensors: Sensor[], gateway: Gateway, windowStart: Date, intervalMin: number, seed: number,
  seqStart: Map<string, number>,
): Map<string, number> {
  const rnd = mulberry32(seed);
  const next = new Map(seqStart);
  for (let m = 0; m < intervalMin; m++) {
    const ts = new Date(windowStart.getTime() + m * 60_000);
    for (const s of sensors) {
      const spec = SENSOR_SPECS.find((x) => x.id === s.id)!;
      const value = Math.round((spec.base + (rnd() - 0.5) * 2 * spec.spread) * 100) / 100;
      const r = s.read(value, ts);
      gateway.ingest(r);
      next.set(s.id, r.seq + 1);
    }
  }
  return next;
}
