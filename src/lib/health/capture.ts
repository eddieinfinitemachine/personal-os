// What the Apple Health Shortcut sends (POST /api/capture/health), read into
// days of diet and vitals readings. Shortcuts is loose about shapes: numbers
// may arrive as strings with thousands separators or a unit ("1,842.5 kcal"),
// dates in several formats, and keys in a few spellings, so everything here is
// lenient about form and strict about range. Framework-free; the route writes.

export const CAPTURE_LIMITS = { maxBodyBytes: 256 * 1024, maxDays: 60, maxReadings: 100 } as const;

const DAY = 86_400_000;
const KJ_PER_KCAL = 4.184;
const LB_PER_KG = 2.20462;

export class CaptureError extends Error {
  constructor(
    message: string,
    readonly status = 400,
  ) {
    super(message);
    this.name = "CaptureError";
  }
}

export type NutritionDayInput = {
  /** YYYY-MM-DD, the day as the phone saw it. */
  date: string;
  caloriesKcal: number | null;
  proteinG: number | null;
  carbsG: number | null;
  fatG: number | null;
  saturatedFatG: number | null;
  fiberG: number | null;
  sugarG: number | null;
  sodiumMg: number | null;
};

export type ReadingInput = { kind: string; value: number; unit: string; /** ISO */ at: string };

export type HealthCapture = { app: string | null; days: NutritionDayInput[]; readings: ReadingInput[] };

type Field = Exclude<keyof NutritionDayInput, "date">;
type Quantity = { n: number; unit: string };

/** "Dietary Energy", "dietary_energy" and "dietaryEnergy" are the same key. */
const keyOf = (key: string) => key.toLowerCase().replace(/[^a-z0-9]/g, "");

const NUTRIENT_KEYS: Record<Field, string[]> = {
  caloriesKcal: ["calories", "kcal", "energy", "dietaryenergy", "calorieskcal"],
  proteinG: ["protein", "proteing"],
  carbsG: ["carbs", "carbohydrates", "carbsg"],
  fatG: ["fat", "totalfat", "fatg"],
  saturatedFatG: ["saturatedfat", "satfat", "saturatedfatg"],
  fiberG: ["fiber", "fibre", "fiberg"],
  sugarG: ["sugar", "sugarg"],
  sodiumMg: ["sodium", "sodiummg"],
};
const FIELDS = Object.keys(NUTRIENT_KEYS) as Field[];
const GRAMS_MAX = 2000;
const NUTRIENT_MAX: Record<Field, number> = {
  caloriesKcal: 20_000,
  proteinG: GRAMS_MAX,
  carbsG: GRAMS_MAX,
  fatG: GRAMS_MAX,
  saturatedFatG: GRAMS_MAX,
  fiberG: GRAMS_MAX,
  sugarG: GRAMS_MAX,
  sodiumMg: 50_000,
};

// Kinds as BiometricReading already stores them, with the unit each is kept in,
// a sane range (outside it the reading is dropped) and a converter from the
// unit the Shortcut wrote, when it wrote one.
type Kind = { unit: string; min: number; max: number; convert: (q: Quantity) => number | null };
const KINDS: Record<string, Kind> = {
  weight: { unit: "lb", min: 50, max: 1000, convert: ({ n, unit }) => (unit === "kg" ? n * LB_PER_KG : unit === "" || unit.startsWith("lb") ? n : null) },
  // HealthKit keeps body fat as a fraction; Shortcuts usually shows a percentage.
  bodyFat: { unit: "%", min: 1, max: 80, convert: ({ n }) => (n > 0 && n < 1 ? n * 100 : n) },
  rhr: { unit: "bpm", min: 20, max: 250, convert: ({ n }) => n },
  hrv: { unit: "ms", min: 1, max: 500, convert: ({ n }) => n },
  vo2: { unit: "mL/kg/min", min: 5, max: 100, convert: ({ n }) => n },
  steps: { unit: "steps", min: 0, max: 200_000, convert: ({ n }) => Math.round(n) },
  sleep: { unit: "h", min: 0, max: 24, convert: ({ n, unit }) => (unit.startsWith("min") ? n / 60 : n) },
};
const KIND_ALIASES: Record<string, string> = {
  weight: "weight",
  bodymass: "weight",
  bodyfat: "bodyFat",
  bodyfatpercentage: "bodyFat",
  rhr: "rhr",
  restingheartrate: "rhr",
  hrv: "hrv",
  heartratevariability: "hrv",
  vo2: "vo2",
  vo2max: "vo2",
  steps: "steps",
  stepcount: "steps",
  sleep: "sleep",
  sleephours: "sleep",
  sleepanalysis: "sleep",
};

