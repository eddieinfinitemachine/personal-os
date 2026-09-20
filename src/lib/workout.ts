// Workout domain: the plan shape Claude returns, the movement patterns the
// animated figure knows how to draw, muscle groups for the body map, and the
// prompt + normalizer that turn a Claude reply into a plan the player trusts.
//
// Kept framework-free so it can be unit-tested and shared by the API route
// and the client.

export const MOVEMENT_PATTERNS = [
  "squat",
  "hinge",
  "lunge",
  "push-horizontal",
  "push-vertical",
  "pull-horizontal",
  "pull-vertical",
  "curl",
  "extension",
  "plank",
  "crunch",
  "jump",
  "carry",
  "stretch",
  "cardio",
] as const;
export type MovementPattern = (typeof MOVEMENT_PATTERNS)[number];

export const MUSCLES = [
  "chest",
  "shoulders",
  "biceps",
  "triceps",
  "forearms",
  "core",
  "obliques",
  "upper-back",
  "lats",
  "lower-back",
  "glutes",
  "quads",
  "hamstrings",
  "calves",
] as const;
export type Muscle = (typeof MUSCLES)[number];

export const FOCUS_OPTIONS = [
  "full-body",
  "upper",
  "lower",
  "push",
  "pull",
  "core",
  "conditioning",
  "mobility",
] as const;
export type Focus = (typeof FOCUS_OPTIONS)[number];

export const INTENSITY_OPTIONS = ["easy", "moderate", "hard"] as const;
export type Intensity = (typeof INTENSITY_OPTIONS)[number];

export type EquipmentItem = { name: string; detail?: string };

export type Exercise = {
  id: string;
  name: string;
  /** Which animated figure to show. */
  pattern: MovementPattern;
  equipment: string;
  sets: number;
  /** Rep target per set; null when the set is timed instead. */
  reps: number | null;
  /** Seconds of work per set for holds/cardio; null when rep-based. */
  durationSec: number | null;
  restSec: number;
  /** Suggested load in plain words ("2×25 lb dumbbells", "bodyweight"). */
  load: string;
  cues: string[];
  muscles: Muscle[];
  /** Same-side or unilateral: the player shows "each side". */
  perSide: boolean;
};

export type Block = {
  name: string;
  /** straight = finish all sets of one exercise; superset/circuit alternate. */
  type: "straight" | "superset" | "circuit";
  exercises: Exercise[];
};

export type WorkoutPlan = {
  title: string;
  summary: string;
  focus: Focus;
  estimatedMinutes: number;
  warmup: Exercise[];
  blocks: Block[];
  cooldown: Exercise[];
};

export type PlanResponse = {
  equipment: EquipmentItem[];
  plan: WorkoutPlan;
};

export type PlanRequest = {
  minutes: number;
  focus: Focus;
  intensity: Intensity;
  notes: string;
  /** Equipment the user already confirmed (no photos needed). */
  knownEquipment: EquipmentItem[];
  hasPhotos: boolean;
  /** Short lines like "2026-09-18 · Upper · 42 min" for variety. */
  recentTitles: string[];
};

