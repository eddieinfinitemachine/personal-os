// One /projects run: collect the gated signals, ask Claude what Eddie is
// working on (unless nothing changed in the last day), store the result.
// Runs from the projects-infer cron and the Refresh button, never both at
// once (the run row's lock). Any failure writes no projects: the board keeps
// the last good result and says the refresh failed.

import { failureClass, fromSource } from "./signals/errors";
import type { ExclusionCounts } from "./signals/gate";
import { collectSignals, type SignalCounts } from "./signals";
import { evidenceHash, inferProjects, shouldSkip } from "./infer";
import { acquireRunLock, loadInferred, saveFailed, saveInferred, saveUnchanged } from "./inferred-store";

export type InferSyncResult =
  | { status: "busy" }
  | {
      status: "ok" | "unchanged";
      counts: SignalCounts;
      excluded: ExclusionCounts;
      /** Evidence items left after the gate. */
      items: number;
      /** Items that didn't fit the prompt budget. */
      omitted: number;
      projects: number;
      ms: number;
    }
  | { status: "failed"; error: string; ms: number };

export async function syncInferredProjects(
  userId: string,
  opts: { now?: Date; collect?: typeof collectSignals; infer?: typeof inferProjects } = {},
): Promise<InferSyncResult> {
  const started = Date.now();
  const now = opts.now ?? new Date();
  if (!(await acquireRunLock(userId, now))) return { status: "busy" };

  try {
    const signals = await (opts.collect ?? collectSignals)(userId, { now });
    const { projects: previous, run } = await loadInferred(userId);
    const hash = evidenceHash(signals.items);
    const base = { counts: signals.counts, excluded: signals.excluded, items: signals.items.length };
    if (shouldSkip(run, hash, now)) {
      await saveUnchanged(userId, now);
      return { status: "unchanged", ...base, omitted: 0, projects: run?.keys.length ?? 0, ms: Date.now() - started };
    }
    const { projects, omitted } = await fromSource("claude", () =>
      (opts.infer ?? inferProjects)({ items: signals.items, previous, now, isSensitive: signals.gate.matchesText }),
    );
    await saveInferred(userId, projects, { hash, now });
    return { status: "ok", ...base, omitted, projects: projects.length, ms: Date.now() - started };
  } catch (e) {
    const error = failureClass(e);
    console.error("projects-infer: run failed:", error);
    try {
      await saveFailed(userId, error, now);
    } catch (e2) {
      console.error("projects-infer: could not record the failure:", failureClass(e2));
    }
    return { status: "failed", error, ms: Date.now() - started };
  }
}