function object(value: unknown): Record<string, unknown> | null {
  return value && typeof value === "object" && !Array.isArray(value) ? (value as Record<string, unknown>) : null;
}

/** The first value under any of `keys` (already normalised), whatever its spelling in the body. */
function lookup(source: Record<string, unknown>, keys: string[]): unknown {
  for (const [key, value] of Object.entries(source)) if (keys.includes(keyOf(key)) && value != null && value !== "") return value;
  return undefined;
}

/** 1842.5, "1,842.5", "1842.5 kcal", "7700 kJ" or { value, unit }. Unit lowercased, "" when absent. */
function quantity(value: unknown, unitHint?: unknown): Quantity | null {
  const hint = typeof unitHint === "string" ? unitHint.trim().toLowerCase() : "";
  if (typeof value === "number") return Number.isFinite(value) ? { n: value, unit: hint } : null;
  if (typeof value === "string") {
    const match = value.trim().match(/^(-?(?:\d{1,3}(?:,\d{3})+|\d+)?(?:\.\d+)?)\s*([^\d\s,].*)?$/);
    if (!match || !/\d/.test(match[1])) return null;
    const n = parseFloat(match[1].replace(/,/g, ""));
    return Number.isFinite(n) ? { n, unit: match[2]?.trim().toLowerCase() || hint } : null;
  }
  const inner = object(value);
  return inner ? quantity(inner.value ?? inner.quantity, inner.unit ?? unitHint) : null;
}

function nutrient(field: Field, q: Quantity | null): number | null {
  if (!q) return null;
  let n = q.n;
  if (field === "caloriesKcal" && q.unit.startsWith("kj")) n /= KJ_PER_KCAL;
  if (field === "sodiumMg" && q.unit === "g") n *= 1000;
  return n >= 0 && n <= NUTRIENT_MAX[field] ? n : null;
}

const pad = (n: number) => String(n).padStart(2, "0");

/** "2026-11-04", "2026-11-04T07:00:00-05:00" (the phone's own date) or "Nov 4, 2026" → YYYY-MM-DD. */
export function dayOf(value: unknown): string | null {
  if (typeof value !== "string") return null;
  const text = value.trim();
  const iso = text.match(/^(\d{4})-(\d{2})-(\d{2})(?:$|[T\s])/);
  let year: number, month: number, date: number;
  if (iso) {
    [year, month, date] = [Number(iso[1]), Number(iso[2]), Number(iso[3])];
  } else {
    // Shortcuts' long formats say "November 4, 2026 at 11:30 PM". A year is
    // required: Date reads a bare "4" as April 2001.
    if (!/\b\d{4}\b/.test(text)) return null;
    const parsed = new Date(text.replace(/\s+at\s+/i, " "));
    if (Number.isNaN(parsed.getTime())) return null;
    [year, month, date] = [parsed.getFullYear(), parsed.getMonth() + 1, parsed.getDate()];
  }
  const check = new Date(Date.UTC(year, month - 1, date));
  if (year < 2000 || year > 2100 || check.getUTCMonth() !== month - 1 || check.getUTCDate() !== date) return null;
  return `${year}-${pad(month)}-${pad(date)}`;
}

