// Meetings as /projects activity. Every 2 hours the last 14 days of meetings
// (Google Calendar events with other people, and Granola notes) are filed:
// a meeting about a known card (personal-os Project, repo, topic) shows on
// that card; a recurring topic that matches nothing becomes a Suggested card.
//
// Privacy: therapy and dating meetings never reach Claude. The Granola
// helpers are written to *select* those meetings for the dating filer; here
// the same test *excludes* them, and it over-excludes on purpose (any
// whole-word "date", any name on /dating). Excluded and unlinked meetings are
// stored with no title, so they are never read twice and keep no text.

import { callClaudeJSON } from "@/lib/claude";
import { loadKnownPeople } from "@/lib/dating-filer";
import { isGoogleConfigured } from "@/lib/google";
import { granolaFromEnv, namesToMatch, selectMeeting, type GranolaNote, type GranolaNoteSummary } from "@/lib/granola";
import { INBOX_PROJECT_NAME } from "@/lib/lists";
import { prisma } from "@/lib/prisma";
import { listPrimaryEvents, type CalendarEvent } from "./calendar";
import { companyFor, isCompany, type Company } from "./company";

const DAY = 24 * 60 * 60 * 1000;
export const MEETING_WINDOW_DAYS = 14;
const REPO_WINDOW_DAYS = 90;
/** Meetings classified per run (one Claude call); the rest wait for the next run. */
export const MAX_PER_RUN = 40;
const SUMMARY_CHARS = 1500;
/** Meetings in the window before a candidate topic is suggested. */
export const SUGGEST_AT = 2;
const SAME_MEETING_MS = 30 * 60 * 1000;
const SKIPPED_EVENT_TYPES = new Set(["workingLocation", "outOfOffice", "focusTime"]);

type Meeting = {
  externalKey: string;
  title: string;
  at: Date;
  url: string | null;
  domains: string[];
  summary: string | null;
  /** Marked private / confidential on the calendar. */
  private: boolean;
};

export type MeetingSyncResult = {
  calendarEvents: number;
  granolaNotes: number;
  /** Meetings written this run (excluded + linked + unlinked). */
  processed: number;
  /** Stopped by the privacy gate before Claude. */
  excluded: number;
  linked: number;
  unlinked: number;
  /** New meetings left for the next run (over MAX_PER_RUN). */
  deferred: number;
  /** Calendar rows replaced by the Granola note of the same meeting. */
  replaced: number;
  topicsCreated: string[];
  topicsSuggested: string[];
  errors: string[];
};

/** My addresses: the founder, the Granola owner and email-shaped GITHUB_IDENTITIES. */
export function myEmails(): Set<string> {
  const out = new Set<string>();
  for (const raw of [
    process.env.FOUNDER_EMAIL ?? "emcohen@me.com",
    process.env.GRANOLA_OWNER_EMAIL,
    ...(process.env.GITHUB_IDENTITIES ?? "").split(","),
  ]) {
    const v = raw?.trim().toLowerCase();
    if (v && v.includes("@")) out.add(v);
  }
  return out;
}

const domainOf = (email: string) => email.split("@")[1]?.toLowerCase() ?? "";

/** A real meeting: timed, not declined, with at least one other person. */
export function isMeetingEvent(ev: CalendarEvent, mine: Set<string>): boolean {
  if (ev.status === "cancelled" || !ev.start?.dateTime) return false;
  if (ev.eventType && SKIPPED_EVENT_TYPES.has(ev.eventType)) return false;
  const attendees = ev.attendees ?? [];
  if (attendees.some((a) => a.self && a.responseStatus === "declined")) return false;
  return attendees.some((a) => !a.self && !a.resource && !!a.email && !mine.has(a.email.toLowerCase()));
}

function otherDomains(emails: (string | null | undefined)[], mine: Set<string>): string[] {
  const out = new Set<string>();
  for (const e of emails) {
    if (!e || mine.has(e.toLowerCase())) continue;
    const d = domainOf(e);
    if (d) out.add(d);
  }
  return [...out].sort();
}

