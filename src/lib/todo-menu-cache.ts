// Shared client-side cache for the lists payload consumed by every TodoRow's
// context menu. Previously each row fetched it independently on first menu
// open, so a session full of menu opens cost N cold round trips. This file
// collapses that to one in-flight promise, with TTL + event-driven invalidation.

type CachedList = { id: string; name: string; color: string };

type Cached<T> = { promise: Promise<T>; expiresAt: number };

const TTL_MS = 5 * 60 * 1000;

let listsCache: Cached<CachedList[]> | null = null;

function now(): number {
  return Date.now();
}

export function getLists(): Promise<CachedList[]> {
  if (listsCache && listsCache.expiresAt > now()) return listsCache.promise;
  const promise = fetch("/api/lists")
    .then((r) => (r.ok ? r.json() : { lists: [] }))
    .then((d: { lists?: CachedList[] }) => d.lists ?? [])
    .catch(() => [] as CachedList[]);
  listsCache = { promise, expiresAt: now() + TTL_MS };
  return promise;
}

export function invalidateLists() {
  listsCache = null;
}

// Listen for the existing mutation events so the cache stays fresh without
// every callsite having to remember to invalidate.
if (typeof window !== "undefined") {
  window.addEventListener("personalos:list-created", invalidateLists);
  window.addEventListener("personalos:list-changed", invalidateLists);
  window.addEventListener("personalos:list-membership-changed", invalidateLists);
}
