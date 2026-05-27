// Shared client-side cache for the lists + projects payloads consumed by
// every TodoRow's context menu and project picker. Previously each row
// fetched these independently on first menu open, so a session full of
// menu opens cost N×2 cold round trips. This file collapses that to one
// in-flight promise per resource, with TTL + event-driven invalidation.

type CachedList = { id: string; name: string; color: string };
type CachedProject = { id: string; name: string };

type Cached<T> = { promise: Promise<T>; expiresAt: number };

const TTL_MS = 5 * 60 * 1000;

let listsCache: Cached<CachedList[]> | null = null;
let projectsCache: Cached<CachedProject[]> | null = null;

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

export function getProjects(): Promise<CachedProject[]> {
  if (projectsCache && projectsCache.expiresAt > now())
    return projectsCache.promise;
  const promise = fetch("/api/projects")
    .then((r) => (r.ok ? r.json() : { projects: [] }))
    .then((d: { projects?: CachedProject[] }) => d.projects ?? [])
    .catch(() => [] as CachedProject[]);
  projectsCache = { promise, expiresAt: now() + TTL_MS };
  return promise;
}

export function invalidateLists() {
  listsCache = null;
}

export function invalidateProjects() {
  projectsCache = null;
}

// Listen for the existing mutation events so the cache stays fresh without
// every callsite having to remember to invalidate.
if (typeof window !== "undefined") {
  window.addEventListener("personalos:list-created", invalidateLists);
  window.addEventListener("personalos:list-changed", invalidateLists);
  window.addEventListener("personalos:project-created", invalidateProjects);
  window.addEventListener("personalos:project-changed", invalidateProjects);
}
