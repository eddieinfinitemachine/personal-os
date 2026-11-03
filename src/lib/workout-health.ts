// Health data for the workout planner: the user's Personal health profile
// (Human) read into a snapshot, a recovery read from HRV and resting heart rate
// against their own 30-day average, the planner's prompt section, and the
// short facts the plan review shows. Pure functions plus one Prisma loader;
// the client only imports types from here.

import { prisma } from "@/lib/prisma";

export type Readiness = "low" | "normal";

export type Reading = { value: number; unit: string; at: number };
/** The latest reading and the mean of the 30 days before it (null with under 3 readings). */
export type Trend = { latest: Reading; baseline: number | null };

export type HealthSnapshot = {
  age: number | null;
  sex: string | null;
  heightIn: number | null;
  weight: Reading | null;
  bodyFat: Reading | null;
  vo2: Reading | null;
  hrv: Trend | null;
  rhr: Trend | null;
  conditions: string[];
  /** Non-lifting sessions from the last 3 days (runs, rides…). */
  activity: { kind: string; at: number; durationMin: number | null; distanceMi: number | null }[];
};

export type HealthSummary = {
  /** Short display facts: "182 lb", "HRV 42 ms · avg 55". */
  facts: string[];
  readiness: Readiness | null;
  /** Why, in a sentence; null without recovery data. */
  note: string | null;
};

const DAY = 86_400_000;
/** HRV this far under its average, or resting HR this many bpm over, reads as low recovery. */
const HRV_DROP = 0.15;
const RHR_RISE = 5;

function num(n: number): string {
  return Number.isInteger(n) ? String(n) : n.toFixed(1);
}
function day(ts: number): string {
  return new Date(ts).toISOString().slice(0, 10);
}
function ago(ts: number, now: number): string {
  const days = Math.floor((now - ts) / DAY);
  return days <= 0 ? "today" : days === 1 ? "yesterday" : `${days} days ago`;
}

/** Latest reading if it's from the last 2 days, against the 30 days before it. */
export function trendOf(readings: Reading[], now: number): Trend | null {
  const sorted = [...readings].sort((a, b) => b.at - a.at);
  const latest = sorted[0];
  if (!latest || now - latest.at > 2 * DAY) return null;
  const prior = sorted.slice(1).filter((r) => latest.at - r.at <= 30 * DAY);
  return { latest, baseline: prior.length >= 3 ? prior.reduce((n, r) => n + r.value, 0) / prior.length : null };
}

export function readinessOf(s: HealthSnapshot): { readiness: Readiness | null; note: string | null } {
  const measured: string[] = [];
  const low: string[] = [];
  if (s.hrv?.baseline) {
    measured.push("HRV");
    const drop = 1 - s.hrv.latest.value / s.hrv.baseline;
    if (drop >= HRV_DROP) {
      low.push(`HRV ${num(s.hrv.latest.value)} ${s.hrv.latest.unit} is ${Math.round(drop * 100)}% under your 30-day average (${Math.round(s.hrv.baseline)})`);
    }
  }
  if (s.rhr?.baseline) {
    measured.push("resting HR");
    const rise = s.rhr.latest.value - s.rhr.baseline;
    if (rise >= RHR_RISE) {
      low.push(`resting HR ${num(s.rhr.latest.value)} is ${Math.round(rise)} bpm over your 30-day average (${Math.round(s.rhr.baseline)})`);
    }
  }
  if (!measured.length) return { readiness: null, note: null };
  if (low.length) {
    const text = low.join("; ");
    return { readiness: "low", note: `${text[0].toUpperCase()}${text.slice(1)}.` };
  }
  const what = measured.join(" and ");
  return { readiness: "normal", note: `${what[0].toUpperCase()}${what.slice(1)} ${measured.length > 1 ? "are" : "is"} in your normal range.` };
}

/** The planner's "health data" section; "" when the profile holds nothing useful. */
export function healthPrompt(s: HealthSnapshot, now: number): string {
  const lines: string[] = [];
  const profile = [
    s.age !== null ? `${s.age}-year-old` : "",
    s.sex === "M" ? "male" : s.sex === "F" ? "female" : (s.sex ?? ""),
    s.heightIn !== null ? `${Math.floor(s.heightIn / 12)}'${Math.round(s.heightIn % 12)}"` : "",
  ]
    .filter(Boolean)
    .join(" ");
  const body = [
    profile,
    s.weight ? `${num(s.weight.value)} ${s.weight.unit} (${day(s.weight.at)})` : "",
    s.bodyFat ? `body fat ${num(s.bodyFat.value)}${s.bodyFat.unit === "%" ? "%" : ` ${s.bodyFat.unit}`} (${day(s.bodyFat.at)})` : "",
    s.vo2 ? `VO2 max ${num(s.vo2.value)} (${day(s.vo2.at)})` : "",
  ].filter(Boolean);
  if (body.length) lines.push(`- ${body.join(", ")}`);
  const { readiness, note } = readinessOf(s);
  if (readiness === "low") {
    lines.push(`- Recovery today is LOW: ${note} Keep loads at or below last time, drop a set from the main lifts and keep effort moderate.`);
  } else if (readiness === "normal") {
    lines.push(`- Recovery today is normal: ${note} Progress loads as the log suggests.`);
  }
  if (s.conditions.length) lines.push(`- Conditions to work around: ${s.conditions.join("; ")}.`);
  if (s.activity.length) {
    lines.push(
      `- Other training in the last 3 days: ${s.activity
        .map((a) =>
          [a.kind, a.distanceMi !== null ? `${num(a.distanceMi)} mi` : "", a.durationMin !== null ? `${a.durationMin} min` : ""]
            .filter(Boolean)
            .join(", ") + ` (${ago(a.at, now)})`,
        )
        .join("; ")}.`,
    );
  }
  return lines.length ? ["Athlete health data, from their health profile:", ...lines].join("\n") : "";
}

