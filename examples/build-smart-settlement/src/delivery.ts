import { createPrivateKey, createPublicKey, generateKeyPairSync, sign, verify } from 'node:crypto';

/** Off-chain delivery confirmation. A local ed25519 key signs this payload. */
export interface DeliveryEvent {
  deliveryId: string;
  orderId: string;
  deliveredAt: string;
}

export interface SignedDelivery {
  event: DeliveryEvent;
  /** SPKI public key, base64. */
  publicKey: string;
  /** Ed25519 signature over the canonical payload, base64. */
  signature: string;
}

export interface DeliveryKeyPair {
  publicKey: string;
  /** PKCS#8 PEM. Keep in memory; never log or commit it. */
  privateKeyPem: string;
}

/** Canonical JSON with sorted keys, so the same event always hashes the same way. */
export function canonicalPayload(event: DeliveryEvent): Buffer {
  const ordered: DeliveryEvent = {
    deliveredAt: event.deliveredAt,
    deliveryId: event.deliveryId,
    orderId: event.orderId,
  };
  return Buffer.from(JSON.stringify(ordered), 'utf8');
}

export function createDeliveryKeys(): DeliveryKeyPair {
  const { publicKey, privateKey } = generateKeyPairSync('ed25519');
  return {
    publicKey: publicKey.export({ type: 'spki', format: 'der' }).toString('base64'),
    privateKeyPem: privateKey.export({ type: 'pkcs8', format: 'pem' }).toString(),
  };
}

export function signDelivery(event: DeliveryEvent, privateKeyPem: string, publicKey: string): SignedDelivery {
  const key = createPrivateKey(privateKeyPem);
  const signature = sign(null, canonicalPayload(event), key);
  return {
    event,
    publicKey,
    signature: signature.toString('base64'),
  };
}

/**
 * Returns true only when the payload is signed by `trustedPublicKey`.
 * A mismatched key, a broken signature, or a mutated event all fail.
 */
export function verifyDelivery(signed: SignedDelivery, trustedPublicKey: string): boolean {
  if (signed.publicKey !== trustedPublicKey) return false;
  try {
    const key = createPublicKey({
      key: Buffer.from(signed.publicKey, 'base64'),
      format: 'der',
      type: 'spki',
    });
    return verify(null, canonicalPayload(signed.event), key, Buffer.from(signed.signature, 'base64'));
  } catch {
    return false;
  }
}

/** Build a valid-looking event whose signature no longer matches the payload. */
export function withBadSignature(signed: SignedDelivery): SignedDelivery {
  return {
    ...signed,
    event: { ...signed.event, orderId: `${signed.event.orderId}-tampered` },
  };
}

export function simulateDelivery(
  keys: DeliveryKeyPair,
  index: number,
  now: () => Date = () => new Date(),
): SignedDelivery {
  const event: DeliveryEvent = {
    deliveryId: `del-${String(index).padStart(3, '0')}`,
    orderId: `order-${String(index).padStart(3, '0')}`,
    deliveredAt: now().toISOString(),
  };
  return signDelivery(event, keys.privateKeyPem, keys.publicKey);
}