/** A full timestamp keeps its instant; a bare day reads as noon UTC, so it stays on that day. */
function instantOf(value: unknown): string | null {
  if (typeof value === "string" && /\d{1,2}:\d{2}/.test(value) && /^\d{4}-\d{2}-\d{2}T/.test(value.trim())) {
    const t = new Date(value.trim());
    return Number.isNaN(t.getTime()) ? null : t.toISOString();
  }
  const day = dayOf(value);
  return day ? `${day}T12:00:00.000Z` : null;
}

function readDay(source: Record<string, unknown>): NutritionDayInput | null {
  const date = dayOf(lookup(source, ["date", "day"]));
  if (!date) return null;
  const values = Object.fromEntries(
    FIELDS.map((field) => [field, nutrient(field, quantity(lookup(source, NUTRIENT_KEYS[field])))]),
  ) as Record<Field, number | null>;
  return FIELDS.some((field) => values[field] !== null) ? { date, ...values } : null;
}

function reading(kindName: unknown, value: unknown, unit: unknown, at: string | null): ReadingInput | null {
  if (typeof kindName !== "string" || !at) return null;
  const kind = KIND_ALIASES[keyOf(kindName)];
  const q = quantity(value, unit);
  if (!kind || !q) return null;
  const spec = KINDS[kind];
  const n = spec.convert(q);
  if (n === null || !Number.isFinite(n) || n < spec.min || n > spec.max) return null;
  return { kind, value: Math.round(n * 100) / 100, unit: spec.unit, at };
}

/** The Shortcut's body → days of diet and vitals readings. Throws CaptureError on a body it can't read. */
export function parseHealthCapture(raw: unknown, now: Date = new Date()): HealthCapture {
  const body = Array.isArray(raw) ? { days: raw } : object(raw);
  if (!body) throw new CaptureError("Expected a JSON object");

  const appValue = lookup(body, ["app", "appname", "foodapp"]);
  const app = typeof appValue === "string" && appValue.trim() ? appValue.trim().slice(0, 60) : null;

  // A list of days, then the flat day at the top level; a later copy of a day wins.
  const daySources = [...(Array.isArray(body.days) ? body.days : []).map(object), body];
  const byDate = new Map<string, NutritionDayInput>();
  for (const source of daySources) {
    const day = source && readDay(source);
    if (day) byDate.set(day.date, day);
  }
  if (byDate.size > CAPTURE_LIMITS.maxDays)
    throw new CaptureError(`Too many days: send at most ${CAPTURE_LIMITS.maxDays}`, 413);

  // Flat vitals for the body's day (or today), then the readings list; one per kind per UTC day, last wins.
  const flatAt = `${dayOf(lookup(body, ["date", "day"])) ?? now.toISOString().slice(0, 10)}T12:00:00.000Z`;
  const candidates: (ReadingInput | null)[] = [];
  for (const alias of Object.keys(KIND_ALIASES)) {
    const value = body[Object.keys(body).find((key) => keyOf(key) === alias) ?? ""];
    if (value != null && value !== "") candidates.push(reading(alias, value, undefined, flatAt));
  }
  for (const item of Array.isArray(body.readings) ? body.readings : []) {
    const entry = object(item);
    if (!entry) continue;
    candidates.push(
      reading(lookup(entry, ["kind", "type"]), lookup(entry, ["value"]), lookup(entry, ["unit"]), instantOf(lookup(entry, ["at", "date"]))),
    );
  }
  const byKindDay = new Map<string, ReadingInput>();
  for (const r of candidates) if (r) byKindDay.set(`${r.kind}|${r.at.slice(0, 10)}`, r);
  if (byKindDay.size > CAPTURE_LIMITS.maxReadings)
    throw new CaptureError(`Too many readings: send at most ${CAPTURE_LIMITS.maxReadings}`, 413);

  return {
    app,
    days: [...byDate.values()].sort((a, b) => a.date.localeCompare(b.date)),
    readings: [...byKindDay.values()],
  };
}

/** Midnight UTC that starts the day of an ISO instant, and the next one. */
export function utcDayBounds(at: string): { gte: Date; lt: Date } {
  const start = new Date(`${at.slice(0, 10)}T00:00:00.000Z`);
  return { gte: start, lt: new Date(start.getTime() + DAY) };
}