/** What the plan review shows about the health data the plan used. */
export function healthSummary(s: HealthSnapshot, now: number): HealthSummary {
  const trend = (label: string, t: Trend | null, unit: string) =>
    t ? `${label} ${num(t.latest.value)}${unit}${t.baseline ? ` · avg ${Math.round(t.baseline)}` : ""}` : "";
  const facts = [
    s.weight ? `${num(s.weight.value)} ${s.weight.unit}` : "",
    s.bodyFat ? `${num(s.bodyFat.value)}${s.bodyFat.unit === "%" ? "%" : ` ${s.bodyFat.unit}`} body fat` : "",
    trend("HRV", s.hrv, s.hrv ? ` ${s.hrv.latest.unit}` : ""),
    trend("Resting HR", s.rhr, ""),
    ...s.activity.slice(0, 2).map((a) => `${a.kind[0].toUpperCase()}${a.kind.slice(1)} ${ago(a.at, now)}`),
    s.conditions.length ? `${s.conditions.length} condition${s.conditions.length > 1 ? "s" : ""} noted` : "",
  ].filter(Boolean);
  return { facts, ...readinessOf(s) };
}

// ---- Loading ---------------------------------------------------------------

type Row = { kind: string; value: number; unit: string; measuredAt: Date };
export type HumanRows = {
  sex: string | null;
  birthDate: Date | null;
  heightInches: number | null;
  conditionsJson: unknown;
  /** HRV / resting HR from the last ~33 days. */
  recovery: Row[];
  /** The latest weight, body fat and VO2 max, any age. */
  body: Row[];
  activity: { kind: string; performedAt: Date; durationMin: number | null; distanceMi: number | null }[];
};

function ageYears(dob: Date, now: number): number {
  const today = new Date(now);
  let y = today.getUTCFullYear() - dob.getUTCFullYear();
  const m = today.getUTCMonth() - dob.getUTCMonth();
  if (m < 0 || (m === 0 && today.getUTCDate() < dob.getUTCDate())) y--;
  return y;
}

export function buildSnapshot(h: HumanRows, now: number): HealthSnapshot {
  const reading = (r: Row): Reading => ({ value: r.value, unit: r.unit, at: r.measuredAt.getTime() });
  const latest = (kind: string) => {
    const r = h.body.find((b) => b.kind === kind);
    return r ? reading(r) : null;
  };
  const conditions = (Array.isArray(h.conditionsJson) ? h.conditionsJson : [])
    .map((c) => {
      if (!c || typeof c !== "object") return "";
      const o = c as Record<string, unknown>;
      const name = typeof o.name === "string" ? o.name.trim() : "";
      const notes = typeof o.notes === "string" ? o.notes.trim() : "";
      return name ? (notes ? `${name} (${notes})` : name).slice(0, 160) : "";
    })
    .filter(Boolean)
    .slice(0, 8);
  return {
    age: h.birthDate ? ageYears(h.birthDate, now) : null,
    sex: h.sex,
    heightIn: h.heightInches,
    weight: latest("weight"),
    bodyFat: latest("bodyFat"),
    vo2: latest("vo2"),
    hrv: trendOf(h.recovery.filter((r) => r.kind === "hrv").map(reading), now),
    rhr: trendOf(h.recovery.filter((r) => r.kind === "rhr").map(reading), now),
    conditions,
    activity: h.activity.map((a) => ({ kind: a.kind, at: a.performedAt.getTime(), durationMin: a.durationMin, distanceMi: a.distanceMi })),
  };
}

/** The user's own health profile (their first Human), or null without one. */
export async function loadHealth(userId: string, now = Date.now()): Promise<HealthSnapshot | null> {
  const human = await prisma.human.findFirst({
    where: { project: { userId, archived: false } },
    orderBy: { createdAt: "asc" },
    select: {
      id: true,
      sex: true,
      birthDate: true,
      heightInches: true,
      conditionsJson: true,
      biometrics: {
        where: { kind: { in: ["hrv", "rhr"] }, measuredAt: { gte: new Date(now - 33 * DAY) } },
        orderBy: { measuredAt: "desc" },
        take: 200,
      },
      fitnessSessions: {
        where: { performedAt: { gte: new Date(now - 3 * DAY) }, kind: { not: "lift" } },
        orderBy: { performedAt: "desc" },
        take: 10,
      },
    },
  });
  if (!human) return null;
  const body = await prisma.biometricReading.findMany({
    where: { humanId: human.id, kind: { in: ["weight", "bodyFat", "vo2"] } },
    orderBy: { measuredAt: "desc" },
    distinct: ["kind"],
  });
  return buildSnapshot({ ...human, recovery: human.biometrics, body, activity: human.fitnessSessions }, now);
}
