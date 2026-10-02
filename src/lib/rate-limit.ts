// Tiny in-process sliding-window rate limiter. Keyed lookup, no external
// dependencies. Buckets are per-instance so on Vercel a spike can slip
// through if the request lands on a fresh cold-started instance, but the
// common case (a single warm instance serving repeated requests) is well
// covered — good enough for defense-in-depth against brute force + abuse.
//
// Not suitable for hard quotas; layer Upstash/Redis on top of this if you
// need cluster-wide accounting.

type Bucket = { hits: number[] };

const buckets = new Map<string, Bucket>();
const MAX_KEYS = 10_000;

// Runs before a new key is added. Pruning after would sort the brand-new,
// still-empty bucket first and delete it, losing its hits.
function prune() {
  if (buckets.size < MAX_KEYS) return;
  // Drop the oldest half when we exceed the cap so the map can't grow
  // unbounded from unique-key attacks.
  const entries = [...buckets.entries()];
  entries.sort((a, b) => {
    const aLast = a[1].hits[a[1].hits.length - 1] ?? 0;
    const bLast = b[1].hits[b[1].hits.length - 1] ?? 0;
    return aLast - bLast;
  });
  const toDelete = Math.floor(entries.length / 2);
  for (let i = 0; i < toDelete; i++) buckets.delete(entries[i][0]);
}

export interface RateLimitResult {
  allowed: boolean;
  remaining: number;
  retryAfterSec: number;
}

export function rateLimit(
  key: string,
  limit: number,
  windowMs: number,
): RateLimitResult {
  const now = Date.now();
  const cutoff = now - windowMs;
  let bucket = buckets.get(key);
  if (!bucket) {
    prune();
    bucket = { hits: [] };
    buckets.set(key, bucket);
  }
  // Drop hits outside the window
  bucket.hits = bucket.hits.filter((t) => t > cutoff);
  if (bucket.hits.length >= limit) {
    const oldest = bucket.hits[0];
    return {
      allowed: false,
      remaining: 0,
      retryAfterSec: Math.max(1, Math.ceil((oldest + windowMs - now) / 1000)),
    };
  }
  bucket.hits.push(now);
  return {
    allowed: true,
    remaining: limit - bucket.hits.length,
    retryAfterSec: 0,
  };
}
