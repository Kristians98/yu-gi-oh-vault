// Tiny in-memory sliding-window rate limiter (single-instance dev).
// Production with multiple instances should back this with Redis.
const g = globalThis as unknown as { __rl?: Map<string, number[]> };
const store = g.__rl ?? (g.__rl = new Map<string, number[]>());

/** Returns true if the action is allowed (and records it), false if over the limit. */
export function rateLimit(key: string, limit: number, windowMs: number): boolean {
  const now = Date.now();
  const hits = (store.get(key) ?? []).filter((t) => now - t < windowMs);
  if (hits.length >= limit) {
    store.set(key, hits);
    return false;
  }
  hits.push(now);
  store.set(key, hits);
  return true;
}
