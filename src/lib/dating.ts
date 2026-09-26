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

export type ParsedMessage = { sentAt: Date; fromMe: boolean; text: string; sender: string };

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

/** Stable id for a pasted message so re-pasting the same chat dedupes. */
export async function pasteExternalId(m: { sentAt: Date; fromMe: boolean; text: string }, personId: string) {
  const data = new TextEncoder().encode(`${personId}|${m.sentAt.toISOString()}|${m.fromMe ? 1 : 0}|${m.text}`);
  const digest = await crypto.subtle.digest("SHA-256", data);
  const hex = [...new Uint8Array(digest)].map((b) => b.toString(16).padStart(2, "0")).join("");
  return `paste:${hex.slice(0, 32)}`;
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

function parseEvents(raw: unknown, noteDay: string): ProposedEvent[] {
  if (!Array.isArray(raw)) return [];
  return raw.slice(0, 10).flatMap((e): ProposedEvent[] => {
    if (!e || typeof e !== "object") return [];
    const r = e as Record<string, unknown>;
    const title = text(r.title, 200);
    if (!title || !(FILED_EVENT_KINDS as readonly unknown[]).includes(r.kind)) return [];
    const v = Number(r.vibe);
    return [
      {
        kind: r.kind as FiledEventKind,
        title,
        occurredAt: resolveEventDay(r.occurredAt, noteDay),
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
 * people must be marked isNew.
 */
export function parseProposal(
  raw: unknown,
  opts: { people: KnownPerson[]; noteDay: string; personId?: string | null; strict?: boolean },
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
      events: parseEvents(r.events, opts.noteDay),
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
        };
      })
      .filter((p) => p.note || p.summary || p.events.length || p.remember.length || p.greenFlags.length || p.redFlags.length || p.lessons || p.stage),
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