const norm = (s: string | null | undefined) => (s ?? "").trim().toLowerCase().replace(/\s+/g, " ");

type NoteRef = { title: string; at: number };

/** Same meeting: same title (any case) and starts within 30 minutes. */
function sameMeeting(ev: CalendarEvent, refs: NoteRef[]): boolean {
  const title = norm(ev.summary);
  const at = Date.parse(ev.start?.dateTime ?? "");
  if (!title || Number.isNaN(at)) return false;
  return refs.some((r) => r.title === title && Math.abs(r.at - at) <= SAME_MEETING_MS);
}

function noteRefs(summary: GranolaNoteSummary, full?: GranolaNote): NoteRef[] {
  const refs: NoteRef[] = [{ title: norm(summary.title), at: Date.parse(summary.created_at) }];
  const ce = full?.calendar_event;
  if (ce?.event_title && ce.scheduled_start_time) {
    refs.push({ title: norm(ce.event_title), at: Date.parse(ce.scheduled_start_time) });
  }
  return refs.filter((r) => r.title && !Number.isNaN(r.at));
}

export function slugify(s: string): string {
  return s
    .toLowerCase()
    .normalize("NFKD")
    .replace(/[̀-ͯ]/g, "")
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 60);
}

// ---------------------------------------------------------------------------
// Classification

type Card = { key: string; name: string; company: string; note?: string | null };

type RawDecision = {
  externalKey?: unknown;
  match?: unknown;
  topic?: unknown;
  company?: unknown;
  personal?: unknown;
};

export type Decision = { match: string | null; topic: string | null; company: Company | null };

const SYSTEM = `You file Eddie Cohen's meetings onto the projects he is working on.
Eddie runs Infinite Machine (electric scooters/vehicles; "C2" is a product), and also works on Olto, Silo and Walden; anything else is Personal.

For each meeting, decide:
- "match": the key of the ONE known card the meeting is clearly about, or null. Only use keys from the known cards list, exactly as written.
- "topic": when it matches no card but is about a distinct, ongoing piece of work (a deal, customer, partner, hire, initiative), a short 1–4 word name for it (e.g. "Fleet pilot", "Series A"). Use null for generic meetings (1:1s, standups, all-hands, interviews with no named initiative, "sync") and when "match" is set.
- "company": one of "Infinite Machine", "Olto", "Silo", "Walden", "Personal", or null.
- "personal": true for anything about health, family, friends, social plans, dating or relationships. Personal meetings get match null and topic null.

Reply with JSON only: {"meetings":[{"externalKey":"…","match":"…"|null,"topic":"…"|null,"company":"…"|null,"personal":false}]}`;

function buildPrompt(cards: Card[], meetings: Meeting[]): string {
  const cardLines = cards.length
    ? cards.map((c) => `- ${c.key} | ${c.name} | ${c.company}${c.note ? ` | ${c.note.slice(0, 120)}` : ""}`).join("\n")
    : "(none)";
  const meetingBlocks = meetings
    .map((m) =>
      [
        `### ${m.externalKey}`,
        `Title: ${m.title}`,
        `Date: ${m.at.toISOString().slice(0, 10)}`,
        `Attendee domains: ${m.domains.join(", ") || "(none)"}`,
        m.summary ? `Summary:\n${m.summary.slice(0, SUMMARY_CHARS)}` : null,
      ]
        .filter(Boolean)
        .join("\n"),
    )
    .join("\n\n");
  return `Known cards (key | name | company | about):\n${cardLines}\n\nMeetings:\n\n${meetingBlocks}`;
}

