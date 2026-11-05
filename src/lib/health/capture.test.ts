import { describe, expect, it } from "vitest";
import { CaptureError, dayOf, parseHealthCapture, utcDayBounds } from "./capture";

const now = new Date("2030-06-15T18:00:00Z");
const parse = (raw: unknown) => parseHealthCapture(raw, now);
const empty = { caloriesKcal: null, proteinG: null, carbsG: null, fatG: null, saturatedFatG: null, fiberG: null, sugarG: null, sodiumMg: null };

describe("parseHealthCapture: days", () => {
  it("reads the flat day the Shortcut's dictionary sends", () => {
    const { app, days } = parse({
      app: "Food App",
      date: "2030-06-14",
      calories: 2100,
      protein: 150,
      carbs: 210,
      fat: 70,
      saturatedFat: 22,
      fiber: 31,
      sugar: 48,
      sodium: 2300,
    });
    expect(app).toBe("Food App");
    expect(days).toEqual([
      { date: "2030-06-14", caloriesKcal: 2100, proteinG: 150, carbsG: 210, fatG: 70, saturatedFatG: 22, fiberG: 31, sugarG: 48, sodiumMg: 2300 },
    ]);
  });

  it.each([
    ["calories", "caloriesKcal"],
    ["kcal", "caloriesKcal"],
    ["energy", "caloriesKcal"],
    ["dietaryEnergy", "caloriesKcal"],
    ["Dietary Energy", "caloriesKcal"],
    ["protein", "proteinG"],
    ["carbs", "carbsG"],
    ["carbohydrates", "carbsG"],
    ["fat", "fatG"],
    ["totalFat", "fatG"],
    ["total_fat", "fatG"],
    ["saturatedFat", "saturatedFatG"],
    ["satFat", "saturatedFatG"],
    ["fiber", "fiberG"],
    ["fibre", "fiberG"],
    ["sugar", "sugarG"],
    ["sodium", "sodiumMg"],
  ])("accepts %s as %s", (key, field) => {
    expect(parse({ date: "2030-06-14", [key]: 42 }).days).toEqual([{ ...empty, date: "2030-06-14", [field]: 42 }]);
  });

  it("reads numbers sent as strings, with thousands separators and units", () => {
    const [day] = parse({ date: "2030-06-14", calories: "1,842.5", protein: "151.2 g", fiber: " 30 ", sodium: "2,310 mg" }).days;
    expect(day).toMatchObject({ caloriesKcal: 1842.5, proteinG: 151.2, fiberG: 30, sodiumMg: 2310 });
    expect(parse({ date: "2030-06-14", calories: "1842.5 kcal" }).days[0].caloriesKcal).toBe(1842.5);
    expect(parse({ date: "2030-06-14", calories: { value: 1900, unit: "kcal" } }).days[0].caloriesKcal).toBe(1900);
  });

  it("converts kJ to kcal and sodium in grams to mg, only when the unit says so", () => {
    expect(parse({ date: "2030-06-14", energy: "7700 kJ" }).days[0].caloriesKcal).toBeCloseTo(7700 / 4.184, 6);
    expect(parse({ date: "2030-06-14", energy: "7,700 kJ" }).days[0].caloriesKcal).toBeCloseTo(7700 / 4.184, 6);
    expect(parse({ date: "2030-06-14", sodium: "2.3 g" }).days[0].sodiumMg).toBe(2300);
    expect(parse({ date: "2030-06-14", sodium: "2.3" }).days[0].sodiumMg).toBe(2.3);
    expect(parse({ date: "2030-06-14", energy: 7700 }).days[0].caloriesKcal).toBe(7700);
  });

  it("drops values out of range, unreadable or negative, and keeps the rest", () => {
    const [day] = parse({
      date: "2030-06-14",
      calories: 25_000,
      protein: 2001,
      carbs: -5,
      fat: "lots",
      fiber: "1842,5",
      sodium: 50_001,
      sugar: 2000,
    }).days;
    expect(day).toEqual({ ...empty, date: "2030-06-14", sugarG: 2000 });
    expect(parse({ date: "2030-06-14", calories: 20_000, sodium: 50_000 }).days[0]).toMatchObject({ caloriesKcal: 20_000, sodiumMg: 50_000 });
  });

  it("rejects a day without a date or without any value", () => {
    expect(parse({ calories: 2000 }).days).toEqual([]);
    expect(parse({ date: "2030-06-14", calories: "", protein: null }).days).toEqual([]);
    expect(parse({ date: "not a day", calories: 2000 }).days).toEqual([]);
  });

  it("reads a list of days, deduped by date with the last copy winning", () => {
    const { days } = parse({
      days: [
        { date: "2030-06-13", calories: 1900 },
        { date: "2030-06-14", calories: 1500 },
        { date: "2030-06-14T21:00:00-05:00", calories: 2200 },
        "junk",
      ],
    });
    expect(days.map((d) => [d.date, d.caloriesKcal])).toEqual([
      ["2030-06-13", 1900],
      ["2030-06-14", 2200],
    ]);
    // A bare array is a list of days too.
    expect(parse([{ date: "2030-06-13", protein: 120 }]).days).toHaveLength(1);
  });

  it("caps a request at 60 days", () => {
    const day = (i: number) => ({ date: new Date(Date.UTC(2030, 0, 1 + i)).toISOString().slice(0, 10), calories: 2000 });
    expect(parse({ days: Array.from({ length: 60 }, (_, i) => day(i)) }).days).toHaveLength(60);
    // Duplicates count once.
    expect(parse({ days: [...Array.from({ length: 60 }, (_, i) => day(i)), day(0)] }).days).toHaveLength(60);
    expect(() => parse({ days: Array.from({ length: 61 }, (_, i) => day(i)) })).toThrow(
      expect.objectContaining({ status: 413 }),
    );
  });

  it("keeps the app name short and drops a blank one", () => {
    expect(parse({ app: "  " }).app).toBeNull();
    expect(parse({ app: 7 }).app).toBeNull();
    expect(parse({ app: "x".repeat(80) }).app).toHaveLength(60);
  });
});

