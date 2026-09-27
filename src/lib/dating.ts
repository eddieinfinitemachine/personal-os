// Pure helpers for the dating page: handle normalization (shared with the Mac
// sync script), transcript parsing for pasted chats, and the numbers the
// relationship chart and stats are built from. No Prisma here so it stays
// testable and importable from scripts/.

export const STAGES = ["talking", "dating", "exclusive", "paused", "ended"] as const;
export type Stage = (typeof STAGES)[number];

export const EVENT_KINDS = ["date", "milestone", "call", "conflict", "note"] as const;
export type EventKind = (typeof EVENT_KINDS)[number];

export function isStage(v: unknown): v is Stage {
  return typeof v === "string" && (STAGES as readonly string[]).includes(v);
}

export function isEventKind(v: unknown): v is EventKind {
  return typeof v === "string" && (EVENT_KINDS as readonly string[]).includes(v);
}

// Phones → E.164 (US default for 10 digits), emails → lowercase. Returns ""
// for anything that is neither.
export function normalizeHandle(raw: string): string {
  const s = raw.trim();
  if (!s) return "";
  if (s.includes("@")) return s.toLowerCase();
  const digits = s.replace(/[^\d]/g, "");
  if (digits.length < 7) return "";
  if (digits.length === 10) return `+1${digits}`;
  if (digits.length === 11 && digits.startsWith("1")) return `+${digits}`;
  return `+${digits}`;
}

/** Split a free-form "phone, email; other phone" field into unique handles. */
export function parseHandles(input: unknown): string[] {
  const parts = Array.isArray(input)
    ? input.filter((x): x is string => typeof x === "string")
    : typeof input === "string"
      ? input.split(/[,;\n]+/)
      : [];
  return [...new Set(parts.map(normalizeHandle).filter(Boolean))];
}

// Instagram paths that aren't profiles ("instagram.com/p/<post>").
const IG_NOT_PROFILE = new Set(["p", "reel", "reels", "tv", "explore", "accounts", "direct", "about", "legal"]);

/**
 * An Instagram handle from "@jane.doe", "jane.doe", "instagram.com/jane.doe"
 * or a shared profile link ("https://www.instagram.com/jane.doe/?igsh=…").
 * Lowercased, no @. Null for empty input or anything that isn't a valid
 * handle (a-z, 0-9, "." and "_", up to 30, no leading, trailing or double dot).
 */
