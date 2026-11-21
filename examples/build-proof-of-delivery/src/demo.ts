import type { DeliveryDetails } from './record.js';

/**
 * Three demo deliveries. The coordinates are made-up points, not real
 * addresses; the courier app rounds them to 2 decimals (~1 km) before
 * anything is stored or hashed.
 */
export const DEMO_DELIVERIES: { details: DeliveryDetails; photoSeed: number }[] = [
  { details: { orderId: 'order-1001', deliveredAt: '2026-11-19T09:12:00Z', lat: 40.712776, lon: -74.005974 }, photoSeed: 1 },
  { details: { orderId: 'order-1002', deliveredAt: '2026-11-19T10:47:00Z', lat: 40.730610, lon: -73.935242 }, photoSeed: 2 },
  { details: { orderId: 'order-1003', deliveredAt: '2026-11-19T13:05:00Z', lat: 40.678178, lon: -73.944158 }, photoSeed: 3 },
];