describe("dayOf", () => {
  it("reads the formats Shortcuts sends", () => {
    expect(dayOf("2026-11-04")).toBe("2026-11-04");
    expect(dayOf("2026-11-04T07:00:00-05:00")).toBe("2026-11-04");
    // The phone's own date, even when UTC has moved on.
    expect(dayOf("2026-11-04T23:30:00-05:00")).toBe("2026-11-04");
    expect(dayOf("Nov 4, 2026")).toBe("2026-11-04");
    expect(dayOf("November 4, 2026 at 11:30 PM")).toBe("2026-11-04");
  });

  it("refuses what isn't a day", () => {
    expect(dayOf("2026-02-30")).toBeNull();
    expect(dayOf("4")).toBeNull();
    expect(dayOf("yesterday")).toBeNull();
    expect(dayOf(20261104)).toBeNull();
    expect(dayOf("1999-12-31")).toBeNull();
  });
});

describe("parseHealthCapture: readings", () => {
  it("reads flat vitals for the body's day, normalised to the stored kinds", () => {
    const { readings } = parse({
      date: "2030-06-14",
      weight: 182.4,
      bodyFat: "18.5%",
      restingHeartRate: "52 bpm",
      hrv: 61,
      vo2Max: 47.2,
      steps: "10,432",
      sleepHours: 7.25,
    });
    const at = "2030-06-14T12:00:00.000Z";
    expect(readings).toEqual([
      { kind: "weight", value: 182.4, unit: "lb", at },
      { kind: "bodyFat", value: 18.5, unit: "%", at },
      { kind: "rhr", value: 52, unit: "bpm", at },
      { kind: "hrv", value: 61, unit: "ms", at },
      { kind: "vo2", value: 47.2, unit: "mL/kg/min", at },
      { kind: "steps", value: 10432, unit: "steps", at },
      { kind: "sleep", value: 7.25, unit: "h", at },
    ]);
  });

  it("accepts the short spellings and dates flat vitals today without a date", () => {
    const { readings } = parse({ rhr: 55, vo2: 44, sleep: 7 });
    expect(readings.map((r) => [r.kind, r.at])).toEqual([
      ["rhr", "2030-06-15T12:00:00.000Z"],
      ["vo2", "2030-06-15T12:00:00.000Z"],
      ["sleep", "2030-06-15T12:00:00.000Z"],
    ]);
  });

  it("converts kg to lb, sleep minutes to hours and a body-fat fraction to a percentage", () => {
    const { readings } = parse({ date: "2030-06-14", weight: "82.5 kg", sleep: "450 min", bodyFat: 0.185 });
    expect(readings).toEqual([
      { kind: "weight", value: 181.88, unit: "lb", at: "2030-06-14T12:00:00.000Z" },
      { kind: "bodyFat", value: 18.5, unit: "%", at: "2030-06-14T12:00:00.000Z" },
      { kind: "sleep", value: 7.5, unit: "h", at: "2030-06-14T12:00:00.000Z" },
    ]);
  });

  it("reads a readings list with its own times and units", () => {
    const { readings } = parse({
      readings: [
        { kind: "Heart Rate Variability", value: "58", unit: "ms", at: "2030-06-14T07:10:00-04:00" },
        { type: "weight", value: 80, unit: "kg", date: "2030-06-13" },
        { kind: "restingHeartRate", value: 50, date: "Jun 12, 2030" },
        { kind: "bloodSugar", value: 90, at: "2030-06-14" },
        { kind: "hrv", value: 60 },
        "junk",
      ],
    });
    expect(readings).toEqual([
      { kind: "hrv", value: 58, unit: "ms", at: "2030-06-14T11:10:00.000Z" },
      { kind: "weight", value: 176.37, unit: "lb", at: "2030-06-13T12:00:00.000Z" },
      { kind: "rhr", value: 50, unit: "bpm", at: "2030-06-12T12:00:00.000Z" },
    ]);
  });

  it("drops readings out of range or in a unit it can't convert", () => {
    const { readings } = parse({ date: "2030-06-14", weight: "80 stone", rhr: 400, hrv: 0, sleep: 30, steps: -1 });
    expect(readings).toEqual([]);
  });

  it("keeps one reading per kind per UTC day, the last one sent", () => {
    const { readings } = parse({
      date: "2030-06-14",
      hrv: 50,
      readings: [
        { kind: "hrv", value: 55, at: "2030-06-14T06:00:00Z" },
        { kind: "hrv", value: 57, at: "2030-06-13T06:00:00Z" },
      ],
    });
    expect(readings.map((r) => [r.at.slice(0, 10), r.value])).toEqual([
      ["2030-06-14", 55],
      ["2030-06-13", 57],
    ]);
  });

  it("caps a request at 100 readings", () => {
    const reading = (i: number) => ({ kind: "steps", value: 1000, date: new Date(Date.UTC(2030, 0, 1 + i)).toISOString().slice(0, 10) });
    expect(parse({ readings: Array.from({ length: 100 }, (_, i) => reading(i)) }).readings).toHaveLength(100);
    expect(() => parse({ readings: Array.from({ length: 101 }, (_, i) => reading(i)) })).toThrow(
      expect.objectContaining({ status: 413 }),
    );
  });
});

describe("parseHealthCapture: bad bodies", () => {
  it.each([null, "text", 42, true])("refuses %s with a 400", (body) => {
    expect(() => parse(body)).toThrow(CaptureError);
    try {
      parse(body);
    } catch (error) {
      expect((error as CaptureError).status).toBe(400);
    }
  });

  it("reads an object with nothing it knows as nothing", () => {
    expect(parse({ hello: "world" })).toEqual({ app: null, days: [], readings: [] });
  });
});

describe("utcDayBounds", () => {
  it("spans the UTC day of the instant", () => {
    expect(utcDayBounds("2030-06-14T12:00:00.000Z")).toEqual({
      gte: new Date("2030-06-14T00:00:00Z"),
      lt: new Date("2030-06-15T00:00:00Z"),
    });
  });
});
