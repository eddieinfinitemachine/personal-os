// Class whiteboard → workout log: Claude reads a photo of a CrossFit / gym
// whiteboard into a draft (movements, rep schemes, Rx loads), the athlete
// checks it and fills in their weights and score, and the result is saved as a
// "board" record in the workout log (workout-history.ts).
//
// Framework-free like workout.ts so the client, the API route and tests share it.

import { FOCUS_OPTIONS, type Focus } from "./workout";
import type { ExerciseRecord, WorkoutRecord } from "./workout-history";

export type Work = { reps: number | null; durationSec: number | null };

export type BoardExercise = {
  name: string;
  equipment: string;
  /** One load for every set ("95 lb", "bodyweight", "75%"). */
  load: string;
  sets: Work[];
};

export type BoardDraft = {
  title: string;
  focus: Focus;
  /** "For time", "AMRAP 20 min", "EMOM 12 min", "5×5"; "" when the board doesn't say. */
  format: string;
  /** Sets are one round, repeated for the rounds completed. */
  amrap: boolean;
  /** Time cap or AMRAP length. */
  timeCapMin: number | null;
  exercises: BoardExercise[];
  /** Anything else worth keeping from the board (scaling, strength %, coach notes). */
  notes: string;
};

export function buildBoardPrompt(): string {
  return [
    "You read photos of gym and CrossFit class whiteboards and turn the workout on them into structured data an athlete can log.",
    "",
    "Return ONLY a JSON object with this exact shape (no prose, no markdown fences):",
    JSON.stringify(
      {
        title: "Fran",
        focus: "one of: " + FOCUS_OPTIONS.join(" | "),
        format: "For time",
        amrap: false,
        timeCapMin: 10,
        exercises: [
          { name: "Thruster", equipment: "barbell", load: "95 lb", sets: [21, 15, 9] },
          { name: "Pull-up", equipment: "pull-up bar", load: "bodyweight", sets: [21, 15, 9] },
        ],
        notes: "Scale: jumping pull-ups, 65 lb thrusters.",
      },
      null,
      2,
    ),
    "",
    "Rules:",
    "- List every movement in the order it's done, including a strength part before the metcon.",
    '- Expand rep schemes into one entry per set: "21-15-9" → [21, 15, 9]; "5 rounds of 10 X, 15 Y" → X [10,10,10,10,10] and Y [15,15,15,15,15]; "5x5" → [5,5,5,5,5]; EMOM movements get one entry per minute they are done.',
    '- AMRAP: amrap true, timeCapMin = its length, and sets = ONE round (each movement\'s reps once).',
    '- Timed holds and carries are strings with seconds: "45s". Distances and calories go in the name with one rep per round: "400 m run" [1,1,1].',
    '- Rx weights like "95/65" are men\'s/women\'s: use the one for the athlete\'s sex if given, else the first. Keep units ("95 lb", "24 kg"). Percentages or words ("75%", "heavy") stay as the load text. No weight: "bodyweight".',
    "- title: the workout's name if it has one (Fran, Murph, \"Hero WOD\"), else a short description.",
    "- If the board has several days or classes, take the one that stands out as today's and say so in notes.",
    '- If you can\'t find a workout on the board, return {"error": "<why>"}.',
  ].join("\n");
}

export function buildBoardUserPrompt(sex: string | null, notes: string): string {
  const lines = ["Read the workout on this whiteboard."];
  if (sex === "M" || sex === "F") lines.push(`The athlete is ${sex === "M" ? "male" : "female"}.`);
  if (notes.trim()) lines.push(`Notes from the athlete: ${notes.trim()}`);
  return lines.join("\n");
}

// ---- Normalizer ------------------------------------------------------------

function text(v: unknown, max: number): string {
  return typeof v === "string" ? v.trim().slice(0, max) : "";
}
function int(v: unknown, min: number, max: number): number | null {
  const n = typeof v === "number" ? v : typeof v === "string" && v.trim() !== "" ? Number(v) : NaN;
  return Number.isFinite(n) && n >= min && n <= max ? Math.round(n) : null;
}

