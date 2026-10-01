import { createHash } from "node:crypto";
import type {
  CallSheetSource,
  ContactSourceData,
  EvidenceCue,
  SourceHealth,
} from "./types";

export const DAY_MS = 86_400_000;
export const SOURCES: CallSheetSource[] = ["imessage", "whatsapp"];
export type Identity = {
  firstName: string;
  lastName: string | null;
  phone: string | null;
  email: string | null;
};
export function personName(person: Identity) {
  return [person.firstName, person.lastName].filter(Boolean).join(" ").trim();
}
export function normalizeHandle(value: string): string {
  const input = value.trim().toLowerCase();
  if (input.includes("@"))
    return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(input) ? input : "";
  const digits = input.replace(/\D/g, "");
  if (digits.length < 7 || digits.length > 15) return "";
  return `+${digits.length === 10 ? "1" : ""}${digits}`;
}
export function identityKey(person: Identity) {
  return createHash("sha256")
    .update(
      JSON.stringify([
        person.firstName.trim(),
        person.lastName?.trim() ?? "",
        normalizeHandle(person.phone ?? ""),
        normalizeHandle(person.email ?? ""),
      ]),
    )
    .digest("hex");
}
export function localDate(now: Date, timezone: string): string {
  return new Intl.DateTimeFormat("en-CA", {
    timeZone: timezone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(now);
}
/** True for a real calendar date written as YYYY-MM-DD. */
export function isLocalDate(value: unknown): value is string {
  if (typeof value !== "string" || !/^\d{4}-\d{2}-\d{2}$/.test(value))
    return false;
  const parsed = new Date(`${value}T00:00:00Z`);
  return (
    !Number.isNaN(parsed.getTime()) &&
    parsed.toISOString().slice(0, 10) === value
  );
}
/** Calendar arithmetic on a YYYY-MM-DD string (no timezone involved). */
export function addLocalDays(date: string, days: number): string {
  const value = new Date(`${date}T12:00:00Z`);
  value.setUTCDate(value.getUTCDate() + days);
  return value.toISOString().slice(0, 10);
}
export const REMINDER_REASON = "You asked to be reminded today.";
export function validTimezone(timezone: string) {
  try {
    new Intl.DateTimeFormat("en", { timeZone: timezone }).format();
    return timezone.length <= 100;
  } catch {
    return false;
  }
}
// Calendar-day arithmetic keeps snoozes aligned with the user's date through DST.
export function snoozeUntil(now: Date, days: number, timezone: string): Date {
  const target = new Date(`${localDate(now, timezone)}T12:00:00.000Z`);
  target.setUTCDate(target.getUTCDate() + days);
  const date = target.toISOString().slice(0, 10);
  let instant = new Date(`${date}T00:00:00Z`);
  for (let i = 0; i < 3; i++) {
    const parts = new Intl.DateTimeFormat("en-CA", {
      timeZone: timezone,
      year: "numeric",
      month: "2-digit",
      day: "2-digit",
      hour: "2-digit",
      minute: "2-digit",
      second: "2-digit",
      hourCycle: "h23",
    }).formatToParts(instant);
    const p = Object.fromEntries(parts.map(({ type, value }) => [type, value]));
    const asUTC = Date.UTC(
      +p.year,
      +p.month - 1,
      +p.day,
      +p.hour,
      +p.minute,
      +p.second,
    );
    instant = new Date(
      instant.getTime() + Date.parse(`${date}T00:00:00Z`) - asUTC,
    );
  }
  return instant;
}
export function cadence(
  person: { starred: boolean; strength: string | null },
  override?: number | null,
) {
  return (
    override ??
    (person.starred || person.strength === "close"
      ? 30
      : person.strength === "strong"
        ? 60
        : person.strength === "weak"
          ? 180
          : 90)
  );
}
export function fresh(iso: string | null | undefined, now: Date) {
  if (!iso) return false;
  const age = now.getTime() - Date.parse(iso);
  return Number.isFinite(age) && age >= -300_000 && age <= 2 * DAY_MS;
}
export function liveCues(
  cues: EvidenceCue[],
  now: Date,
  source?: CallSheetSource,
) {
  const eligible = cues.filter(
    (cue) =>
      cue.evidence.length &&
      cue.evidence.every(
        (e) =>
          (!source || e.source === source) &&
          Date.parse(e.sentAt) <= now.getTime() + 300_000 &&
          Date.parse(e.sentAt) >= now.getTime() - 90 * DAY_MS,
      ),
  );
  // Use one budget across sources, counting excerpts rather than just topics.
  // Keep a cue's supporting evidence together instead of silently weakening it.
  const newest = (cue: EvidenceCue) =>
    Math.max(...cue.evidence.map((e) => Date.parse(e.sentAt)));
  const key = (cue: EvidenceCue) =>
    JSON.stringify([
      cue.evidence.map((e) => [e.source, e.messageId]).sort(),
      cue.kind,
      cue.text,
    ]);
  eligible.sort(
    (a, b) => newest(b) - newest(a) || key(a).localeCompare(key(b)),
  );
  let remaining = 3;
  return eligible.filter((cue) => {
    if (cue.evidence.length > remaining) return false;
    remaining -= cue.evidence.length;
    return true;
  });
}
export function limitPersonCues(
  sourceData: Partial<Record<CallSheetSource, ContactSourceData>>,
  now: Date,
): Partial<Record<CallSheetSource, ContactSourceData>> {
  const bounded = liveCues(
    SOURCES.flatMap((source) =>
      liveCues(sourceData[source]?.cues ?? [], now, source),
    ),
    now,
  );
  return Object.fromEntries(
    SOURCES.flatMap((source) =>
      sourceData[source]
        ? [
            [
              source,
              {
                ...sourceData[source],
                cues: bounded.filter((cue) =>
                  cue.evidence.every((e) => e.source === source),
                ),
              },
            ],
          ]
        : [],
    ),
  );
}
export function relationshipCategory(person: {
  circles: string[];
  tags: string[];
}): string {
  const labels = [...person.circles, ...person.tags].map((s) =>
    s.toLowerCase(),
  );
  return labels.some((s) => /^(family|relatives)$/.test(s))
    ? "family"
    : labels.some((s) => /^(professional|work|colleagues|business)$/.test(s))
      ? "professional"
      : labels.some((s) => /^(friends|friend|social)$/.test(s))
        ? "friends"
        : "unknown";
}

export type PolicyPerson = Identity & {
  id: string;
  imageUrl: string | null;
  archived: boolean;
  starred: boolean;
  strength: string | null;
  circles: string[];
  tags: string[];
  birthday: Date | null;
  manualAt: Date | null;
  preference?: {
    cadenceDays: number | null;
    snoozedUntil: Date | null;
    excludedAt: Date | null;
    lastSuggestedAt: Date | null;
    dueOn: string | null;
    dueNote: string | null;
  };
  sourceData: Partial<Record<CallSheetSource, ContactSourceData>>;
};
export type Candidate = {
  person: PolicyPerson;
  reason: string;
  lastContactAt: string | null;
  lastContactSource: string | null;
  cues: EvidenceCue[];
  cadenceDays: number;
  tier: number;
  score: number;
  category: string;
  /** Present when the user asked for this person today (or on a missed earlier day). */
  reminder?: { note: string | null };
};
export function latestContact(
  person: PolicyPerson,
  sources: Record<CallSheetSource, SourceHealth>,
  now: Date,
) {
  const known: { at: string; source: string }[] =
    person.manualAt && person.manualAt <= now
      ? [{ at: person.manualAt.toISOString(), source: "manual" }]
      : [];
  const enabled = SOURCES.filter((source) => sources[source].enabled);
  const complete = enabled.every(
    (source) =>
      sources[source].status !== "error" &&
      fresh(sources[source].lastSuccessAt, now) &&
      fresh(person.sourceData[source]?.capturedAt, now),
  );
  // Even incomplete recent evidence can prevent a stale prompt; it never proves absence.
  for (const source of enabled) {
    const data = person.sourceData[source];
    if (data?.lastContactAt && Date.parse(data.lastContactAt) <= now.getTime())
      known.push({ at: data.lastContactAt, source });
  }
  known.sort((a, b) => Date.parse(b.at) - Date.parse(a.at));
  const latest = known[0];
  const reliable = latest?.source === "manual" || complete;
  return {
    at: latest?.at ?? null,
    source: latest?.source ?? null,
    reliable,
    complete,
  };
}
function birthdaySoon(birthday: Date | null, now: Date, timezone: string) {
  if (!birthday) return false;
  const today = new Date(`${localDate(now, timezone)}T00:00:00Z`);
  for (let offset = 0; offset <= 7; offset++) {
    const day = new Date(today.getTime() + offset * DAY_MS);
    if (
      day.getUTCMonth() === birthday.getUTCMonth() &&
      day.getUTCDate() === birthday.getUTCDate()
    )
      return true;
  }
  return false;
}
export function rankCandidates(
  people: PolicyPerson[],
  sources: Record<CallSheetSource, SourceHealth>,
  now: Date,
  timezone: string,
): Candidate[] {
  const today = localDate(now, timezone);
  return people
    .flatMap((person) => {
      const pref = person.preference;
      if (person.archived || pref?.excludedAt) return [];
      // A reminder the user set is explicit intent: it fires on its date (or the
      // first later day the sheet is opened) regardless of snooze, cooldown,
      // recent contact or cadence.
      const due = !!pref?.dueOn && pref.dueOn <= today;
      if (
        !due &&
        ((pref?.snoozedUntil && pref.snoozedUntil > now) ||
          (pref?.lastSuggestedAt &&
            now.getTime() - pref.lastSuggestedAt.getTime() < 7 * DAY_MS))
      )
        return [];
      const last = latestContact(person, sources, now);
      const age = last.at
        ? (now.getTime() - Date.parse(last.at)) / DAY_MS
        : null;
      if (!due && age !== null && age < 7) return [];
      const interval = cadence(person, pref?.cadenceDays);
      const birthday = birthdaySoon(person.birthday, now, timezone);
      const cues = last.complete
        ? liveCues(
            SOURCES.flatMap((source) =>
              sources[source].enabled
                ? liveCues(person.sourceData[source]?.cues ?? [], now, source)
                : [],
            ),
            now,
          )
        : [];
      if (
        !due &&
        !birthday &&
        (!last.reliable || age === null || age < interval)
      )
        return [];
      const important =
        person.starred ||
        person.strength === "close" ||
        person.strength === "strong";
      // An AI-extracted question is context, never a user-set due date.
      const tier = due ? 0 : birthday ? 1 : important ? 2 : 3;
      const category = relationshipCategory(person);
      return [
        {
          person,
          reason: due
            ? REMINDER_REASON
            : birthday
              ? "Their birthday is coming up this week."
              : `Time for your ${interval}-day check-in.`,
          lastContactAt: last.at,
          lastContactSource: last.source,
          cues,
          cadenceDays: interval,
          tier,
          score: (age ?? 0) / interval,
          category,
          ...(due ? { reminder: { note: pref!.dueNote ?? null } } : {}),
        },
      ];
    })
    .sort(
      (a, b) =>
        a.tier - b.tier ||
        b.score - a.score ||
        a.person.id.localeCompare(b.person.id),
    );
}
export function selectCandidates(
  candidates: Candidate[],
  count = 5,
  existing: { category: string }[] = [],
) {
  const pool = [...candidates];
  const selected: Candidate[] = [];
  const counts = new Map<string, number>();
  for (const item of existing)
    counts.set(item.category, (counts.get(item.category) ?? 0) + 1);
  while (pool.length && selected.length < count) {
    const index = pool.findIndex(
      (item) => (counts.get(item.category) ?? 0) < 2,
    );
    const [item] = pool.splice(index === -1 ? 0 : index, 1);
    selected.push(item);
    counts.set(item.category, (counts.get(item.category) ?? 0) + 1);
  }
  return selected;
}
