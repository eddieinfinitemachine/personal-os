// Where inferred /projects live. No schema of their own: they reuse
// ProjectSource, and this module is the only place that knows the mapping.
//
// Project rows, kind "inferred":
//   key            stable slug
//   name, company  as inferred
//   description    the status line
//   plan           step objects [{ text, due, who, waiting }], then an optional
//                  { type: "problem", text } last. Still an array whose first
//                  entry has `text`, so a rollback to the old reader shows Next.
//   commits        evidence [{ ref, kind, title, at, url }]
//   lastActivityAt newest evidence that has happened
//   state          "auto" | "pinned" | "hidden" (the user's; a run never changes it)
//
// One run row, kind "inferred-run", key "latest":
//   state          "idle" | "running" (the lock)
//   lastActivityAt when the lock was taken
//   plan           RunMeta: last run / check / success, evidence hash, last error class, keys returned

import type { Prisma } from "@prisma/client";
import { prisma } from "@/lib/prisma";
import { VISIBILITIES, type Visibility } from "./board-model";
import { isCompany } from "./company";
import type { InferredProject, PreviousProject, ProjectStep } from "./infer";
import { EVIDENCE_KINDS, type StoredEvidence } from "./signals/types";

export const INFERRED_KIND = "inferred";
export const RUN_KIND = "inferred-run";
export const RUN_KEY = "latest";
/** A lock older than this belongs to a run that died (maxDuration is 300 s). */
export const LOCK_MS = 5 * 60 * 1000;
/** How long a card a run didn't return stays on the board after its last activity. */
export const QUIET_KEEP_MS = 30 * 24 * 60 * 60 * 1000;

export type RunMeta = {
  lastRunAt: string | null;
  /** Last run that ended well (inferred, or nothing changed). The board's "Synced …". */
  lastCheckedAt: string | null;
  /** Last run that asked Claude. */
  lastSuccessAt: string | null;
  hash: string | null;
  /** Failure class of the last run, null when it ended well. */
  error: string | null;
  /** Keys the last successful inference returned. */
  keys: string[];
};

const EMPTY_META: RunMeta = { lastRunAt: null, lastCheckedAt: null, lastSuccessAt: null, hash: null, error: null, keys: [] };

export type StoredProject = PreviousProject & {
  id: string;
  problem: string | null;
  steps: ProjectStep[];
  evidence: StoredEvidence[];
  lastActivityAt: string | null;
};

const runWhere = (userId: string) => ({ userId_kind_key: { userId, kind: RUN_KIND, key: RUN_KEY } });
const str = (v: unknown) => (typeof v === "string" ? v : null);

export function readRunMeta(value: unknown): RunMeta {
  const v = (value && typeof value === "object" && !Array.isArray(value) ? value : {}) as Record<string, unknown>;
  return {
    lastRunAt: str(v.lastRunAt),
    lastCheckedAt: str(v.lastCheckedAt),
    lastSuccessAt: str(v.lastSuccessAt),
    hash: str(v.hash),
    error: str(v.error),
    keys: Array.isArray(v.keys) ? v.keys.filter((k): k is string => typeof k === "string") : [],
  };
}

function readEvidence(value: unknown): StoredEvidence[] {
  if (!Array.isArray(value)) return [];
  return value.flatMap((e) => {
    const x = e as Partial<StoredEvidence> | null;
    if (!x || typeof x.ref !== "string" || typeof x.title !== "string" || typeof x.at !== "string") return [];
    if (!EVIDENCE_KINDS.includes(x.kind as StoredEvidence["kind"])) return [];
    return [{ ref: x.ref, kind: x.kind!, title: x.title, at: x.at, url: typeof x.url === "string" ? x.url : null }];
  });
}

/** Old rows hold [{ text }]; a problem entry is never a step. */
function readPlan(value: unknown): { steps: ProjectStep[]; problem: string | null } {
  const steps: ProjectStep[] = [];
  let problem: string | null = null;
  for (const e of Array.isArray(value) ? value : []) {
    const x = e as { type?: unknown; text?: unknown; due?: unknown; who?: unknown; waiting?: unknown } | null;
    const text = str(x?.text);
    if (!text) continue;
    if (x?.type === "problem") problem = text;
    else steps.push({ text, due: str(x?.due), who: str(x?.who), waiting: x?.waiting === true });
  }
  return { steps, problem };
}

function writePlan(p: Pick<InferredProject, "steps" | "problem">): Prisma.InputJsonValue {
  return [...p.steps, ...(p.problem ? [{ type: "problem", text: p.problem }] : [])] as Prisma.InputJsonValue;
}

type Row = {
  id: string;
  key: string;
  name: string;
  company: string;
  description: string | null;
  plan: Prisma.JsonValue;
  commits: Prisma.JsonValue;
  lastActivityAt: Date | null;
  state: string;
  createdAt?: Date;
};

export function rowToProject(r: Row): StoredProject {
  const evidence = readEvidence(r.commits);
  const { steps, problem } = readPlan(r.plan);
  return {
    id: r.id,
    key: r.key,
    name: r.name,
    company: isCompany(r.company) ? r.company : "Personal",
    status: r.description,
    next: steps[0]?.text ?? null,
    problem,
    steps,
    state: (VISIBILITIES as readonly string[]).includes(r.state) ? (r.state as Visibility) : "auto",
    refs: evidence.map((e) => e.ref),
    evidence,
    lastActivityAt: r.lastActivityAt?.toISOString() ?? null,
  };
}

