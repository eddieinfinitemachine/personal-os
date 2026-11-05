import { describe, expect, it } from "vitest";
import { summarizeNutrition, type NutritionDayRow } from "./nutrition";

const now = new Date("2030-06-15T12:00:00Z");
const DAY = 86_400_000;
const daysAgo = (n: number) => new Date(now.getTime() - n * DAY).toISOString().slice(0, 10);

const row = (date: string, extra: Partial<NutritionDayRow> = {}): NutritionDayRow => ({
  date,
  caloriesKcal: 2000,
  proteinG: 140,
  carbsG: 200,
  fatG: 70,
  saturatedFatG: 20,
  fiberG: 30,
  sugarG: 45,
  sodiumMg: 2200,
  app: null,
  ...extra,
});

describe("summarizeNutrition", () => {
  it("averages each window over the days logged in it", () => {
    const rows = [
      row(daysAgo(0), { caloriesKcal: 2200 }),
      row(daysAgo(6), { caloriesKcal: 1800 }),
      row(daysAgo(7), { caloriesKcal: 2600 }),
      row(daysAgo(13), { caloriesKcal: 3000 }),
      row(daysAgo(20), { caloriesKcal: 1000 }),
      row(daysAgo(27), { caloriesKcal: 1400 }),
      // Outside the 28 days.
      row(daysAgo(28), { caloriesKcal: 9000 }),
    ];
    const { averages, daysLogged, windowDays } = summarizeNutrition(rows, null, now);
    expect(windowDays).toBe(28);
    expect(daysLogged).toBe(6);
    expect([averages.last7.days, averages.last7.caloriesKcal]).toEqual([2, 2000]);
    expect([averages.last14.days, averages.last14.caloriesKcal]).toEqual([4, 2400]);
    expect([averages.last28.days, averages.last28.caloriesKcal]).toEqual([6, 2000]);
  });

  it("ignores a missing value per field rather than counting it as zero", () => {
    const { last7 } = summarizeNutrition(
      [row(daysAgo(0), { fiberG: null, sodiumMg: null }), row(daysAgo(1), { fiberG: 25, sodiumMg: null }), row(daysAgo(2), { fiberG: 32 })],
      null,
      now,
    ).averages;
    expect(last7.days).toBe(3);
    expect(last7.fiberG).toBe(28.5);
    expect(last7.sodiumMg).toBe(2200);
    expect(summarizeNutrition([row(daysAgo(0), { sugarG: null })], null, now).averages.last7.sugarG).toBeNull();
  });

  it("rounds averages to one decimal", () => {
    const { last7 } = summarizeNutrition([row(daysAgo(0), { proteinG: 100 }), row(daysAgo(1), { proteinG: 101 }), row(daysAgo(2), { proteinG: 101 })], null, now).averages;
    expect(last7.proteinG).toBe(100.7);
  });

  it("works out protein per pound of the latest weight", () => {
    const rows = [row(daysAgo(0), { proteinG: 150 }), row(daysAgo(1), { proteinG: 160 })];
    expect(summarizeNutrition(rows, 180, now).averages.last7.proteinGPerLb).toBe(0.86);
    expect(summarizeNutrition(rows, null, now).averages.last7.proteinGPerLb).toBeNull();
    const noProtein = [row(daysAgo(0), { proteinG: null })];
    expect(summarizeNutrition(noProtein, 180, now).averages.last7.proteinGPerLb).toBeNull();
  });

  it("lists the last 14 logged days newest first, and the latest app named", () => {
    const rows = Array.from({ length: 20 }, (_, i) => row(daysAgo(i), { app: i === 3 ? "Food App" : i === 5 ? "Older App" : null }));
    const summary = summarizeNutrition([...rows].reverse(), null, now);
    expect(summary.latestDay).toBe(daysAgo(0));
    expect(summary.app).toBe("Food App");
    expect(summary.recent).toHaveLength(14);
    expect(summary.recent[0]).toEqual({
      date: daysAgo(0),
      caloriesKcal: 2000,
      proteinG: 140,
      carbsG: 200,
      fatG: 70,
      saturatedFatG: 20,
      fiberG: 30,
    });
    expect(summary.recent.at(-1)?.date).toBe(daysAgo(13));
  });

  it("is zeros and nulls with nothing logged", () => {
    const empty = {
      days: 0,
      caloriesKcal: null,
      proteinG: null,
      carbsG: null,
      fatG: null,
      saturatedFatG: null,
      fiberG: null,
      sugarG: null,
      sodiumMg: null,
      proteinGPerLb: null,
    };
    expect(summarizeNutrition([], 180, now)).toEqual({
      windowDays: 28,
      daysLogged: 0,
      app: null,
      latestDay: null,
      averages: { last7: empty, last14: empty, last28: empty },
      recent: [],
    });
  });
});
