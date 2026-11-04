import { adviseLoad, formatSets, type ExerciseRecord, type WorkoutRecord, type WorkoutSource } from "@/lib/workout-history";
import { parseLoad, videoKey } from "@/lib/workout";

// The Workout tab's log, reduced for the Health page and its chat: how often
// they train, what they lift and how the weights have moved, and the cardio in
// between. Every count, sum and rate is worked out here, so the model never
// does arithmetic. Framework-free like workout-history.ts.

export const TRAINING_WINDOW_DAYS = 90;
const WEEKS = 12;
const MAX_LIFTS = 20;
const MAX_CARDIO = 10;
const MAX_RECENT = 8;
const DAY = 86_400_000;

export type TrainingSession = {
  date: string;
  title: string;
  focus: string;
  durationMin: number;
  source: WorkoutSource;
};

export type LiftSummary = {
  name: string;
  /** Sessions in the window that included it. */
  times: number;
  first: { date: string; sets: string };
  last: { date: string; sets: string };
  /** The load the planner would prescribe next time, when the weight can move. */
  next: string | null;
  /** First to last working weight, when both read as a number in the same unit. Null when done once. */
  loadChange: { from: number; to: number; unit: string } | null;
};

export type TrainingSummary = {
  windowDays: number;
  sessions: number;
  minutes: number;
  bySource: Record<WorkoutSource, number>;
  byFocus: Record<string, number>;
  /** The last 12 weeks (Monday to Sunday, UTC), newest first; the first is the current week. */
  weeks: { weekStart: string; sessions: number; minutes: number }[];
  /** Sessions per week since the first one in the window (at least one week). Null with none. */
  sessionsPerWeek: number | null;
  lastSession: TrainingSession | null;
  /** The latest sessions, newest first, with how many exercises were logged set by set. */
  recent: (TrainingSession & { exercises: number; notes: string | null })[];
  lifts: LiftSummary[];
  /** Runs, rides and other sessions without logged sets, newest first. */
  cardio: { date: string; title: string; durationMin: number; notes: string | null; source: WorkoutSource }[];
};

const day = (ts: number) => new Date(ts).toISOString().slice(0, 10);

const session = (r: WorkoutRecord): TrainingSession => ({
  date: day(r.finishedAt),
  title: r.title,
  focus: r.focus,
  durationMin: r.durationMin,
  source: r.source ?? "guided",
});

/** Midnight UTC on the Monday of the week holding `ts`. */
function mondayOf(ts: number): number {
  const d = new Date(ts);
  const midnight = Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate());
  return midnight - ((d.getUTCDay() + 6) % 7) * DAY;
}

/** The weight the last rep set was done at, as adviseLoad reads it. */
function workingLoad(exercise: ExerciseRecord): string | undefined {
  return (exercise.sets.filter((s) => s.reps !== null).at(-1) ?? exercise.sets.at(-1))?.load;
}

function loadChange(first: ExerciseRecord, last: ExerciseRecord): LiftSummary["loadChange"] {
  const from = parseLoad(workingLoad(first) ?? "");
  const to = parseLoad(workingLoad(last) ?? "");
  return from && to && from.unit === to.unit ? { from: from.amount, to: to.amount, unit: to.unit } : null;
}

function summarizeLifts(records: WorkoutRecord[]): LiftSummary[] {
  // Oldest first, so the first sighting is `first` and each later one becomes `last`.
  const byKey = new Map<string, { times: number; first: [WorkoutRecord, ExerciseRecord]; last: [WorkoutRecord, ExerciseRecord] }>();
  for (const record of [...records].sort((a, b) => a.finishedAt - b.finishedAt)) {
    const seen = new Set<string>();
    for (const exercise of record.exercises) {
      const key = videoKey(exercise.name);
      if (!key || seen.has(key)) continue;
      seen.add(key);
      const lift = byKey.get(key);
      if (lift) {
        lift.times++;
        lift.last = [record, exercise];
      } else {
        byKey.set(key, { times: 1, first: [record, exercise], last: [record, exercise] });
      }
    }
  }
  return [...byKey.values()]
    .sort((a, b) => b.times - a.times || b.last[0].finishedAt - a.last[0].finishedAt)
    .slice(0, MAX_LIFTS)
    .map(({ times, first: [firstRecord, firstExercise], last: [lastRecord, lastExercise] }) => ({
      name: lastExercise.name,
      times,
      first: { date: day(firstRecord.finishedAt), sets: formatSets(firstExercise.sets) },
      last: { date: day(lastRecord.finishedAt), sets: formatSets(lastExercise.sets) },
      next: adviseLoad(lastExercise, null)?.load ?? null,
      loadChange: times > 1 ? loadChange(firstExercise, lastExercise) : null,
    }));
}

export function summarizeTraining(records: WorkoutRecord[], now: Date): TrainingSummary {
  const nowMs = now.getTime();
  const windowStart = nowMs - TRAINING_WINDOW_DAYS * DAY;
  const inWindow = records.filter((r) => r.finishedAt >= windowStart).sort((a, b) => b.finishedAt - a.finishedAt);

  const bySource: Record<WorkoutSource, number> = { guided: 0, board: 0, strava: 0 };
  const byFocus: Record<string, number> = {};
  for (const r of inWindow) {
    bySource[r.source ?? "guided"]++;
    byFocus[r.focus] = (byFocus[r.focus] ?? 0) + 1;
  }

  const thisWeek = mondayOf(nowMs);
  const weeks = Array.from({ length: WEEKS }, (_, i) => {
    const start = thisWeek - i * 7 * DAY;
    const inWeek = inWindow.filter((r) => mondayOf(r.finishedAt) === start);
    return { weekStart: day(start), sessions: inWeek.length, minutes: inWeek.reduce((n, r) => n + r.durationMin, 0) };
  });

  const oldest = inWindow.at(-1);
  const daysCovered = oldest ? Math.min(TRAINING_WINDOW_DAYS, Math.max(7, (nowMs - oldest.finishedAt) / DAY)) : 0;

  return {
    windowDays: TRAINING_WINDOW_DAYS,
    sessions: inWindow.length,
    minutes: inWindow.reduce((n, r) => n + r.durationMin, 0),
    bySource,
    byFocus,
    weeks,
    sessionsPerWeek: oldest ? Math.round((inWindow.length / (daysCovered / 7)) * 10) / 10 : null,
    lastSession: inWindow[0] ? session(inWindow[0]) : null,
    recent: inWindow
      .slice(0, MAX_RECENT)
      .map((r) => ({ ...session(r), exercises: r.exercises.length, notes: r.notes ?? null })),
    lifts: summarizeLifts(inWindow),
    cardio: inWindow
      .filter((r) => r.exercises.length === 0)
      .slice(0, MAX_CARDIO)
      .map((r) => ({
        date: day(r.finishedAt),
        title: r.title,
        durationMin: r.durationMin,
        notes: r.notes ?? null,
        source: r.source ?? "guided",
      })),
  };
}
