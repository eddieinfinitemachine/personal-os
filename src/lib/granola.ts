// Granola public API (read-only), used to pull meeting notes onto /dating.
// Docs: https://docs.granola.ai/introduction
//   GET /v1/notes                  → { notes, hasMore, cursor }  (created_after, cursor, page_size ≤ 30)
//   GET /v1/notes/{id}             → note (summary, private notes, attendees…)
//       ?include=transcript        → plus transcript[]; 413 when too big for inline
//   GET /v1/notes/{id}/transcript  → { transcript, hasMore, cursor }  (page_size ≤ 100)
// Auth: "Authorization: Bearer grn_…". Rate limit: 25 burst, 5 req/s sustained.
// The API only returns notes that already have an AI summary and transcript.
//
// Everything here is pure apart from the client's fetch, so it is unit-tested
// with a mocked fetch.

export const GRANOLA_API_URL = "https://public-api.granola.ai/v1";

export type GranolaUser = { name: string | null; email: string };

export type GranolaNoteSummary = {
  id: string;
  object?: "note";
  title: string | null;
  owner: GranolaUser;
  created_at: string;
  updated_at: string;
};

export type GranolaTranscriptItem = {
  speaker: { source: string; attribution?: "me" | "them"; diarization_label?: string; name?: string };
  text: string;
  start_time?: string;
  end_time?: string;
};

export type GranolaNote = GranolaNoteSummary & {
  web_url: string;
  calendar_event: { event_title: string | null; scheduled_start_time: string | null } | null;
  attendees: GranolaUser[];
  summary_text: string;
  summary_markdown: string | null;
  private_notes_text: string | null;
  private_notes_markdown: string | null;
  transcript: GranolaTranscriptItem[] | null;
};

export class GranolaError extends Error {
  constructor(
    message: string,
    readonly status: number,
  ) {
    super(message);
    this.name = "GranolaError";
  }
}

type FetchLike = (url: string, init?: RequestInit) => Promise<Response>;

export type GranolaClient = {
  /** Every note created after `createdAfter`, following the cursor to the end. */
  listNotes(opts: { createdAfter: Date }): Promise<GranolaNoteSummary[]>;
  /** One note; with `transcript`, including the full transcript (paged if it's too big inline). */
  getNote(id: string, opts?: { transcript?: boolean }): Promise<GranolaNote>;
};

const LIST_PAGE_SIZE = 30; // API max
const TRANSCRIPT_PAGE_SIZE = 100; // API max
const MAX_PAGES = 200; // runaway-cursor guard

export function createGranolaClient(opts: {
  apiKey: string;
  baseUrl?: string;
  fetch?: FetchLike;
  /** Gap between requests. 220 ms keeps us under the 5 req/s sustained limit. */
  minIntervalMs?: number;
  /** Retries after a 429 before giving up. */
  retries429?: number;
  sleep?: (ms: number) => Promise<void>;
}): GranolaClient {
  const base = (opts.baseUrl ?? GRANOLA_API_URL).replace(/\/+$/, "");
  const doFetch: FetchLike = opts.fetch ?? ((url, init) => fetch(url, init));
  const minInterval = opts.minIntervalMs ?? 220;
  const retries429 = opts.retries429 ?? 2;
  const sleep = opts.sleep ?? ((ms: number) => new Promise<void>((r) => setTimeout(r, ms)));
  let nextSlot = 0;

  // Serialise request starts at least minInterval apart.
  const throttle = async () => {
    const now = Date.now();
    const wait = nextSlot - now;
    nextSlot = Math.max(now, nextSlot) + minInterval;
    if (wait > 0) await sleep(wait);
  };

  const get = async <T>(path: string, params: Record<string, string | undefined> = {}): Promise<T> => {
    const url = new URL(base + path);
    for (const [k, v] of Object.entries(params)) if (v !== undefined) url.searchParams.set(k, v);
    for (let attempt = 0; ; attempt++) {
      await throttle();
      const res = await doFetch(url.toString(), {
        headers: { Authorization: `Bearer ${opts.apiKey}`, Accept: "application/json" },
        cache: "no-store",
      });
      if (res.ok) return (await res.json()) as T;
      if (res.status === 429 && attempt < retries429) {
        const after = Number(res.headers.get("retry-after"));
        await sleep(Number.isFinite(after) && after > 0 ? Math.min(after, 10) * 1000 : 2000 * (attempt + 1));
        continue;
      }
      throw await errorFor(res, path);
    }
  };

  const getTranscript = async (id: string): Promise<GranolaTranscriptItem[]> => {
    const items: GranolaTranscriptItem[] = [];
    let cursor: string | undefined;
    for (let page = 0; page < MAX_PAGES; page++) {
      const data = await get<{ transcript: GranolaTranscriptItem[]; hasMore: boolean; cursor: string | null }>(
        `/notes/${encodeURIComponent(id)}/transcript`,
        { page_size: String(TRANSCRIPT_PAGE_SIZE), cursor },
      );
      items.push(...(data.transcript ?? []));
      if (!data.hasMore || !data.cursor) break;
      cursor = data.cursor;
    }
    return items;
  };

  return {
    async listNotes({ createdAfter }) {
      const notes: GranolaNoteSummary[] = [];
      let cursor: string | undefined;
      for (let page = 0; page < MAX_PAGES; page++) {
        const data = await get<{ notes: GranolaNoteSummary[]; hasMore: boolean; cursor: string | null }>("/notes", {
          created_after: createdAfter.toISOString(),
          page_size: String(LIST_PAGE_SIZE),
          cursor,
        });
        notes.push(...(data.notes ?? []));
        if (!data.hasMore || !data.cursor) break;
        cursor = data.cursor;
      }
      return notes;
    },

    async getNote(id, { transcript = false } = {}) {
      const path = `/notes/${encodeURIComponent(id)}`;
      if (!transcript) return get<GranolaNote>(path);
      try {
        return await get<GranolaNote>(path, { include: "transcript" });
      } catch (e) {
        // TRANSCRIPT_TOO_LARGE: take the note without it, then page the transcript.
        if (!(e instanceof GranolaError) || e.status !== 413) throw e;
        const note = await get<GranolaNote>(path);
        return { ...note, transcript: await getTranscript(id) };
      }
    },
  };
}

