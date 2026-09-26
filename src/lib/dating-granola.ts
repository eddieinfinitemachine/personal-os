import { NOTE_BUDGET, fileGranolaMeeting, granolaMeetingsDone, loadKnownPeople } from "@/lib/dating-filer";
import {
  GranolaError,
  granolaFromEnv,
  granolaNoteText,
  namesToMatch,
  selectMeeting,
  type GranolaClient,
  type GranolaNote,
} from "@/lib/granola";

// Pulls Granola meetings through the Granola API and files the dating-related
// ones (therapy sessions, or ones that mention someone on /dating or a dating
// word) with the same filer the capture endpoint uses.
//
// One call is one bounded batch: it walks the listed notes oldest-first, skips
// ones already handled with no Granola detail fetch or Claude call, screens
// the rest and files at most `limit` of them. It returns `nextSince` (the last
// note it looked at) and `remaining`, so a caller loops with
// since = nextSince until remaining is 0.

export const DEFAULT_SYNC_LIMIT = 4;
/** Stop starting new Claude calls after this long (functions get 300 s). */
const DEFAULT_BUDGET_MS = 200_000;

export type GranolaSyncResult = {
  /** Notes looked at this batch (already-handled, not mine, screened out, filed). */
  processed: number;
  /** Person notes filed onto people already on /dating. */
  filed: number;
  /** New pending "New from Granola" suggestions. */
  suggestions: number;
  /** Of processed: already handled before, or someone else's note. */
  skipped: number;
  /** Notes after `nextSince` still to look at. */
  remaining: number;
  /** Meetings sent to Claude this batch. */
  meetings: number;
  errors: { meetingId: string; title: string | null; error: string }[];
  /** Pass as `since` for the next batch. */
  nextSince: string;
};

export class GranolaNotConfigured extends Error {
  constructor() {
    super("GRANOLA_API_KEY not set");
  }
}

export async function syncGranola(
  userId: string,
  opts: {
    since: Date;
    limit?: number;
    client?: GranolaClient;
    /** Only file notes owned by this email (GRANOLA_OWNER_EMAIL); unset = every note the key can see. */
    ownerEmail?: string | null;
    budgetMs?: number;
  },
): Promise<GranolaSyncResult> {
  const client = opts.client ?? granolaFromEnv();
  if (!client) throw new GranolaNotConfigured();
  const limit = Math.max(1, opts.limit ?? DEFAULT_SYNC_LIMIT);
  const deadline = Date.now() + (opts.budgetMs ?? DEFAULT_BUDGET_MS);
  const owner = (opts.ownerEmail === undefined ? process.env.GRANOLA_OWNER_EMAIL : opts.ownerEmail)
    ?.trim()
    .toLowerCase();

  // created_after may or may not be inclusive; keep it strict so nextSince
  // never hands back the note a batch ended on.
  const sinceMs = opts.since.getTime();
  const notes = (await client.listNotes({ createdAfter: opts.since }))
    .filter((n) => Date.parse(n.created_at) > sinceMs)
    .sort((a, b) => Date.parse(a.created_at) - Date.parse(b.created_at) || a.id.localeCompare(b.id));

  const done = await granolaMeetingsDone(userId, notes.map((n) => n.id));
  const names = namesToMatch(await loadKnownPeople(userId));

  const out: GranolaSyncResult = {
    processed: 0,
    filed: 0,
    suggestions: 0,
    skipped: 0,
    remaining: 0,
    meetings: 0,
    errors: [],
    nextSince: opts.since.toISOString(),
  };

  let screened = 0; // notes that cost a Granola fetch this batch
  let i = 0;
  for (; i < notes.length; i++) {
    const n = notes[i];
    if (done.has(n.id) || (owner && n.owner?.email?.toLowerCase() !== owner)) {
      out.skipped++;
      continue;
    }
    // Only screening costs anything, so only it ends a batch (and a batch always screens one).
    if (screened > 0 && (out.meetings >= limit || Date.now() > deadline)) break;
    screened++;

    try {
      // A title hit fetches the transcript straight away; anything else is
      // screened on its summary and my notes first.
      let note: GranolaNote;
      if (selectMeeting({ title: n.title }, names).candidate) {
        note = await client.getNote(n.id, { transcript: true });
      } else {
        const brief = await client.getNote(n.id);
        const pick = selectMeeting(
          { title: brief.title, summary: brief.summary_text, notes: brief.private_notes_text },
          names,
        );
        if (!pick.candidate) continue;
        note = await client.getNote(n.id, { transcript: true });
      }

      out.meetings++;
      const res = await fileGranolaMeeting(
        userId,
        {
          meetingId: n.id,
          occurredAt: new Date(note.calendar_event?.scheduled_start_time || note.created_at),
          title: note.title?.trim().slice(0, 200) || null,
          url: note.web_url && /^https?:\/\/\S+$/.test(note.web_url) ? note.web_url : null,
          text: granolaNoteText(note, NOTE_BUDGET),
        },
        { markEmpty: true },
      );
      if (res.status === "skipped") out.skipped++;
      else if (res.status === "error") out.errors.push({ meetingId: n.id, title: n.title, error: res.error });
      else {
        out.filed += res.filed.length;
        out.suggestions += res.suggestions.length;
      }
    } catch (e) {
      // Auth / rate-limit problems apply to every note: stop and surface them.
      if (e instanceof GranolaError && [401, 403, 429].includes(e.status)) throw e;
      console.error("granola sync: note failed", n.id, e);
      out.errors.push({ meetingId: n.id, title: n.title, error: e instanceof Error ? e.message : String(e) });
    }
  }

  out.processed = i;
  out.remaining = notes.length - i;
  if (i > 0) out.nextSince = notes[i - 1].created_at;
  return out;
}