export function normalizeInstagram(input: unknown): string | null {
  if (typeof input !== "string") return null;
  let s = input.trim();
  const url = s.match(/^(?:https?:\/\/)?(?:(?:www|m)\.)?(?:instagram\.com|instagr\.am)(?:\/(.*))?$/i);
  if (url) {
    const segs = (url[1] ?? "").split(/[?#]/)[0].split("/").filter(Boolean);
    const first = segs[0]?.toLowerCase();
    if (!first || IG_NOT_PROFILE.has(first)) return null;
    s = first === "stories" ? (segs[1] ?? "") : segs[0];
  }
  const h = s.replace(/^@/, "").toLowerCase();
  if (!/^[a-z0-9._]{1,30}$/.test(h) || h.startsWith(".") || h.endsWith(".") || h.includes("..")) return null;
  return h;
}

export function instagramUrl(handle: string): string {
  return `https://instagram.com/${handle}`;
}

/** Trim, drop empties and duplicates, cap each entry and the list. */
export function cleanList(input: unknown, max = 100): string[] {
  if (!Array.isArray(input)) return [];
  const out: string[] = [];
  for (const v of input) {
    if (typeof v !== "string") continue;
    const t = v.trim().slice(0, 500);
    if (t && !out.includes(t)) out.push(t);
    if (out.length >= max) break;
  }
  return out;
}

// ---------------------------------------------------------------------------
// Pasted transcripts

export type ParsedMessage = { sentAt: Date; fromMe: boolean; text: string; sender: string; timestampMissing?: true };

// WhatsApp iOS:     [1/2/24, 9:41:03 PM] Name: text
// WhatsApp Android: 1/2/24, 21:41 - Name: text
const WHATSAPP =
  /^‎?\[?(\d{1,4})[/.-](\d{1,2})[/.-](\d{2,4}),?\s+(\d{1,2}):(\d{2})(?::(\d{2}))?\s*([AaPp][Mm])?\]?\s*(?:-\s*)?([^:]{1,60}):\s?(.*)$/;
// Plain "Name: text" lines.
const PLAIN = /^([^:\n]{1,40}):\s?(.+)$/;

const ME_NAMES = new Set(["me", "i", "myself", "you"]);

/**
 * Parse a pasted chat. Handles WhatsApp exports (both formats) and plain
 * "Name: text" lines; unprefixed lines continue the previous message. Plain
 * lines have no timestamps, so they get `fallbackStart` plus one second each
 * to keep their order.
 *
 * Who is "me": a sender named `myName` (case-insensitive) or me/you. If
 * neither appears and there are exactly two senders, the one that is not
 * `theirName` is me.
 */
export function parseTranscript(
  raw: string,
  opts: { myName?: string; theirName?: string; fallbackStart?: Date } = {},
): ParsedMessage[] {
  const lines = raw.replace(/\r\n?/g, "\n").split("\n");
  const rows: { sentAt: Date | null; sender: string; text: string }[] = [];
  for (const line of lines) {
    if (!line.trim()) continue;
    const w = line.match(WHATSAPP);
    if (w) {
      rows.push({ sentAt: whatsappDate(w), sender: w[8].trim(), text: w[9] });
      continue;
    }
    const p = line.match(PLAIN);
    if (p && !/^https?$/i.test(p[1].trim())) {
      rows.push({ sentAt: null, sender: p[1].trim(), text: p[2] });
      continue;
    }
    const prev = rows[rows.length - 1];
    if (prev) prev.text += `\n${line}`;
  }

  const myName = opts.myName?.trim().toLowerCase();
  const theirName = opts.theirName?.trim().toLowerCase();
  const senders = [...new Set(rows.map((r) => r.sender.toLowerCase()))];
  const explicitMe = senders.some((s) => s === myName || ME_NAMES.has(s));
  const isMe = (sender: string): boolean => {
    const s = sender.toLowerCase();
    if (explicitMe) return s === myName || ME_NAMES.has(s);
    if (senders.length === 2 && theirName) {
      const theirs = senders.find((x) => x === theirName || x.split(/\s+/)[0] === theirName.split(/\s+/)[0]);
      if (theirs) return s !== theirs;
    }
    return false;
  };

  const start = (opts.fallbackStart ?? new Date()).getTime();
  return rows
    .map((r, i) => ({
      sentAt: r.sentAt ?? new Date(start + i * 1000),
      fromMe: isMe(r.sender),
      text: r.text.replace(/^‎/, "").trim(),
      sender: r.sender,
      ...(r.sentAt ? {} : { timestampMissing: true as const }),
    }))
    .filter((m) => m.text && !/^<(media|attached).*>$/i.test(m.text));
}

function whatsappDate(m: RegExpMatchArray): Date | null {
  let [a, b, y] = [Number(m[1]), Number(m[2]), Number(m[3])];
  let month: number;
  let day: number;
  if (m[1].length === 4) {
    // 2024-01-02
    [y, month, day] = [a, b, y];
  } else if (a > 12) {
    [day, month] = [a, b];
  } else {
    [month, day] = [a, b];
  }
  if (y < 100) y += 2000;
  let hour = Number(m[4]);
  const ampm = m[7]?.toLowerCase();
  if (ampm === "pm" && hour < 12) hour += 12;
  if (ampm === "am" && hour === 12) hour = 0;
  const d = new Date(y, month - 1, day, hour, Number(m[5]), Number(m[6] ?? 0));
  return Number.isNaN(d.getTime()) ? null : d;
}

/** Stable id for a timestamped pasted message (retains the original ID format). */
export async function pasteExternalId(m: { sentAt: Date; fromMe: boolean; text: string }, personId: string) {
  return `paste:${await pasteHash(`${personId}|${m.sentAt.toISOString()}|${m.fromMe ? 1 : 0}|${m.text}`)}`;
}

/**
 * Undated messages use the normalized transcript and their position, not the
 * import date. This preserves repeated identical lines without merging common
 * replies from different chats. Edited/overlapping undated transcripts cannot
 * be safely deduped; dated messages retain their existing external IDs.
 */
export async function pasteExternalIds(messages: ParsedMessage[], personId: string): Promise<string[]> {
  const transcript = messages.some((m) => m.timestampMissing)
    ? await pasteHash(JSON.stringify(messages.map((m) => [m.timestampMissing ? null : m.sentAt.toISOString(), m.fromMe, m.text])))
    : null;
  return Promise.all(messages.map((m, i) => m.timestampMissing
    ? pasteHash(JSON.stringify([personId, transcript, i])).then((hash) => `paste:undated:${hash}`)
    : pasteExternalId(m, personId)));
}

async function pasteHash(value: string): Promise<string> {
  const data = new TextEncoder().encode(value);
  const digest = await crypto.subtle.digest("SHA-256", data);
  const hex = [...new Uint8Array(digest)].map((b) => b.toString(16).padStart(2, "0")).join("");
  return hex.slice(0, 32);
}

// ---------------------------------------------------------------------------
// Relationship numbers

type Msg = { sentAt: Date | string; fromMe: boolean };

const HOUR = 3_600_000;
const DAY = 24 * HOUR;
// A message after this much silence starts a new conversation.
const CONVO_GAP = 6 * HOUR;

export type ThreadStats = {
  total: number;
  mine: number;
  theirs: number;
  /** Share of conversations I started, 0-1; null with no conversations. */
  iInitiate: number | null;
  conversations: number;
  /** Median minutes to reply, within a conversation. */
  myReplyMin: number | null;
  theirReplyMin: number | null;
  firstAt: string | null;
  lastAt: string | null;
  lastFromMe: boolean | null;
};

export function threadStats(messages: Msg[]): ThreadStats {
  const sorted = messages
    .map((m) => ({ t: new Date(m.sentAt).getTime(), fromMe: m.fromMe }))
    .sort((a, b) => a.t - b.t);
  let mine = 0;
  let convos = 0;
  let iStarted = 0;
  const myReplies: number[] = [];
  const theirReplies: number[] = [];
  for (let i = 0; i < sorted.length; i++) {
    const m = sorted[i];
    if (m.fromMe) mine++;
    const prev = sorted[i - 1];
    if (!prev || m.t - prev.t > CONVO_GAP) {
      convos++;
      if (m.fromMe) iStarted++;
    } else if (prev.fromMe !== m.fromMe) {
      (m.fromMe ? myReplies : theirReplies).push((m.t - prev.t) / 60_000);
    }
  }
  const last = sorted[sorted.length - 1];
  return {
    total: sorted.length,
    mine,
    theirs: sorted.length - mine,
    iInitiate: convos ? iStarted / convos : null,
    conversations: convos,
    myReplyMin: median(myReplies),
    theirReplyMin: median(theirReplies),
    firstAt: sorted[0] ? new Date(sorted[0].t).toISOString() : null,
    lastAt: last ? new Date(last.t).toISOString() : null,
    lastFromMe: last ? last.fromMe : null,
  };
}

function median(xs: number[]): number | null {
  if (!xs.length) return null;
  const s = [...xs].sort((a, b) => a - b);
  const mid = Math.floor(s.length / 2);
  return s.length % 2 ? s[mid] : (s[mid - 1] + s[mid]) / 2;
}

/** Monday 00:00 local of the week containing `d`. */
export function weekStart(d: Date): Date {
  const x = new Date(d.getFullYear(), d.getMonth(), d.getDate());
  const dow = (x.getDay() + 6) % 7;
  x.setDate(x.getDate() - dow);
  return x;
}

export type WeekBucket = { week: string; mine: number; theirs: number };

/** Messages per week from the first week through `until` (inclusive), gaps filled with zeros. */
export function weeklyVolume(messages: Msg[], until: Date = new Date()): WeekBucket[] {
  if (!messages.length) return [];
  const counts = new Map<number, { mine: number; theirs: number }>();
  let first = Infinity;
  for (const m of messages) {
    const w = weekStart(new Date(m.sentAt)).getTime();
    first = Math.min(first, w);
    const c = counts.get(w) ?? { mine: 0, theirs: 0 };
    if (m.fromMe) c.mine++;
    else c.theirs++;
    counts.set(w, c);
  }
  const out: WeekBucket[] = [];
  const end = weekStart(until).getTime();
  for (let w = new Date(first); w.getTime() <= end && out.length < 520; w.setDate(w.getDate() + 7)) {
    const c = counts.get(w.getTime()) ?? { mine: 0, theirs: 0 };
    out.push({ week: w.toISOString(), ...c });
  }
  return out;
}

/** Whole days between `iso` and now; null for no date. */
export function daysSince(iso: string | Date | null | undefined, now = Date.now()): number | null {
  if (!iso) return null;
  return Math.max(0, Math.floor((now - new Date(iso).getTime()) / DAY));
}

// ---------------------------------------------------------------------------
// Filing notes (dictation, Granola): Claude proposes what a free-text note
// means for each person; these helpers validate that proposal and build the
// bits that are written. See src/lib/dating-filer.ts for the Claude + DB side.

export const FILED_EVENT_KINDS = ["date", "milestone", "call", "conflict"] as const;
export type FiledEventKind = (typeof FILED_EVENT_KINDS)[number];

export type ProposedEvent = {
  kind: FiledEventKind;
  title: string;
  /** YYYY-MM-DD */
  occurredAt: string;
  vibe: number | null;
  notes: string;
};

export type ProposedPerson = {
  /** An existing person's id, or null for someone new. */
  personId: string | null;
  name: string;
  isNew: boolean;
  /** Short title for the timeline note. */
  summary: string;
  /** Cleaned-up first-person summary of what was said about her. */
  note: string;
  remember: string[];
  greenFlags: string[];
  redFlags: string[];
  lessons: string;
  stage: Stage | null;
  /** Instagram handle the note explicitly gives, normalized; null when none or unchanged. */
  instagram: string | null;
  events: ProposedEvent[];
};

export type Proposal = { people: ProposedPerson[] };

/** What the proposal is checked against: the user's people as stored. */
export type KnownPerson = {
  id: string;
  name: string;
  stage?: string;
  remember: string[];
  greenFlags: string[];
  redFlags: string[];
  lessons?: string | null;
  instagram?: string | null;
};

const DAY_RE = /^\d{4}-\d{2}-\d{2}$/;
const WEEKDAYS = ["Sunday", "Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday"];

/** YYYY-MM-DD of a Date in UTC, or of a valid YYYY-MM-DD string as given. */
export function dayKey(d: Date | string): string {
  if (typeof d === "string" && DAY_RE.test(d)) return d;
  return new Date(d).toISOString().slice(0, 10);
}

/** Noon UTC on that day: lands on the same calendar day in every US zone. */
export function noonUTC(day: string): Date {
  return new Date(`${day}T12:00:00Z`);
}

function validDay(v: unknown): string | null {
  if (typeof v !== "string" || !DAY_RE.test(v)) return null;
  const d = noonUTC(v);
  return !Number.isNaN(d.getTime()) && d.toISOString().slice(0, 10) === v ? v : null;
}

/**
 * The note's day plus the week before it, spelled out with weekdays, so the
 * model maps "last night" / "Saturday" to real dates instead of doing
 * calendar math itself.
 */
export function dateContext(noteDay: string): string {
  const base = noonUTC(noteDay);
  const lines = [`The note is from ${WEEKDAYS[base.getUTCDay()]} ${noteDay}.`, "Recent days:"];
  for (let i = 1; i <= 7; i++) {
    const d = new Date(base.getTime() - i * 86_400_000);
    lines.push(`- ${WEEKDAYS[d.getUTCDay()]} ${d.toISOString().slice(0, 10)}${i === 1 ? " (yesterday / last night)" : ""}`);
  }
  return lines.join("\n");
}

/**
 * A proposed event day: kept when it is a real date within a year either side
 * of the note (plans ahead are fine), otherwise the note's own day.
 */
export function resolveEventDay(v: unknown, noteDay: string): string {
  const day = validDay(v);
  if (!day) return noteDay;
  const gap = Math.abs(noonUTC(day).getTime() - noonUTC(noteDay).getTime());
  return gap <= 366 * 86_400_000 ? day : noteDay;
}

/** Items in `add` not already in `existing` (case- and space-insensitive). */
export function freshItems(existing: string[], add: string[]): string[] {
  const seen = new Set(existing.map(normItem));
  const out: string[] = [];
  for (const a of add) {
    const k = normItem(a);
    if (!k || seen.has(k)) continue;
    seen.add(k);
    out.push(a.trim());
  }
  return out;
}

const normItem = (s: string) => s.trim().toLowerCase().replace(/\s+/g, " ").replace(/[.!]+$/, "");

/** Existing lessons plus `add` as a new paragraph, unless it is already there. */
export function appendLessons(existing: string | null | undefined, add: string): string | null {
  const a = add.trim();
  const cur = existing?.trim() || "";
  if (!a || cur.toLowerCase().includes(a.toLowerCase())) return cur || null;
  return cur ? `${cur}\n\n${a}` : a;
}

const text = (v: unknown, max: number) => (typeof v === "string" ? v.trim().slice(0, max) : "");

/**
 * A journal event day: journals span years, so any real date from 1990 up to
 * a year past the note is kept as written. Null (drop the event) otherwise,
 * rather than piling undated moments onto today.
 */
export function resolveJournalDay(v: unknown, noteDay: string): string | null {
  const day = validDay(v);
  if (!day || day < "1990-01-01") return null;
  return noonUTC(day).getTime() - noonUTC(noteDay).getTime() <= 366 * 86_400_000 ? day : null;
}

function parseEvents(raw: unknown, noteDay: string, journal = false): ProposedEvent[] {
  if (!Array.isArray(raw)) return [];
  return raw.slice(0, journal ? 60 : 10).flatMap((e): ProposedEvent[] => {
    if (!e || typeof e !== "object") return [];
    const r = e as Record<string, unknown>;
    const title = text(r.title, 200);
    if (!title || !(FILED_EVENT_KINDS as readonly unknown[]).includes(r.kind)) return [];
    const day = journal ? resolveJournalDay(r.occurredAt, noteDay) : resolveEventDay(r.occurredAt, noteDay);
    if (!day) return [];
    const v = Number(r.vibe);
    return [
      {
        kind: r.kind as FiledEventKind,
        title,
        occurredAt: day,
        vibe: r.vibe !== null && Number.isInteger(v) && v >= 1 && v <= 10 ? v : null,
        notes: text(r.notes, 5000),
      },
    ];
  });
}

/**
 * Validate a proposal, from Claude or edited in the review UI. Unknown ids
 * become new people (or snap to an existing person with the same name), a
 * forced `personId` gets everything, the same person listed twice is merged,
 * and list items already on the person are dropped.
 *
 * `strict` is for proposals coming back from the client: an id that isn't
 * one of `people` is dropped rather than turned into someone new, and new
 * people must be marked isNew. `journal` keeps events on the (possibly years
 * old) dates written in the text and drops undated ones; see resolveJournalDay.
 */
export function parseProposal(
  raw: unknown,
  opts: { people: KnownPerson[]; noteDay: string; personId?: string | null; strict?: boolean; journal?: boolean },
): Proposal {
  const list = raw && typeof raw === "object" ? (raw as { people?: unknown }).people : null;
  if (!Array.isArray(list)) return { people: [] };
  const byId = new Map(opts.people.map((p) => [p.id, p]));
  const byName = new Map(opts.people.map((p) => [p.name.trim().toLowerCase(), p]));
  const forced = opts.personId ? byId.get(opts.personId) : undefined;

  const merged = new Map<string, ProposedPerson>();
  for (const item of list.slice(0, 20)) {
    if (!item || typeof item !== "object") continue;
    const r = item as Record<string, unknown>;
    const name = text(r.name, 100);
    const claimsId = typeof r.personId === "string" && r.personId !== "";
    if (opts.strict && !forced && (claimsId ? !byId.has(r.personId as string) : r.isNew !== true)) continue;
    const known =
      forced ??
      (typeof r.personId === "string" ? byId.get(r.personId) : undefined) ??
      (name ? byName.get(name.toLowerCase()) : undefined);
    if (!known && !name) continue;
    const p: ProposedPerson = {
      personId: known?.id ?? null,
      name: known?.name ?? name,
      isNew: !known,
      summary: text(r.summary, 120),
      note: text(r.note, 20_000),
      remember: cleanList(r.remember, 30),
      greenFlags: cleanList(r.greenFlags, 15),
      redFlags: cleanList(r.redFlags, 15),
      lessons: text(r.lessons, 5000),
      stage: isStage(r.stage) ? r.stage : null,
      instagram: normalizeInstagram(r.instagram),
      events: parseEvents(r.events, opts.noteDay, opts.journal),
    };
    const key = p.personId ?? `new:${p.name.toLowerCase()}`;
    const prev = merged.get(key);
    merged.set(key, prev ? mergePeople(prev, p) : p);
  }

  return {
    people: [...merged.values()]
      .map((p) => {
        const known = p.personId ? byId.get(p.personId) : undefined;
        if (!known) return p;
        return {
          ...p,
          remember: freshItems(known.remember, p.remember),
          greenFlags: freshItems(known.greenFlags, p.greenFlags),
          redFlags: freshItems(known.redFlags, p.redFlags),
          lessons: p.lessons && known.lessons?.toLowerCase().includes(p.lessons.toLowerCase()) ? "" : p.lessons,
          instagram: p.instagram === known.instagram ? null : p.instagram,
        };
      })
      .filter((p) => p.note || p.summary || p.events.length || p.remember.length || p.greenFlags.length || p.redFlags.length || p.lessons || p.stage || p.instagram),
  };
}

function mergePeople(a: ProposedPerson, b: ProposedPerson): ProposedPerson {
  const join = (x: string, y: string) => [x, y].filter(Boolean).join("\n\n");
  return {
    ...a,
    summary: a.summary || b.summary,
    note: join(a.note, b.note),
    remember: [...a.remember, ...freshItems(a.remember, b.remember)],
    greenFlags: [...a.greenFlags, ...freshItems(a.greenFlags, b.greenFlags)],
    redFlags: [...a.redFlags, ...freshItems(a.redFlags, b.redFlags)],
    lessons: join(a.lessons, b.lessons),
    stage: b.stage ?? a.stage,
    instagram: b.instagram ?? a.instagram,
    events: [...a.events, ...b.events],
  };
}

/** Idempotency key for a Granola meeting filed to one person. */
export function granolaExternalId(meetingId: string, personId: string): string {
  return `granola:${meetingId.trim().slice(0, 120)}:${personId}`;
}

// Filed notes keep where they came from on their last line, so the timeline
// can link back without extra columns: "Source: <label> <url>".
const SOURCE_LINE = /(?:^|\n+)Source: ([^\n]*?)[ \t]*(https?:\/\/\S+)?[ \t]*$/;

export function withSourceLine(notes: string, label?: string | null, url?: string | null): string {
  const l = label?.trim().replace(/\s+/g, " ") ?? "";
  const u = url && /^https?:\/\/\S+$/.test(url.trim()) ? url.trim() : "";
  if (!l && !u) return notes;
  return `${notes}\n\nSource: ${[l || "link", u].filter(Boolean).join(" ")}`;
}

export function splitSourceLine(notes: string | null): { body: string; label: string | null; url: string | null } {
  if (!notes) return { body: "", label: null, url: null };
  const m = notes.match(SOURCE_LINE);
  if (!m || m.index === undefined) return { body: notes, label: null, url: null };
  return { body: notes.slice(0, m.index), label: m[1] || null, url: m[2] ?? null };
}

// ---------------------------------------------------------------------------
// Granola suggestions: people a meeting talked about who aren't on /dating.

/** Trimmed, single-spaced, lowercased: how suggestion names are compared. */
export function normName(name: string): string {
  return name.trim().replace(/\s+/g, " ").toLowerCase();
}

export function sameName(a: string, b: string): boolean {
  return normName(a) === normName(b);
}

export type SuggestionDraft = { name: string; summary: string; note: string };

/** The unmatched people in a proposal, one per name (case-insensitive). */
export function suggestionsFrom(people: ProposedPerson[]): SuggestionDraft[] {
  const out: SuggestionDraft[] = [];
  for (const p of people) {
    const name = p.name.trim().replace(/\s+/g, " ");
    if (p.personId || !name || out.some((o) => sameName(o.name, name))) continue;
    out.push({ name: name.slice(0, 100), summary: p.summary, note: p.note || p.summary });
  }
  return out;
}

// ---------------------------------------------------------------------------
// Organizing a person's journal notes (the free-text DatingPerson.notes) into
// timeline events, flags and lessons. See organizePersonNotes in
// src/lib/dating-organize.ts.

/** Idempotency key on the note event that marks a person's journal as organized. */
export function journalExternalId(personId: string): string {
  return `journal:${personId}`;
}

export const JOURNAL_TITLE = "From journal";

/** What Claude reads: the notes, plus the lessons already written down. "" when there are no notes. */
export function journalText(notes: string | null | undefined, lessons?: string | null): string {
  const n = notes?.trim() ?? "";
  if (!n) return "";
  const l = lessons?.trim();
  return l ? `${n}\n\nLessons I already wrote down:\n${l}` : n;
}

/** Ids of people with notes whose journal hasn't been organized yet, in the given order. */
export function pendingJournalIds(
  people: { id: string; notes: string | null }[],
  organizedExternalIds: Iterable<string | null>,
  skip: Iterable<string> = [],
): string[] {
  const done = new Set(organizedExternalIds);
  const skipped = new Set(skip);
  return people
    .filter((p) => p.notes?.trim() && !done.has(journalExternalId(p.id)) && !skipped.has(p.id))
    .map((p) => p.id);
}

export type OrganizeCounts = { dates: number; moments: number; flags: number; remember: number; lessons: number };

/** What a (validated) proposal adds, counted for the "Added 4 dates, 3 flags" line. */
export function organizeCounts(item: Pick<ProposedPerson, "events" | "greenFlags" | "redFlags" | "remember" | "lessons">): OrganizeCounts {
  const dates = item.events.filter((e) => e.kind === "date").length;
  return {
    dates,
    moments: item.events.length - dates,
    flags: item.greenFlags.length + item.redFlags.length,
    remember: item.remember.length,
    lessons: item.lessons.split(/\n\s*\n|\n(?=\s*[-*•]\s)/).filter((l) => l.trim()).length,
  };
}

const plural = (n: number, one: string, many = `${one}s`) => `${n} ${n === 1 ? one : many}`;

/** "Added 4 dates, 3 flags, 2 lessons", or "Nothing new to add". */
export function describeOrganize(c: OrganizeCounts): string {
  const parts = [
    c.dates && plural(c.dates, "date"),
    c.moments && plural(c.moments, "moment"),
    c.flags && plural(c.flags, "flag"),
    c.remember && plural(c.remember, "detail"),
    c.lessons && plural(c.lessons, "lesson"),
  ].filter(Boolean);
  return parts.length ? `Added ${parts.join(", ")}` : "Nothing new to add";
}

/** The proposal for this person, with the stage kept only when it's still the default. */
export function journalItem(
  person: { id: string; name: string; stage: string },
  proposed: ProposedPerson | undefined,
): ProposedPerson {
  const item: ProposedPerson = proposed ?? {
    personId: person.id,
    name: person.name,
    isNew: false,
    summary: "",
    note: "",
    remember: [],
    greenFlags: [],
    redFlags: [],
    lessons: "",
    stage: null,
    instagram: null,
    events: [],
  };
  const stage = person.stage === "talking" && item.stage && item.stage !== "talking" ? item.stage : null;
  return { ...item, personId: person.id, isNew: false, stage };
}

/** Latest event day (YYYY-MM-DD) in a proposal, or null. */
export function lastEventDay(events: { occurredAt: string }[]): string | null {
  return events.reduce<string | null>((max, e) => (max === null || e.occurredAt > max ? e.occurredAt : max), null);
}

// ---------------------------------------------------------------------------
// Header key dates on a person page

export type KeyDates = {
  /** When we met: metAt, else the first logged moment. */
  met: string | null;
  /** Span of the thing: met (or first moment) to endedAt / last moment when over, else now. */
  from: string | null;
  to: string | null;
  ongoing: boolean;
  days: number | null;
  lastDate: { occurredAt: string; vibe: number | null; title: string } | null;
  dates: number;
};

export function keyDates(
  person: { stage: string; metAt: string | null; endedAt: string | null },
  events: { kind: string; occurredAt: string; vibe: number | null; title: string }[],
  now: number = Date.now(),
): KeyDates {
  const moments = events.filter((e) => e.kind !== "note").sort((a, b) => a.occurredAt.localeCompare(b.occurredAt));
  const dates = moments.filter((e) => e.kind === "date");
  const firstMoment = moments[0]?.occurredAt ?? null;
  const lastMoment = moments[moments.length - 1]?.occurredAt ?? null;
  const met = person.metAt ?? firstMoment;
  const from = [person.metAt, firstMoment].filter((x): x is string => !!x).sort()[0] ?? null;
  const ongoing = person.stage !== "ended";
  const to = ongoing ? null : (person.endedAt ?? lastMoment);
  const end = to ? new Date(to).getTime() : now;
  const days = from ? Math.max(0, Math.round((end - new Date(from).getTime()) / DAY)) : null;
  const last = dates[dates.length - 1];
  return {
    met,
    from,
    to,
    ongoing,
    days,
    lastDate: last ? { occurredAt: last.occurredAt, vibe: last.vibe, title: last.title } : null,
    dates: dates.length,
  };
}

/** "5 days", "3 weeks", "4 months", "1 year 2 months". */
export function fmtDuration(days: number): string {
  if (days < 14) return plural(days, "day");
  if (days < 60) return plural(Math.round(days / 7), "week");
  const months = Math.round(days / 30.44);
  if (months < 12) return plural(months, "month");
  const y = Math.floor(months / 12);
  const m = months % 12;
  return m ? `${plural(y, "year")} ${plural(m, "month")}` : plural(y, "year");
}

/**
 * One quiet line for the person header: "Met Jan 26 · 8 months · 3 dates ·
 * last Sep 12 (8/10)". Empty parts are left out. Days are read in UTC (dates
 * are stored at noon) so server and browser render the same text.
 */
export function datesLine(k: KeyDates, now: number = Date.now()): string {
  const year = new Date(now).getUTCFullYear();
  const day = (iso: string) => {
    const d = new Date(iso);
    return d.toLocaleDateString("en-US", {
      month: "short",
      day: "numeric",
      ...(d.getUTCFullYear() !== year && { year: "numeric" }),
      timeZone: "UTC",
    });
  };
  return [
    k.met && `Met ${day(k.met)}`,
    !!k.days && fmtDuration(k.days),
    k.dates > 0 && plural(k.dates, "date"),
    k.lastDate && `last ${day(k.lastDate.occurredAt)}${k.lastDate.vibe ? ` (${k.lastDate.vibe}/10)` : ""}`,
  ]
    .filter(Boolean)
    .join(" · ");
}

/**
 * The client's local day (YYYY-MM-DD) when it is within a day of the server's
 * UTC day, so the "From journal" note lands on the user's today in the
 * evening too. Anything else falls back to now.
 */
export function clientToday(v: unknown, now: Date = new Date()): Date | string {
  if (typeof v !== "string" || !/^\d{4}-\d{2}-\d{2}$/.test(v)) return now;
  const d = new Date(`${v}T12:00:00Z`);
  if (Number.isNaN(d.getTime()) || d.toISOString().slice(0, 10) !== v) return now;
  return Math.abs(d.getTime() - now.getTime()) <= 36 * 3_600_000 ? v : now;
}