export function buildSystemPrompt(): string {
  return [
    "You are a precise, encouraging strength & conditioning coach designing one session for one person.",
    "You will see photos of their available equipment (a home gym, a hotel gym, a corner of a room) and/or a confirmed equipment list.",
    "First inventory the equipment you can actually see or that is listed — brands, dumbbell weights, bands, benches, racks, machines, cardio gear, mats. Never invent equipment; bodyweight is always available.",
    "Then design a workout that uses only that equipment, fits the requested minutes, focus and intensity, and is safe for a healthy adult.",
    "",
    "Return ONLY a JSON object with this exact shape (no prose, no markdown fences):",
    JSON.stringify(
      {
        equipment: [{ name: "Adjustable dumbbells", detail: "5–52.5 lb" }],
        plan: {
          title: "Upper push & pull",
          summary: "One sentence on the intent of the session.",
          focus: "one of: " + FOCUS_OPTIONS.join(" | "),
          estimatedMinutes: 40,
          warmup: ["<Exercise object>", "<Exercise object>"],
          blocks: [
            {
              name: "A · Strength",
              type: "straight | superset | circuit",
              exercises: ["<Exercise object>", "<Exercise object>"],
            },
          ],
          cooldown: ["<Exercise object>"],
        },
      },
      null,
      2,
    ),
    "",
    "Every item in warmup, exercises and cooldown is a full Exercise object (never a bare string):",
    JSON.stringify(
      {
        name: "Dumbbell goblet squat",
        pattern: "one of: " + MOVEMENT_PATTERNS.join(" | "),
        equipment: "dumbbell",
        sets: 3,
        reps: 10,
        durationSec: null,
        restSec: 60,
        load: "1×35 lb dumbbell",
        cues: ["Elbows inside knees", "Drive through mid-foot"],
        muscles: ["quads", "glutes", "core"],
        perSide: false,
      },
      null,
      2,
    ),
    "",
    "Rules:",
    "- pattern must be one of the listed values; pick the closest movement shape (e.g. bench press → push-horizontal, overhead press → push-vertical, row → pull-horizontal, pull-up/lat pulldown → pull-vertical, deadlift/RDL/kettlebell swing → hinge, burpee/jump rope → jump, farmer walk → carry, treadmill/bike/rower → cardio, yoga/mobility → stretch, sit-up → crunch, side plank/dead bug/hollow hold → plank, tricep pushdown/skull crusher/leg extension → extension).",
    "- muscles must be from: " + MUSCLES.join(", ") + ".",
    "- Either reps (integer) or durationSec (integer seconds) per set, never both; holds, carries and cardio use durationSec.",
    "- restSec is the rest after each set (0–180). Warm-up and cool-down items are single sets with restSec 0.",
    "- 2–5 short cues per exercise. Loads should reference the weights you actually saw.",
    "- Always include 2–4 warm-up movements (timed, 20–45 s) and 2–3 cool-down stretches (timed, 20–40 s).",
    "- Keep total time (work + rest + warm-up + cool-down) inside the requested minutes.",
    "- If recent sessions are listed, vary the selection so the week is balanced.",
  ].join("\n");
}

export function buildUserPrompt(req: PlanRequest): string {
  const lines = [
    `Session length: ${req.minutes} minutes.`,
    `Focus: ${req.focus}.`,
    `Intensity: ${req.intensity}.`,
  ];
  if (req.knownEquipment.length) {
    lines.push(
      "Confirmed equipment (use in addition to anything in the photos): " +
        req.knownEquipment
          .map((e) => (e.detail ? `${e.name} (${e.detail})` : e.name))
          .join("; ") +
        ".",
    );
  }
  if (req.hasPhotos) {
    lines.push("The photos above show the equipment available right now.");
  } else if (req.knownEquipment.length === 0) {
    lines.push("No equipment photos or list — assume bodyweight only.");
  }
  if (req.notes.trim()) lines.push(`Notes from the athlete: ${req.notes.trim()}`);
  if (req.recentTitles.length) {
    lines.push("Recent sessions:\n" + req.recentTitles.map((t) => `- ${t}`).join("\n"));
  }
  return lines.join("\n");
}

// ---- Normalizer -----------------------------------------------------------
// Claude's JSON is close but not trustworthy. Coerce every field into the
// exact shape the player expects so a stray string never crashes a session.

