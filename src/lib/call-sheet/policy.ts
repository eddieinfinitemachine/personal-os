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
export type Closeness = "close" | "strong" | "casual" | "weak";
type SourceDataMap = Partial<Record<CallSheetSource, ContactSourceData>>;
// 1:1 messages in the last 365 days, summed across sources.
export const CLOSE_MESSAGE_VOLUME = 500;
export const STRONG_MESSAGE_VOLUME = 150;
export const CASUAL_MESSAGE_VOLUME = 10;
const CLOSENESS_RANK: Record<Closeness, number> = {
  weak: 0,
  casual: 1,
  strong: 2,
  close: 3,
};
export function messageVolume(sourceData: SourceDataMap | undefined) {
  return SOURCES.reduce((sum, source) => {
    const count = sourceData?.[source]?.messageCount;
    return typeof count === "number" && Number.isFinite(count) && count >= 0
      ? sum + count
      : sum;
  }, 0);
}
// Labels look like "4 - close friend"; legacy rows hold a bare word.
function labelCloseness(strength: string | null): Closeness | null {
  const label = strength?.trim().toLowerCase() ?? "";
  const level = /^([0-5])(?!\d)/.exec(label)?.[1];
  if (level === "5" || level === "4" || /\b(family|close)\b/.test(label))
    return "close";
  if (level === "3" || /\b(friend|strong)\b/.test(label)) return "strong";
  if (level === "2" || /\b(acquaintance|casual)\b/.test(label)) return "casual";
  if (
    level === "1" ||
    level === "0" ||
    /\b(met|weak)\b|don[’']?t know/.test(label)
  )
    return "weak";
  return null;
}
function volumeCloseness(volume: number): Closeness | null {
  return volume >= CLOSE_MESSAGE_VOLUME
    ? "close"
    : volume >= STRONG_MESSAGE_VOLUME
      ? "strong"
      : volume >= CASUAL_MESSAGE_VOLUME
        ? "casual"
        : volume > 0
          ? "weak"
          : null;
}
/** The closer of the CRM label and recent message volume; casual when neither says. */
export function closeness(person: {
  strength: string | null;
  sourceData?: SourceDataMap;
}): Closeness {
  const signals = [
    labelCloseness(person.strength),
    volumeCloseness(messageVolume(person.sourceData)),
  ].filter((value): value is Closeness => value !== null);
  if (!signals.length) return "casual";
  return signals.reduce((a, b) =>
    CLOSENESS_RANK[b] > CLOSENESS_RANK[a] ? b : a,
  );
}
export function cadence(
  person: {
    starred: boolean;
    strength: string | null;
    sourceData: SourceDataMap | undefined;
  },
  override?: number | null,
) {
  if (override != null) return override;
  if (person.starred) return 30;
  const level = closeness(person);
  return level === "close"
    ? 30
    : level === "strong"
      ? 60
      : level === "weak"
        ? 180
        : 90;
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
  // Freshness alone bounds how old evidence may be. A failed attempt (the Mac
  // slept mid-scan) leaves the last good scan as usable as it was before it.
  const complete = enabled.every(
    (source) =>
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
export const NO_CONTACT_REASON = "No contact on record.";
/** People to sort out by hand: active, shown, never starred or given a cadence,
 * and verifiably silent (every enabled source scanned them fresh). Snoozes and
 * the suggestion cooldown do not take anyone out of review. */
export function reviewQueue(
  people: PolicyPerson[],
  sources: Record<CallSheetSource, SourceHealth>,
  now: Date,
): PolicyPerson[] {
  return people
    .filter((person) => {
      if (
        person.archived ||
        person.starred ||
        person.preference?.excludedAt ||
        person.preference?.cadenceDays != null
      )
        return false;
      const last = latestContact(person, sources, now);
      return last.at === null && last.complete;
    })
    .sort(
      (a, b) =>
        personName(a).localeCompare(personName(b), "en") ||
        a.id.localeCompare(b.id),
    );
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
        ? liveCues(
            SOURCES.flatMap((source) =>
              sources[source].enabled
                ? liveCues(person.sourceData[source]?.cues ?? [], now, source)
                : [],
            ),
            now,
          )
        : [];
      // No contact on record only counts once every enabled source has a fresh
      // scan for this person; a missing scan is not evidence of silence.
      const unknown = age === null && !birthday;
      if (unknown && !last.complete) return [];
      if (!birthday && !unknown && (!last.reliable || age! < interval))
        return [];
      const level = closeness(person);
      const important =
        person.starred || level === "close" || level === "strong";
      // Starred or a user-chosen cadence means they were reviewed and kept:
      // treat silence as a year overdue. Everyone else waits behind known dates.
      const kept = person.starred || pref?.cadenceDays != null;
      // An AI-extracted question is context, never a user-set due date.
      const tier = birthday ? 1 : unknown && !kept ? 4 : important ? 2 : 3;
      const category = relationshipCategory(person);
      return [
        {
          person,
          reason: birthday
            ? "Their birthday is coming up this week."
            : unknown
              ? NO_CONTACT_REASON
              : `Time for your ${interval}-day check-in.`,
          lastContactAt: last.at,
          lastContactSource: last.source,
          cues,
          cadenceDays: interval,
          tier,
          score: (unknown ? (kept ? 365 : 0) : (age ?? 0)) / interval,
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
  existing: { category: string }[] = [],
) {
  const pool = [...candidates];
  const selected: Candidate[] = [];
  const counts = new Map<string, number>();
  for (const item of existing)
    counts.set(item.category, (counts.get(item.category) ?? 0) + 1);
  while (pool.length && selected.length < count) {
    // Category balance never reaches past people who are due into the
    // no-contact tier; that tier is used only once everyone else is taken.
    const due = pool.some((item) => item.tier < 4);
    const index = pool.findIndex(
      (item) => (!due || item.tier < 4) && (counts.get(item.category) ?? 0) < 2,
    );
    const [item] = pool.splice(index === -1 ? 0 : index, 1);
    selected.push(item);
    counts.set(item.category, (counts.get(item.category) ?? 0) + 1);
  }
  return selected;
}
