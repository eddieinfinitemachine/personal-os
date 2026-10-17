// Workout log: what each finished session actually did (every main set's reps
// and weight), the load to try next time, and the training-log prompt that lets
// the planner progress weights and skip what was just done.
//
// Framework-free like workout.ts so the client, the API routes and tests share it.

import {
  FOCUS_OPTIONS,
  adjustLoad,
  loadStep,
  parseLoad,
  videoKey,
  type Block,
  type Focus,
  type WorkoutSession,
} from "./workout";
import type { Readiness } from "./workout-health";

export type SetRecord = { reps: number | null; durationSec: number | null; load: string };

export type ExerciseRecord = {
  name: string;
  equipment: string;
  /** What the plan asked for, so the next session can tell a hit from a miss. */
  targetReps: number | null;
  sets: SetRecord[];
};

export type WorkoutRecord = {
  /** The session id from the device ("w-…"); finishing again after "+10 min" replaces it. */
  id: string;
  title: string;
  focus: Focus;
  startedAt: number;
  finishedAt: number;
  durationMin: number;
  /** Main work only, in plan order; warm-up and cool-down are left out. */
  exercises: ExerciseRecord[];
};

/** A finished session as the device keeps it: the record plus local bookkeeping. */
export type HistoryEntry = WorkoutRecord & {
  setsLogged: number;
  loggedToPersonal: boolean;
  /** The server has this version of the record. */
  synced?: boolean;
};

export type LoadAdvice = {
  /** Last time's load text with the number moved ("2×30 lb dumbbells"). */
  load: string;
  direction: "up" | "same" | "down";
  reason: string;
};

/** The last time an exercise was logged, and the advice that set today's load. */
export type ExerciseLast = { at: number; sets: SetRecord[]; advice: LoadAdvice | null };

export const HISTORY_MAX = 30;
/** Sessions sent to the planner. */
export const PROMPT_RECORDS = 12;
/** Main exercises from this many latest sessions are off the menu. */
export const RECENT_SESSIONS = 3;

export function recordFromSession(s: WorkoutSession, finishedAt: number): WorkoutRecord {
  const exercises = s.plan.blocks
    .flatMap((b) => b.exercises)
    .flatMap((e): ExerciseRecord[] => {
      const sets = s.logs
        .filter((l) => l.exerciseId === e.id)
        .sort((a, b) => a.setIndex - b.setIndex)
        .map((l) => ({ reps: l.reps, durationSec: l.durationSec, load: l.load }));
      return sets.length ? [{ name: e.name, equipment: e.equipment, targetReps: e.reps, sets }] : [];
    });
  return {
    id: s.id,
    title: s.plan.title,
    focus: s.plan.focus,
    startedAt: s.startedAt,
    finishedAt,
    durationMin: Math.max(1, Math.round((finishedAt - s.startedAt) / 60000)),
    exercises,
  };
}

export function toRecord(e: WorkoutRecord): WorkoutRecord {
  const { id, title, focus, startedAt, finishedAt, durationMin, exercises } = e;
  return { id, title, focus, startedAt, finishedAt, durationMin, exercises };
}

/** "10, 10, 9 @ 2×25 lb dumbbells", sets grouped by load in the order done. */
export function formatSets(sets: SetRecord[]): string {
  const groups: { load: string; parts: string[] }[] = [];
  for (const s of sets) {
    const part = s.reps !== null ? String(s.reps) : `${s.durationSec ?? 0}s`;
    const last = groups[groups.length - 1];
    if (last && last.load === s.load) last.parts.push(part);
    else groups.push({ load: s.load, parts: [part] });
  }
  return groups
    .map((g) => (parseLoad(g.load) ? `${g.parts.join(", ")} @ ${g.load}` : g.parts.join(", ")))
    .join("; ");
}

// ---- Progression -----------------------------------------------------------
// Double progression on the weight of the last set (the one the athlete ended
// on): every rep at it → one step up (5 lb / 2.5 kg); a rep or two short a set
// → same; further off → one step down. A rep target more than 2 away from last
// time goes through an estimated 1RM (Epley) instead. Timed and bodyweight
// work has no weight to move. On a low-recovery day (workout-health) nothing
// goes above the weight the athlete ended on.

export function adviseLoad(prev: ExerciseRecord, targetReps: number | null, readiness: Readiness | null = null): LoadAdvice | null {
  const advice = progress(prev, targetReps);
  if (!advice || advice.direction !== "up" || readiness !== "low") return advice;
  const working = prev.sets.filter((s) => s.reps !== null).at(-1)!.load;
  const w = parseLoad(working)!;
  return { load: working, direction: "same", reason: `Recovery is low today: holding ${w.amount} ${w.unit}` };
}