/** Keep only well-formed decisions; a match must be a known card key. */
export function validateDecisions(
  raw: unknown,
  meetingKeys: Set<string>,
  cardKeys: Set<string>,
): Map<string, Decision> {
  const out = new Map<string, Decision>();
  const list = (raw as { meetings?: unknown })?.meetings;
  if (!Array.isArray(list)) return out;
  for (const item of list as RawDecision[]) {
    if (typeof item?.externalKey !== "string" || !meetingKeys.has(item.externalKey)) continue;
    if (item.personal === true) {
      out.set(item.externalKey, { match: null, topic: null, company: null });
      continue;
    }
    let match = typeof item.match === "string" && cardKeys.has(item.match) ? item.match : null;
    let topic = !match && typeof item.topic === "string" ? item.topic.trim().slice(0, 60) || null : null;
    // A "new" topic that is really a known one links to it.
    if (topic && cardKeys.has(`topic:${slugify(topic)}`)) {
      match = `topic:${slugify(topic)}`;
      topic = null;
    }
    if (topic && !slugify(topic)) topic = null;
    out.set(item.externalKey, { match, topic, company: isCompany(item.company) ? item.company : null });
  }
  return out;
}

// ---------------------------------------------------------------------------
// Sync

export async function syncMeetingProjects(userId: string, opts: { now?: Date } = {}): Promise<MeetingSyncResult> {
  const now = opts.now ?? new Date();
  const since = new Date(now.getTime() - MEETING_WINDOW_DAYS * DAY);
  const mine = myEmails();
  const result: MeetingSyncResult = {
    calendarEvents: 0,
    granolaNotes: 0,
    processed: 0,
    excluded: 0,
    linked: 0,
    unlinked: 0,
    deferred: 0,
    replaced: 0,
    topicsCreated: [],
    topicsSuggested: [],
    errors: [],
  };

  // 1. Collect.
  const events = isGoogleConfigured()
    ? (await listPrimaryEvents(since, now)).filter((ev) => isMeetingEvent(ev, mine))
    : [];
  const granola = granolaFromEnv();
  const owner = process.env.GRANOLA_OWNER_EMAIL?.trim().toLowerCase();
  const notes = granola
    ? (await granola.listNotes({ createdAfter: since })).filter(
        (n) => !owner || n.owner?.email?.toLowerCase() === owner,
      )
    : [];
  result.calendarEvents = events.length;
  result.granolaNotes = notes.length;

  const eventKey = (ev: CalendarEvent) => `gcal:${ev.id}`;
  const noteKey = (n: { id: string }) => `granola:${n.id}`;
  const allKeys = [...events.map(eventKey), ...notes.map(noteKey)];
  const done = new Set(
    allKeys.length
      ? (
          await prisma.projectMeeting.findMany({
            where: { userId, externalKey: { in: allKeys } },
            select: { externalKey: true },
          })
        ).map((m) => m.externalKey)
      : [],
  );

  // A Granola note replaces the calendar event of the same meeting (it is richer).
  const summaryRefs = notes.flatMap((n) => noteRefs(n));
  const newNotes = notes.filter((n) => !done.has(noteKey(n)));
  const newEvents = events.filter((ev) => !done.has(eventKey(ev)) && !sameMeeting(ev, summaryRefs));
  const queue = [
    ...newNotes.map((n) => ({ at: Date.parse(n.created_at), note: n as GranolaNoteSummary, event: null })),
    ...newEvents.map((ev) => ({ at: Date.parse(ev.start!.dateTime!), note: null, event: ev })),
  ].sort((a, b) => a.at - b.at);
  const batch = queue.slice(0, MAX_PER_RUN);
  result.deferred = queue.length - batch.length;

  const fetched: { summary: GranolaNoteSummary; note: GranolaNote }[] = [];
  for (const item of batch) {
    if (!item.note || !granola) continue;
    try {
      fetched.push({ summary: item.note, note: await granola.getNote(item.note.id) });
    } catch (e) {
      // Not stored, so it is retried next run.
      const status = (e as { status?: number }).status;
      result.errors.push(`granola note ${item.note.id}: ${status ? `HTTP ${status}` : "fetch failed"}`);
    }
  }
  const fullRefs = fetched.flatMap((f) => noteRefs(f.summary, f.note));
  const replacedKeys = events
    .filter((ev) => done.has(eventKey(ev)) && sameMeeting(ev, fullRefs))
    .map(eventKey);

  const meetings: Meeting[] = [];
  for (const item of batch) {
    if (item.event) {
      const ev = item.event;
      if (sameMeeting(ev, fullRefs)) continue;
      meetings.push({
        externalKey: eventKey(ev),
        title: ev.summary?.trim() || "(untitled)",
        at: new Date(ev.start!.dateTime!),
        url: ev.htmlLink ?? null,
        domains: otherDomains((ev.attendees ?? []).map((a) => a.email), mine),
        summary: null,
        private: ev.visibility === "private" || ev.visibility === "confidential",
      });
    } else if (item.note) {
      const f = fetched.find((x) => x.summary.id === item.note!.id);
      if (!f) continue;
      const start = f.note.calendar_event?.scheduled_start_time;
      meetings.push({
        externalKey: noteKey(f.note),
        title: f.note.title?.trim() || f.note.calendar_event?.event_title?.trim() || "(untitled)",
        at: new Date(start && !Number.isNaN(Date.parse(start)) ? start : f.note.created_at),
        url: f.note.web_url ?? null,
        domains: otherDomains((f.note.attendees ?? []).map((a) => a.email), mine),
        summary: f.note.summary_text?.trim() || f.note.summary_markdown?.trim() || null,
        private: false,
      });
    }
  }

  // 2. Privacy gate, before anything reaches Claude.
  const names = namesToMatch(await loadKnownPeople(userId));
  const excluded = meetings.filter(
    (m) => m.private || selectMeeting({ title: m.title, summary: m.summary }, names).candidate,
  );
  const excludedKeys = new Set(excluded.map((m) => m.externalKey));
  const toClassify = meetings.filter((m) => !excludedKeys.has(m.externalKey));

  // 3. Classify.
  const [projects, repos, topics] = await Promise.all([
    prisma.project.findMany({ where: { userId, archived: false }, select: { id: true, name: true } }),
    prisma.projectSource.findMany({
      where: { userId, kind: "repo", lastActivityAt: { gte: new Date(now.getTime() - REPO_WINDOW_DAYS * DAY) } },
      select: { id: true, key: true, name: true, company: true, description: true },
    }),
    prisma.projectSource.findMany({
      where: { userId, kind: "topic" },
      select: { id: true, key: true, name: true, company: true, state: true, projectId: true },
    }),
  ]);
  const lifeProjects = projects.filter(
    (p) => p.name.trim().toLowerCase() !== INBOX_PROJECT_NAME.toLowerCase() && p.name.trim() !== "Journal",
  );
  const cards: Card[] = [
    ...lifeProjects.map((p) => ({ key: `project:${p.id}`, name: p.name, company: companyFor({ name: p.name }) })),
    ...repos.map((r) => ({ key: `repo:${r.key}`, name: r.name, company: r.company, note: r.description })),
    ...topics.map((t) => ({ key: `topic:${t.key}`, name: t.name, company: t.company })),
  ];
  const cardKeys = new Set(cards.map((c) => c.key));

  let decisions = new Map<string, Decision>();
  let classified = true;
  if (toClassify.length) {
    try {
      const raw = await callClaudeJSON<unknown>({
        system: SYSTEM,
        user: buildPrompt(cards, toClassify),
        maxTokens: 6000,
        timeoutMs: 150_000,
      });
      decisions = validateDecisions(raw, new Set(toClassify.map((m) => m.externalKey)), cardKeys);
    } catch (e) {
      // Classified meetings are not stored, so they are retried next run.
      classified = false;
      const status = (e as { status?: number }).status;
      const kind = status ? `HTTP ${status}` : e instanceof SyntaxError ? "parse" : (e as Error).name || "error";
      result.errors.push(`classify: ${kind}`);
      console.error("projects meetings: classify failed:", kind);
    }
  }

  // 4. Write.
  const projectIds = new Set(lifeProjects.map((p) => p.id));
  const repoByKey = new Map(repos.map((r) => [r.key, r]));
  const topicByKey = new Map(topics.map((t) => [t.key, t]));
  const writes = [...excluded, ...(classified ? toClassify : [])];
  if (!writes.length && !replacedKeys.length) return result;

  await prisma.$transaction(
    async (tx) => {
      if (replacedKeys.length) {
        const del = await tx.projectMeeting.deleteMany({ where: { userId, externalKey: { in: replacedKeys } } });
        result.replaced = del.count;
      }
      const touched = new Map<string, Date>(); // sourceId → newest meeting
      const touchedTopics = new Map<string, { name: string; state: string }>();
      for (const m of writes) {
        let link: { sourceId?: string; projectId?: string } | null = null;
        const d = excludedKeys.has(m.externalKey) ? null : decisions.get(m.externalKey);
        if (d?.match?.startsWith("project:") && projectIds.has(d.match.slice(8))) {
          link = { projectId: d.match.slice(8) };
        } else if (d?.match?.startsWith("repo:")) {
          const repo = repoByKey.get(d.match.slice(5));
          if (repo) link = { sourceId: repo.id };
        } else if (d?.match?.startsWith("topic:") || d?.topic) {
          const slug = d.match ? d.match.slice(6) : slugify(d.topic!);
          let topic = topicByKey.get(slug);
          if (!topic) {
            const name = d.topic!;
            const created = await tx.projectSource.upsert({
              where: { userId_kind_key: { userId, kind: "topic", key: slug } },
              create: {
                userId,
                kind: "topic",
                key: slug,
                name,
                company: d.company ?? companyFor({ name }),
                state: "candidate",
                lastActivityAt: m.at,
              },
              update: {},
              select: { id: true, key: true, name: true, company: true, state: true, projectId: true },
            });
            topic = created;
            topicByKey.set(slug, created);
            result.topicsCreated.push(name);
          }
          if (topic.state === "accepted") {
            link = { sourceId: topic.id, ...(topic.projectId ? { projectId: topic.projectId } : {}) };
          } else if (topic.state !== "dismissed") {
            link = { sourceId: topic.id };
            touchedTopics.set(topic.id, { name: topic.name, state: topic.state });
          }
          // Dismissed: the meeting is stored but links nothing visible.
        }

        await tx.projectMeeting.upsert({
          where: { userId_externalKey: { userId, externalKey: m.externalKey } },
          create: {
            userId,
            externalKey: m.externalKey,
            occurredAt: m.at,
            title: link ? m.title : null,
            url: link ? m.url : null,
            sourceId: link?.sourceId ?? null,
            projectId: link?.projectId ?? null,
          },
          update: {},
        });
        if (excludedKeys.has(m.externalKey)) result.excluded++;
        else if (link) result.linked++;
        else result.unlinked++;
        result.processed++;
        if (link?.sourceId) {
          const prev = touched.get(link.sourceId);
          if (!prev || prev < m.at) touched.set(link.sourceId, m.at);
        }
      }

      for (const [id, at] of touched) {
        await tx.projectSource.updateMany({
          where: { id, OR: [{ lastActivityAt: null }, { lastActivityAt: { lt: at } }] },
          data: { lastActivityAt: at },
        });
      }
      for (const [id, topic] of touchedTopics) {
        if (topic.state !== "candidate") continue;
        const count = await tx.projectMeeting.count({ where: { sourceId: id, occurredAt: { gte: since } } });
        if (count < SUGGEST_AT) continue;
        await tx.projectSource.updateMany({ where: { id, state: "candidate" }, data: { state: "suggested" } });
        result.topicsSuggested.push(topic.name);
      }
    },
    { timeout: 60_000, maxWait: 10_000 },
  );

  return result;
}
