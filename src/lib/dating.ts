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
