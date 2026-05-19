// In-memory rate limiter for magic-link requests.
// Process-local — fine for single-instance Vercel deployments and friends-only scale.

const map = new Map<string, number[]>();

const MAX_PER_WINDOW = 3;
const WINDOW_MS = 10 * 60 * 1000;

export function checkRateLimit(key: string): { allowed: boolean; retryAfterMs?: number } {
  const now = Date.now();
  const k = key.toLowerCase();
  const recent = (map.get(k) ?? []).filter((t) => now - t < WINDOW_MS);

  if (recent.length >= MAX_PER_WINDOW) {
    const oldest = recent[0];
    return { allowed: false, retryAfterMs: WINDOW_MS - (now - oldest) };
  }

  recent.push(now);
  map.set(k, recent);
  return { allowed: true };
}