export async function loadInferred(userId: string): Promise<{ projects: StoredProject[]; run: RunMeta | null }> {
  const rows = await prisma.projectSource.findMany({ where: { userId, kind: { in: [INFERRED_KIND, RUN_KIND] } } });
  const run = rows.find((r) => r.kind === RUN_KIND && r.key === RUN_KEY);
  return {
    projects: rows.filter((r) => r.kind === INFERRED_KIND).map(rowToProject),
    run: run ? readRunMeta(run.plan) : null,
  };
}

/** Take the run lock. False when another run holds a live one. */
export async function acquireRunLock(userId: string, now: Date): Promise<boolean> {
  await prisma.projectSource.createMany({
    data: [
      {
        userId,
        kind: RUN_KIND,
        key: RUN_KEY,
        name: "Projects inference",
        company: "Personal",
        state: "idle",
        plan: EMPTY_META as unknown as Prisma.InputJsonValue,
      },
    ],
    skipDuplicates: true,
  });
  const { count } = await prisma.projectSource.updateMany({
    where: {
      userId,
      kind: RUN_KIND,
      key: RUN_KEY,
      OR: [{ state: { not: "running" } }, { lastActivityAt: null }, { lastActivityAt: { lt: new Date(now.getTime() - LOCK_MS) } }],
    },
    data: { state: "running", lastActivityAt: now },
  });
  return count === 1;
}

async function currentMeta(userId: string): Promise<RunMeta> {
  const row = await prisma.projectSource.findUnique({ where: runWhere(userId), select: { plan: true } });
  return readRunMeta(row?.plan);
}

const unlock = (userId: string, meta: RunMeta) =>
  prisma.projectSource.update({
    where: runWhere(userId),
    data: { state: "idle", lastActivityAt: null, plan: meta as unknown as Prisma.InputJsonValue },
  });

/**
 * Which cards the run didn't return go now. The rest stay as quiet cards, since
 * a project going silent is when it needs watching. Pinned and hidden cards are
 * Eddie's own decisions, so they are never removed here.
 */
export function cardsToRemove(
  rows: Row[],
  returned: InferredProject[],
  opts: { now: Date; rejectedKeys?: string[]; isSensitive?: (text: string) => boolean },
): string[] {
  const returnedKeys = new Set(returned.map((p) => p.key));
  const heldRefs = new Set(returned.flatMap((p) => p.evidence.map((e) => e.ref)));
  const rejected = new Set(opts.rejectedKeys ?? []);
  return rows
    .filter((r) => r.state === "auto" && !returnedKeys.has(r.key))
    .filter((r) => {
      if (rejected.has(r.key)) return true;
      const p = rowToProject(r);
      // Stored text is re-checked every run: the filter can learn a name after the card was written.
      const texts = [p.name, p.status, p.problem, ...p.steps.flatMap((s) => [s.text, s.who]), ...p.evidence.map((e) => e.title)];
      if (opts.isSensitive && texts.some((t) => t && opts.isSensitive!(t))) return true;
      // Most of its evidence moved to a returned card: it was renamed or merged.
      const held = p.refs.filter((ref) => heldRefs.has(ref)).length;
      if (p.refs.length && held * 2 >= p.refs.length) return true;
      const lastSeen = r.lastActivityAt ?? r.createdAt;
      return !lastSeen || opts.now.getTime() - lastSeen.getTime() > QUIET_KEEP_MS;
    })
    .map((r) => r.key);
}

/**
 * One transaction: upsert every returned project, remove the cards that should
 * go (see `cardsToRemove`), record the run and release the lock.
 */
export async function saveInferred(
  userId: string,
  projects: InferredProject[],
  run: { hash: string; now: Date; rejectedKeys?: string[]; isSensitive?: (text: string) => boolean },
): Promise<void> {
  const meta = await currentMeta(userId);
  const rows = await prisma.projectSource.findMany({ where: { userId, kind: INFERRED_KIND } });
  const stored = new Map(rows.map((r) => [r.key, r]));
  const at = run.now.toISOString();
  const keys = projects.map((p) => p.key);
  await prisma.$transaction([
    ...projects.map((p) => {
      // The evidence window rolls forward, so never move a card's last activity back.
      const before = stored.get(p.key)?.lastActivityAt ?? null;
      const latest = p.lastActivityAt ? new Date(p.lastActivityAt) : null;
      const data = {
        name: p.name,
        company: p.company,
        description: p.status,
        url: null,
        plan: writePlan(p),
        commits: p.evidence as unknown as Prisma.InputJsonValue,
        lastActivityAt: before && (!latest || before > latest) ? before : latest,
      };
      return prisma.projectSource.upsert({
        where: { userId_kind_key: { userId, kind: INFERRED_KIND, key: p.key } },
        create: { userId, kind: INFERRED_KIND, key: p.key, state: "auto", ...data },
        update: data,
      });
    }),
    prisma.projectSource.deleteMany({
      where: { userId, kind: INFERRED_KIND, state: "auto", key: { in: cardsToRemove(rows, projects, run) } },
    }),
    unlock(userId, { ...meta, lastRunAt: at, lastCheckedAt: at, lastSuccessAt: at, hash: run.hash, error: null, keys }),
  ]);
}

/** Nothing changed since the last inference: just record the check. */
export async function saveUnchanged(userId: string, now: Date): Promise<void> {
  const meta = await currentMeta(userId);
  const at = now.toISOString();
  await unlock(userId, { ...meta, lastRunAt: at, lastCheckedAt: at, error: null });
}

/** A failed run writes no projects: only its failure class, and the lock is released. */
export async function saveFailed(userId: string, error: string, now: Date): Promise<void> {
  const meta = await currentMeta(userId);
  await unlock(userId, { ...meta, lastRunAt: now.toISOString(), error });
}