function progress(prev: ExerciseRecord, targetReps: number | null): LoadAdvice | null {
  const repSets = prev.sets.filter((s) => s.reps !== null);
  if (!repSets.length || prev.targetReps === null) return null;
  const working = repSets[repSets.length - 1].load;
  const w = parseLoad(working);
  if (!w) return null;
  const reps = repSets
    .filter((s) => {
      const p = parseLoad(s.load);
      return p?.unit === w.unit && p.amount === w.amount;
    })
    .map((s) => s.reps!);
  const step = loadStep(w.unit);
  const weight = `${w.amount} ${w.unit}`;
  const target = targetReps ?? prev.targetReps;

  if (Math.abs(target - prev.targetReps) > 2) {
    const best = Math.max(...reps);
    const next = Math.max(step, Math.round((w.amount * (1 + best / 30)) / (1 + target / 30) / step) * step);
    return {
      load: adjustLoad(working, next - w.amount),
      direction: next > w.amount ? "up" : next < w.amount ? "down" : "same",
      reason: `Matched to ${target} reps from ${best} at ${weight}`,
    };
  }
  const short = reps.reduce((n, r) => n + Math.max(0, prev.targetReps! - r), 0) / reps.length;
  if (short === 0) {
    return { load: adjustLoad(working, step), direction: "up", reason: `+${step} ${w.unit}: every rep at ${weight}` };
  }
  if (short <= 2 || w.amount - step <= 0) {
    return { load: working, direction: "same", reason: `Same weight: a rep or two short at ${weight}` };
  }
  return { load: adjustLoad(working, -step), direction: "down", reason: `−${step} ${w.unit}: reps fell short at ${weight}` };
}

/** The most recent time this exercise (by name, as the video cache matches it) was logged. */
export function lastPerformance(records: WorkoutRecord[], name: string): { at: number; exercise: ExerciseRecord } | null {
  const key = videoKey(name);
  for (const r of [...records].sort((a, b) => b.finishedAt - a.finishedAt)) {
    const exercise = r.exercises.find((e) => videoKey(e.name) === key);
    if (exercise) return { at: r.finishedAt, exercise };
  }
  return null;
}

function equipmentWords(s: string): string[] {
  return s
    .toLowerCase()
    .split(/[^a-z]+/)
    .filter(Boolean)
    .map((w) => w.replace(/s$/, ""));
}

/** "dumbbell" ~ "Adjustable dumbbells"; "kettlebell" ≁ "dumbbell". */
function sameEquipment(a: string, b: string): boolean {
  const [short, long] = [equipmentWords(a), equipmentWords(b)].sort((x, y) => x.length - y.length);
  return short.length > 0 && short.every((w) => long.includes(w));
}

/**
 * Main exercises done before get `last`; when the weight can move on the same
 * equipment and unit, the advised load replaces the planned one.
 */
export function withHistory(blocks: Block[], records: WorkoutRecord[], readiness: Readiness | null = null): Block[] {
  if (!records.length) return blocks;
  return blocks.map((b) => ({
    ...b,
    exercises: b.exercises.map((e) => {
      const prev = lastPerformance(records, e.name);
      if (!prev) return e;
      const advice = e.durationSec === null ? adviseLoad(prev.exercise, e.reps, readiness) : null;
      const planned = parseLoad(e.load);
      const use =
        advice !== null &&
        planned !== null &&
        planned.unit === parseLoad(advice.load)?.unit &&
        sameEquipment(e.equipment, prev.exercise.equipment);
      return {
        ...e,
        load: use ? advice.load : e.load,
        last: { at: prev.at, sets: prev.exercise.sets, advice: use ? advice : null },
      };
    }),
  }));
}

/** Local entries plus the server's, one per session (the later finish wins), newest first. */
export function mergeHistory(local: HistoryEntry[], remote: WorkoutRecord[], max = HISTORY_MAX): HistoryEntry[] {
  const byId = new Map(local.map((e) => [e.id, e]));
  for (const r of remote) {
    const mine = byId.get(r.id);
    if (mine && mine.finishedAt > r.finishedAt) continue;
    if (mine && mine.finishedAt === r.finishedAt) {
      byId.set(r.id, { ...mine, synced: true });
      continue;
    }
    byId.set(r.id, {
      ...r,
      setsLogged: r.exercises.reduce((n, e) => n + e.sets.length, 0),
      loggedToPersonal: mine?.loggedToPersonal ?? false,
      synced: true,
    });
  }
  return [...byId.values()].sort((a, b) => b.finishedAt - a.finishedAt).slice(0, max);
}

// ---- Prompt ----------------------------------------------------------------

function day(ts: number): string {
  return new Date(ts).toISOString().slice(0, 10);
}
function ago(ts: number, now: number): string {
  const days = Math.floor((now - ts) / 86_400_000);
  return days <= 0 ? "today" : days === 1 ? "yesterday" : `${days} days ago`;
}

