// Diet from the person's food app (NutritionDay, sent by the Apple Health
// Shortcut), reduced for the Health page and its chat: daily averages over the
// last 7, 14 and 28 days and the latest days logged. A day they didn't log is
// missing, never zero, and each average only counts the days that have that
// value. Framework-free like training.ts.

export const NUTRITION_WINDOW_DAYS = 28;
const RECENT_DAYS = 14;
const DAY = 86_400_000;

const FIELDS = ["caloriesKcal", "proteinG", "carbsG", "fatG", "saturatedFatG", "fiberG", "sugarG", "sodiumMg"] as const;
type Field = (typeof FIELDS)[number];

export type NutritionDayRow = { date: string; app: string | null } & Record<Field, number | null>;

export type NutritionAverages = {
  /** Days logged in the window. */
  days: number;
  /** Protein per pound of their latest weight, when both are known. */
  proteinGPerLb: number | null;
} & Record<Field, number | null>;

export type NutritionSummary = {
  windowDays: number;
  daysLogged: number;
  /** The food app named on the latest day that named one. */
  app: string | null;
  latestDay: string | null;
  averages: { last7: NutritionAverages; last14: NutritionAverages; last28: NutritionAverages };
  /** The latest logged days, newest first. */
  recent: Pick<NutritionDayRow, "date" | "caloriesKcal" | "proteinG" | "carbsG" | "fatG" | "saturatedFatG" | "fiberG">[];
};

const round = (n: number, places: number) => Math.round(n * 10 ** places) / 10 ** places;

function mean(values: (number | null)[]): number | null {
  const known = values.filter((v): v is number => v !== null);
  return known.length ? known.reduce((sum, v) => sum + v, 0) / known.length : null;
}

/** Calendar days ending today (UTC), the way the Workout tab counts its weeks. */
function averagesOver(rows: NutritionDayRow[], days: number, now: Date, latestWeightLb: number | null): NutritionAverages {
  const start = new Date(now.getTime() - (days - 1) * DAY).toISOString().slice(0, 10);
  const inWindow = rows.filter((r) => r.date >= start);
  const means = Object.fromEntries(FIELDS.map((f) => [f, mean(inWindow.map((r) => r[f]))])) as Record<Field, number | null>;
  const protein = means.proteinG;
  return {
    days: inWindow.length,
    ...(Object.fromEntries(FIELDS.map((f) => [f, means[f] === null ? null : round(means[f], 1)])) as Record<Field, number | null>),
    // From the unrounded mean, so the ratio isn't rounded twice.
    proteinGPerLb: protein !== null && latestWeightLb ? round(protein / latestWeightLb, 2) : null,
  };
}

export function summarizeNutrition(days: NutritionDayRow[], latestWeightLb: number | null, now: Date): NutritionSummary {
  const start = new Date(now.getTime() - (NUTRITION_WINDOW_DAYS - 1) * DAY).toISOString().slice(0, 10);
  const rows = days.filter((d) => d.date >= start).sort((a, b) => b.date.localeCompare(a.date));
  return {
    windowDays: NUTRITION_WINDOW_DAYS,
    daysLogged: rows.length,
    app: rows.find((r) => r.app)?.app ?? null,
    latestDay: rows[0]?.date ?? null,
    averages: {
      last7: averagesOver(rows, 7, now, latestWeightLb),
      last14: averagesOver(rows, 14, now, latestWeightLb),
      last28: averagesOver(rows, NUTRITION_WINDOW_DAYS, now, latestWeightLb),
    },
    recent: rows.slice(0, RECENT_DAYS).map(({ date, caloriesKcal, proteinG, carbsG, fatG, saturatedFatG, fiberG }) => ({
      date,
      caloriesKcal,
      proteinG,
      carbsG,
      fatG,
      saturatedFatG,
      fiberG,
    })),
  };
}