function normalizeWork(v: unknown): Work | null {
  if (typeof v === "number" || (typeof v === "string" && /^\s*\d+\s*$/.test(v))) {
    const reps = int(v, 0, 500);
    return reps === null ? null : { reps, durationSec: null };
  }
  if (typeof v === "string") return parseSetsText(v)[0] ?? null;
  if (v && typeof v === "object") {
    const o = v as Record<string, unknown>;
    const reps = int(o.reps, 0, 500);
    if (reps !== null) return { reps, durationSec: null };
    const durationSec = int(o.durationSec, 1, 3600);
    return durationSec === null ? null : { reps: null, durationSec };
  }
  return null;
}

export function normalizeBoard(raw: unknown): BoardDraft {
  if (!raw || typeof raw !== "object") throw new Error("board is not an object");
  const r = raw as Record<string, unknown>;
  const exercises = (Array.isArray(r.exercises) ? r.exercises : [])
    .map((e): BoardExercise | null => {
      if (!e || typeof e !== "object") return null;
      const o = e as Record<string, unknown>;
      const name = text(o.name, 80);
      const sets = (Array.isArray(o.sets) ? o.sets : [o.sets])
        .map(normalizeWork)
        .filter((w): w is Work => w !== null)
        .slice(0, 30);
      if (!name || !sets.length) return null;
      return { name, equipment: text(o.equipment, 60) || "bodyweight", load: text(o.load, 40) || "bodyweight", sets };
    })
    .filter((e): e is BoardExercise => e !== null)
    .slice(0, 16);
  if (!exercises.length) throw new Error(text(r.error, 200) || "no workout on the board");
  return {
    title: text(r.title, 120) || "Class workout",
    focus: (FOCUS_OPTIONS as readonly string[]).includes(String(r.focus)) ? (r.focus as Focus) : "conditioning",
    format: text(r.format, 60),
    amrap: r.amrap === true,
    timeCapMin: int(r.timeCapMin, 1, 180),
    exercises,
    notes: text(r.notes, 300),
  };
}

// ---- Editing ---------------------------------------------------------------
// The review screen edits each movement's sets as text: "21, 15, 9", "5x5",
// "45s, 45s", "3x40s".

export function setsText(sets: Work[]): string {
  return sets.map((s) => (s.reps !== null ? String(s.reps) : `${s.durationSec ?? 0}s`)).join(", ");
}

export function parseSetsText(input: string): Work[] {
  const out: Work[] = [];
  const tidy = input.replace(/\s*[x×*]\s*/gi, "x").replace(/(\d)\s+(s|sec)\b/gi, "$1$2");
  for (const part of tidy.split(/[,;/\s]+/)) {
    const m = /^(?:(\d+)x)?(\d+)(s|sec)?$/i.exec(part);
    if (!m) continue;
    const count = Math.min(30, m[1] ? Number(m[1]) : 1);
    const n = Number(m[2]);
    for (let i = 0; i < count && out.length < 30; i++) out.push(m[3] ? { reps: null, durationSec: Math.min(3600, n) } : { reps: Math.min(500, n), durationSec: null });
  }
  return out;
}

// ---- Saving ----------------------------------------------------------------

/** The reviewed board as a log record; an AMRAP's round is repeated for the rounds completed. */
export function boardRecord(
  draft: BoardDraft,
  opts: { id: string; finishedAt: number; durationMin: number; rounds: number; score: string },
): WorkoutRecord {
  const exercises = draft.exercises.flatMap((e): ExerciseRecord[] => {
    const round = e.sets.map((s) => ({ ...s, load: e.load.trim() || "bodyweight" }));
    const sets = draft.amrap ? Array.from({ length: Math.max(1, opts.rounds) }, () => round).flat().slice(0, 60) : round;
    if (!e.name.trim() || !sets.length) return [];
    const reps = sets.map((s) => s.reps);
    const same = reps.every((n) => n !== null && n === reps[0]);
    return [{ name: e.name.trim(), equipment: e.equipment, targetReps: same ? reps[0] : null, sets }];
  });
  const durationMin = Math.max(1, Math.min(600, Math.round(opts.durationMin)));
  const notes = [draft.format, opts.score.trim() ? `Score ${opts.score.trim()}` : "", draft.notes].filter(Boolean).join(" · ").slice(0, 300);
  return {
    id: opts.id,
    source: "board",
    title: draft.title.trim() || "Class workout",
    focus: draft.focus,
    startedAt: opts.finishedAt - durationMin * 60000,
    finishedAt: opts.finishedAt,
    durationMin,
    exercises,
    ...(notes ? { notes } : {}),
  };
}