/** The training log for the planner; "" with no history. */
export function historyPrompt(records: WorkoutRecord[], now: number, readiness: Readiness | null = null): string {
  const sorted = [...records].sort((a, b) => b.finishedAt - a.finishedAt).slice(0, PROMPT_RECORDS);
  if (!sorted.length) return "";
  const lines = ["Training log, newest first:"];
  for (const r of sorted) {
    const names = r.exercises.map((e) => e.name);
    lines.push(
      `- ${day(r.finishedAt)} (${ago(r.finishedAt, now)}) · ${r.title} · ${r.focus} · ${r.durationMin} min${names.length ? `: ${names.join(", ")}` : ""}`,
    );
  }
  const recent = sorted.slice(0, RECENT_SESSIONS);
  const avoid = Array.from(new Map(recent.flatMap((r) => r.exercises.map((e) => [videoKey(e.name), e.name] as const))).values());
  if (avoid.length) {
    lines.push(
      `Don't repeat these main exercises from the last ${recent.length === 1 ? "session" : `${recent.length} sessions`}; train the same muscles with different movements unless the equipment leaves no alternative: ${avoid.join(", ")}.`,
    );
  }
  const seen = new Set<string>();
  const guide: string[] = [];
  for (const r of sorted) {
    for (const e of r.exercises) {
      const key = videoKey(e.name);
      if (seen.has(key) || guide.length >= 24) continue;
      seen.add(key);
      const advice = adviseLoad(e, null, readiness);
      guide.push(
        `- ${e.name} · ${day(r.finishedAt)}: ${formatSets(e.sets)}${e.targetReps !== null ? ` [target ${e.targetReps}]` : ""}${advice ? ` → next ${advice.load}` : ""}`,
      );
    }
  }
  if (guide.length) {
    lines.push(
      "Last performance per exercise [target reps] and the load to use next if you program it. Keep its exact name:",
      ...guide,
    );
  }
  return lines.join("\n");
}

// ---- Normalizer ------------------------------------------------------------
// Records come from the device (plan/extend requests, the log upload) and from
// the database's JSON column. Coerce every field; drop what can't be read.

function text(v: unknown, max: number): string {
  return typeof v === "string" ? v.trim().slice(0, max) : "";
}
function num(v: unknown, min: number, max: number): number | null {
  const n = typeof v === "number" ? v : NaN;
  return Number.isFinite(n) && n >= min && n <= max ? Math.round(n) : null;
}

const EARLIEST = Date.UTC(2020, 0, 1);

function normalizeSet(raw: unknown): SetRecord | null {
  if (!raw || typeof raw !== "object") return null;
  const o = raw as Record<string, unknown>;
  const reps = num(o.reps, 0, 500);
  const durationSec = num(o.durationSec, 0, 3600);
  if (reps === null && durationSec === null) return null;
  return { reps, durationSec: reps === null ? durationSec : null, load: text(o.load, 80) || "bodyweight" };
}

function normalizeExerciseRecord(raw: unknown): ExerciseRecord | null {
  if (!raw || typeof raw !== "object") return null;
  const o = raw as Record<string, unknown>;
  const name = text(o.name, 80);
  const sets = (Array.isArray(o.sets) ? o.sets : [])
    .map(normalizeSet)
    .filter((s): s is SetRecord => s !== null)
    .slice(0, 20);
  if (!name || !sets.length) return null;
  return { name, equipment: text(o.equipment, 80) || "bodyweight", targetReps: num(o.targetReps, 1, 200), sets };
}

export function normalizeRecord(raw: unknown, now = Date.now()): WorkoutRecord | null {
  if (!raw || typeof raw !== "object") return null;
  const o = raw as Record<string, unknown>;
  const id = text(o.id, 64);
  const finishedAt = num(o.finishedAt, EARLIEST, now + 86_400_000);
  if (!id || finishedAt === null) return null;
  const startedAt = num(o.startedAt, EARLIEST, finishedAt) ?? finishedAt;
  return {
    id,
    title: text(o.title, 120) || "Workout",
    focus: (FOCUS_OPTIONS as readonly string[]).includes(String(o.focus)) ? (o.focus as Focus) : "full-body",
    startedAt,
    finishedAt,
    durationMin: num(o.durationMin, 1, 600) ?? Math.max(1, Math.round((finishedAt - startedAt) / 60000)),
    exercises: (Array.isArray(o.exercises) ? o.exercises : [])
      .map(normalizeExerciseRecord)
      .filter((e): e is ExerciseRecord => e !== null)
      .slice(0, 16),
  };
}

/** Valid records, newest first, one per id. */
export function normalizeRecords(raw: unknown, max = HISTORY_MAX, now = Date.now()): WorkoutRecord[] {
  if (!Array.isArray(raw)) return [];
  const byId = new Map<string, WorkoutRecord>();
  for (const r of raw.slice(0, 100)) {
    const rec = normalizeRecord(r, now);
    if (rec && (byId.get(rec.id)?.finishedAt ?? -1) < rec.finishedAt) byId.set(rec.id, rec);
  }
  return [...byId.values()].sort((a, b) => b.finishedAt - a.finishedAt).slice(0, max);
}