function str(v: unknown, fallback = ""): string {
  return typeof v === "string" ? v.trim() : fallback;
}
function int(v: unknown, fallback: number, min: number, max: number): number {
  const n = typeof v === "number" ? v : typeof v === "string" ? Number(v) : NaN;
  if (!Number.isFinite(n)) return fallback;
  return Math.min(max, Math.max(min, Math.round(n)));
}
function intOrNull(v: unknown, min: number, max: number): number | null {
  if (v === null || v === undefined || v === "") return null;
  const n = int(v, NaN, min, max);
  return Number.isFinite(n) ? n : null;
}
function oneOf<T extends string>(v: unknown, options: readonly T[], fallback: T): T {
  return typeof v === "string" && (options as readonly string[]).includes(v)
    ? (v as T)
    : fallback;
}
function strList(v: unknown, max: number): string[] {
  if (!Array.isArray(v)) return [];
  return v
    .map((x) => str(x))
    .filter(Boolean)
    .slice(0, max);
}

let idCounter = 0;
function nextId(prefix: string): string {
  idCounter += 1;
  return `${prefix}-${idCounter}-${Math.random().toString(36).slice(2, 7)}`;
}

export function normalizeExercise(raw: unknown, section: string): Exercise | null {
  // A bare string ("Arm circles") still makes a usable timed movement.
  if (typeof raw === "string") {
    raw = raw.trim() ? { name: raw, pattern: "stretch", durationSec: 30 } : null;
  }
  if (!raw || typeof raw !== "object") return null;
  const r = raw as Record<string, unknown>;
  const name = str(r.name);
  if (!name) return null;
  let reps = intOrNull(r.reps, 1, 200);
  let durationSec = intOrNull(r.durationSec, 5, 3600);
  if (reps === null && durationSec === null) reps = 10;
  if (reps !== null && durationSec !== null) {
    // Prefer the timed form for holds/cardio, reps otherwise.
    const pattern = str(r.pattern);
    if (["plank", "carry", "cardio", "stretch"].includes(pattern)) reps = null;
    else durationSec = null;
  }
  const muscles = Array.isArray(r.muscles)
    ? (r.muscles.filter(
        (m): m is Muscle => typeof m === "string" && (MUSCLES as readonly string[]).includes(m),
      ) as Muscle[])
    : [];
  return {
    id: nextId(section),
    name,
    pattern: oneOf(r.pattern, MOVEMENT_PATTERNS, "stretch"),
    equipment: str(r.equipment, "bodyweight") || "bodyweight",
    sets: int(r.sets, 1, 1, 12),
    reps,
    durationSec,
    restSec: int(r.restSec, 0, 0, 300),
    load: str(r.load, "bodyweight") || "bodyweight",
    cues: strList(r.cues, 6),
    muscles: Array.from(new Set(muscles)).slice(0, 6),
    perSide: r.perSide === true,
  };
}

function exerciseList(v: unknown, section: string, max: number): Exercise[] {
  if (!Array.isArray(v)) return [];
  return v
    .map((x) => normalizeExercise(x, section))
    .filter((x): x is Exercise => x !== null)
    .slice(0, max);
}

export function normalizePlanResponse(raw: unknown): PlanResponse {
  if (!raw || typeof raw !== "object") throw new Error("plan is not an object");
  const r = raw as Record<string, unknown>;
  const equipment: EquipmentItem[] = Array.isArray(r.equipment)
    ? r.equipment
        .map((e): EquipmentItem | null => {
          if (typeof e === "string") return e.trim() ? { name: e.trim() } : null;
          if (!e || typeof e !== "object") return null;
          const o = e as Record<string, unknown>;
          const name = str(o.name);
          if (!name) return null;
          const detail = str(o.detail);
          return detail ? { name, detail } : { name };
        })
        .filter((e): e is EquipmentItem => e !== null)
        .slice(0, 40)
    : [];

  const p = (r.plan && typeof r.plan === "object" ? r.plan : {}) as Record<string, unknown>;
  const blocksRaw = Array.isArray(p.blocks) ? p.blocks : [];
  const blocks: Block[] = blocksRaw
    .map((b, i): Block | null => {
      if (!b || typeof b !== "object") return null;
      const o = b as Record<string, unknown>;
      const exercises = exerciseList(o.exercises, "main", 8);
      if (exercises.length === 0) return null;
      return {
        name: str(o.name) || `Block ${i + 1}`,
        type: oneOf(o.type, ["straight", "superset", "circuit"] as const, "straight"),
        exercises,
      };
    })
    .filter((b): b is Block => b !== null)
    .slice(0, 6);

  if (blocks.length === 0) throw new Error("plan has no exercises");

  const warmup = exerciseList(p.warmup, "warmup", 6).map((e) => ({ ...e, sets: 1, restSec: 0 }));
  const cooldown = exerciseList(p.cooldown, "cooldown", 6).map((e) => ({
    ...e,
    sets: 1,
    restSec: 0,
  }));

  return {
    equipment,
    plan: {
      title: str(p.title) || "Today's workout",
      summary: str(p.summary),
      focus: oneOf(p.focus, FOCUS_OPTIONS, "full-body"),
      estimatedMinutes: int(p.estimatedMinutes, 30, 5, 180),
      warmup,
      blocks,
      cooldown,
    },
  };
}

