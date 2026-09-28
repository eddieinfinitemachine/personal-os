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
  return cues
    .filter(
      (cue) =>
        cue.evidence.length &&
        cue.evidence.every(
          (e) =>
            (!source || e.source === source) &&
            Date.parse(e.sentAt) <= now.getTime() + 300_000 &&
            Date.parse(e.sentAt) >= now.getTime() - 90 * DAY_MS,
        ),
    )
    .slice(0, 3);
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
  return people
    .flatMap((person) => {
      const pref = person.preference;
      if (
        person.archived ||
        pref?.excludedAt ||
        (pref?.snoozedUntil && pref.snoozedUntil > now) ||
        (pref?.lastSuggestedAt &&
          now.getTime() - pref.lastSuggestedAt.getTime() < 7 * DAY_MS)
      )
        return [];
      const last = latestContact(person, sources, now);
      const age = last.at
        ? (now.getTime() - Date.parse(last.at)) / DAY_MS
        : null;
      if (age !== null && age < 7) return [];
      const interval = cadence(person, pref?.cadenceDays);
      const birthday = birthdaySoon(person.birthday, now, timezone);
      const cues = last.complete
        ? SOURCES.flatMap((source) =>
            sources[source].enabled
              ? liveCues(person.sourceData[source]?.cues ?? [], now, source)
              : [],
          ).slice(0, 3)
        : [];
      const followUp = cues.some((cue) => cue.kind === "follow_up");
      if (
        !birthday &&
        !followUp &&
        (!last.reliable || age === null || age < interval)
      )
        return [];
      const important =
        person.starred ||
        person.strength === "close" ||
        person.strength === "strong";
      const tier = followUp ? 0 : birthday ? 1 : important ? 2 : 3;
      const labels = [...person.circles, ...person.tags].map((s) =>
        s.toLowerCase(),
      );
      const category = labels.some((s) => /^(family|relatives)$/.test(s))
        ? "family"
        : labels.some((s) =>
              /^(professional|work|colleagues|business)$/.test(s),
            )
          ? "professional"
          : labels.some((s) => /^(friends|friend|social)$/.test(s))
            ? "friends"
            : "unknown";
      return [
        {
          person,
          reason: followUp
            ? "A possible follow-up from your conversation."
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
  existing: Candidate[] = [],
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
