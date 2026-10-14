import { readdirSync, rmSync, statSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

/**
 * Remove sibling snapshot roots left behind by a worker that was killed
 * (SIGKILL, session teardown, ENOSPC crash). Each worker snapshots the
 * message databases (gigabytes) under `${tmpdir()}/${prefix}*`; a run that
 * cannot reach its finally block leaves them on disk. Only roots older
 * than `maxAgeMs` go, so a concurrent run's live snapshot is never touched.
 * Returns the number of roots removed. Never throws.
 */
export function sweepStaleTempRoots(prefix: string, maxAgeMs: number, dir = tmpdir(), now = Date.now()): number {
  let removed = 0;
  let names: string[];
  try { names = readdirSync(dir); } catch { return 0; }
  for (const name of names) {
    if (!name.startsWith(prefix)) continue;
    const path = join(dir, name);
    try {
      const info = statSync(path);
      if (!info.isDirectory() || now - info.mtimeMs < maxAgeMs) continue;
      rmSync(path, { recursive: true, force: true });
      removed++;
    } catch { /* a live run may be using it; leave it */ }
  }
  return removed;
}