// ---- Session model (client) ----------------------------------------------
// The player walks a flat list of "steps" derived from the plan so supersets
// and circuits interleave correctly. Each step is one set of one exercise.

export type Step = {
  key: string;
  section: "warmup" | "main" | "cooldown";
  blockName: string;
  blockType: Block["type"];
  exercise: Exercise;
  setIndex: number; // 0-based
  setCount: number;
  /** Rest after this set; 0 for the final step of the workout. */
  restSec: number;
};

export function flattenPlan(plan: WorkoutPlan): Step[] {
  const steps: Step[] = [];
  const push = (
    section: Step["section"],
    blockName: string,
    blockType: Block["type"],
    ex: Exercise,
    setIndex: number,
  ) =>
    steps.push({
      key: `${ex.id}:${setIndex}`,
      section,
      blockName,
      blockType,
      exercise: ex,
      setIndex,
      setCount: ex.sets,
      restSec: ex.restSec,
    });

  for (const ex of plan.warmup) push("warmup", "Warm-up", "straight", ex, 0);
  for (const b of plan.blocks) {
    if (b.type === "straight") {
      for (const ex of b.exercises) for (let s = 0; s < ex.sets; s++) push("main", b.name, b.type, ex, s);
    } else {
      // Supersets/circuits: round-robin through exercises for max(sets) rounds.
      const rounds = Math.max(...b.exercises.map((e) => e.sets));
      for (let s = 0; s < rounds; s++) {
        for (const ex of b.exercises) if (s < ex.sets) push("main", b.name, b.type, ex, s);
      }
    }
  }
  for (const ex of plan.cooldown) push("cooldown", "Cool-down", "straight", ex, 0);
  if (steps.length) steps[steps.length - 1].restSec = 0;
  return steps;
}

export type SetLog = {
  stepKey: string;
  exerciseId: string;
  exerciseName: string;
  setIndex: number;
  reps: number | null;
  durationSec: number | null;
  load: string;
  completedAt: number;
};

export type WorkoutSession = {
  id: string;
  plan: WorkoutPlan;
  equipment: EquipmentItem[];
  startedAt: number;
  finishedAt: number | null;
  stepIndex: number;
  logs: SetLog[];
  /** Absolute ms timestamp the current rest/hold ends; null when idle. */
  timerEndsAt: number | null;
  timerKind: "work" | "rest" | null;
  timerPausedRemainingMs: number | null;
};

export function estimatePlanMinutes(plan: WorkoutPlan): number {
  let sec = 0;
  for (const s of flattenPlan(plan)) {
    const e = s.exercise;
    const work = e.durationSec ?? (e.reps ?? 10) * 3;
    sec += (e.perSide ? work * 2 : work) + s.restSec;
  }
  return Math.max(1, Math.round(sec / 60));
}

export function formatClock(totalSec: number): string {
  const s = Math.max(0, Math.floor(totalSec));
  const m = Math.floor(s / 60);
  const r = s % 60;
  return `${m}:${r.toString().padStart(2, "0")}`;
}