async function errorFor(res: Response, path: string): Promise<GranolaError> {
  const body = (await res.text().catch(() => "")).slice(0, 300);
  const msg =
    res.status === 401
      ? "Granola rejected GRANOLA_API_KEY (401): check the key is valid and not revoked"
      : res.status === 403
        ? "GRANOLA_API_KEY isn't allowed to read notes (403): it needs the Personal notes scope"
        : res.status === 429
          ? "Granola rate limit hit (429): try again in a minute"
          : `Granola ${res.status} on ${path}${body ? `: ${body}` : ""}`;
  return new GranolaError(msg, res.status);
}

/** A client from GRANOLA_API_KEY, or null when it isn't set. */
export function granolaFromEnv(): GranolaClient | null {
  const apiKey = process.env.GRANOLA_API_KEY?.trim();
  if (!apiKey) return null;
  return createGranolaClient({ apiKey, baseUrl: process.env.GRANOLA_API_URL?.trim() || undefined });
}

// ---------------------------------------------------------------------------
// Which meetings are worth a Claude call

/** Therapy sessions are titled "Therapy" (or "Block", the calendar alias for it). */
export function isTherapyTitle(title: string | null | undefined): boolean {
  const t = title?.trim().toLowerCase();
  return t === "therapy" || t === "block";
}

export const DATING_KEYWORDS = [
  "date",
  "dating",
  "girlfriend",
  "hinge",
  "bumble",
  "tinder",
  "raya",
  "crush",
  "ex",
  "hookup",
  "relationship",
  "first date",
  "second date",
];

/** Names to look for: each person's full name and, when distinct, their first name. */
export function namesToMatch(people: { name: string }[]): string[] {
  const out = new Set<string>();
  for (const p of people) {
    const full = p.name.trim().replace(/\s+/g, " ");
    if (!full) continue;
    out.add(full);
    const first = full.split(" ")[0];
    if (first.length >= 2) out.add(first);
  }
  return [...out];
}

function escapeRe(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

/** Case-insensitive whole-word (letters/digits either side don't count) match. */
function wordMatcher(terms: string[]): RegExp | null {
  const alts = terms
    .map((t) => t.trim())
    .filter(Boolean)
    .sort((a, b) => b.length - a.length)
    .map((t) => escapeRe(t).replace(/ /g, "\\s+"));
  if (!alts.length) return null;
  return new RegExp(`(?<![\\p{L}\\p{N}])(?:${alts.join("|")})(?![\\p{L}\\p{N}])`, "iu");
}

export type Selection = { candidate: boolean; reason: string | null };

/**
 * Whether a meeting should go to the dating filer: a therapy session, or the
 * title / summary / my notes mention someone on /dating or a dating word.
 */
export function selectMeeting(
  note: { title?: string | null; summary?: string | null; notes?: string | null },
  names: string[],
): Selection {
  if (isTherapyTitle(note.title)) return { candidate: true, reason: "therapy" };
  const text = [note.title, note.summary, note.notes].filter(Boolean).join("\n");
  if (!text) return { candidate: false, reason: null };
  const name = wordMatcher(names)?.exec(text);
  if (name) return { candidate: true, reason: `mentions ${name[0]}` };
  const kw = wordMatcher(DATING_KEYWORDS)?.exec(text);
  if (kw) return { candidate: true, reason: `mentions "${kw[0].toLowerCase()}"` };
  return { candidate: false, reason: null };
}

// ---------------------------------------------------------------------------
// Note text for the filer

function speakerLabel(s: GranolaTranscriptItem["speaker"]): string {
  if (s.name) return s.name;
  if (s.attribution === "me") return "Me";
  if (s.attribution === "them") return "Them";
  return s.diarization_label ?? "";
}

/**
 * My notes + AI summary + transcript, capped to `budget` chars. Notes and
 * summary are kept first; the transcript fills whatever room is left.
 */
export function granolaNoteText(note: GranolaNote, budget: number): string {
  const head = [
    note.private_notes_markdown?.trim() || note.private_notes_text?.trim()
      ? `My notes:\n${(note.private_notes_markdown?.trim() || note.private_notes_text?.trim())!}`
      : null,
    note.summary_markdown?.trim() || note.summary_text?.trim()
      ? `Summary:\n${(note.summary_markdown?.trim() || note.summary_text?.trim())!}`
      : null,
  ]
    .filter(Boolean)
    .join("\n\n");
  if (head.length >= budget) return head.slice(0, budget);

  const lines = (note.transcript ?? [])
    .map((t) => {
      const text = t.text?.trim();
      if (!text) return null;
      const who = speakerLabel(t.speaker);
      return who ? `${who}: ${text}` : text;
    })
    .filter(Boolean);
  if (!lines.length) return head;

  const label = "Transcript:\n";
  const sep = head ? "\n\n" : "";
  const room = budget - head.length - sep.length - label.length;
  if (room <= 0) return head;
  return head + sep + label + lines.join("\n").slice(0, room);
}
