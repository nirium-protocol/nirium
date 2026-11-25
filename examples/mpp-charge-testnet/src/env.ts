import { existsSync } from 'node:fs';
import { resolve } from 'node:path';
import { config as loadDotenv } from 'dotenv';

const envPath = resolve(import.meta.dirname, '..', '.env');

export function loadExampleEnv(): void {
  if (existsSync(envPath)) loadDotenv({ path: envPath, quiet: true });
}

export function sellerPublicKey(): string {
  const value = process.env.SELLER_PUBLIC_KEY?.trim() ?? '';
  if (!value || !value.startsWith('G')) {
    throw new Error('SELLER_PUBLIC_KEY (G...) is required');
  }
  return value;
}

export function payerSecretKey(): string {
  const value = process.env.PAYER_SECRET_KEY?.trim() ?? '';
  if (!value || !value.startsWith('S')) {
    throw new Error('PAYER_SECRET_KEY (S...) is required');
  }
  return value;
}

export function chargePort(): number {
  return Number(process.env.PORT ?? 3403);
}

export function chargeAmount(): string {
  return process.env.CHARGE_AMOUNT ?? '0.01';
}

/** mppx server secret, not a Stellar key. */
export function mppServerSecret(): string {
  return process.env.MPP_SECRET_KEY ?? 'nirium-349-charge-demo-secret-key-32b';
}
