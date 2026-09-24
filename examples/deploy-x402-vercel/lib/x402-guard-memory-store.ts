import type { X402GuardStore } from "nirium";

/**
 * In-memory reference X402GuardStore - for this demo template only.
 *
 * Vercel serverless functions are NOT guaranteed to reuse the same process
 * between invocations (cold starts happen, and traffic can fan out across
 * multiple concurrent instances), so this store's protection is
 * best-effort here: a replay hitting a different instance than the
 * original request won't be caught. It exists to show the shape of
 * `config.guard` turned ON without requiring you to set up Upstash just to
 * try the template.
 *
 * For real production use, swap this for `createUpstashX402GuardStore()`
 * (exported by the `nirium` package) so every instance shares the same
 * durable store - see the README section on this.
 */
export function createMemoryX402GuardStore(): X402GuardStore {
  const claims = new Map<string, number>();
  const hits = new Map<string, number[]>();

  return {
    async claimOnce(key, ttlMs) {
      const now = Date.now();
      const expiresAt = claims.get(key);
      if (expiresAt !== undefined && expiresAt > now) return false;
      claims.set(key, now + ttlMs);
      return true;
    },
    async release(key) {
      claims.delete(key);
    },
    async slidingWindowHit(key, windowMs, member) {
      const now = Date.now();
      const windowStart = now - windowMs;
      const existing = (hits.get(key) ?? []).filter((ts) => ts > windowStart);
      existing.push(now);
      hits.set(key, existing);
      void member; // unused here - Upstash's ZADD needs a unique member, this doesn't
      return existing.length;
    },
  };
}
