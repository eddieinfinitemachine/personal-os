// Pure helpers for Granola meeting import: the extraction prompt, owner → list
// routing, and validation of the model's raw items. The routes do the I/O.
import { aliasTargetsFromLists } from "@/lib/alias";
import { TEAM, type TeamMember } from "@/lib/team";

type ListRef = { id: string; name: string };

// One extracted action item, with the destination list resolved server-side.
// listId is null when no team list matched: the review defaults those to
// To Do (which commit files under the Inbox project for triage).
export type MeetingItem = {
  title: string;
  owner: string | null;
  notes: string | null;
  dueDate: string | null; // YYYY-MM-DD, only when an explicit deadline was stated
  listId: string | null;
  listName: string | null;
};

// Raw shape Claude returns before validation.
export type RawItem = {
  title?: unknown;
  owner?: unknown;
  notes?: unknown;
  dueDate?: unknown;
  listName?: unknown;
};

const norm = (s: string) => s.trim().toLowerCase();
const firstToken = (s: string) => norm(s).split(/\s+/)[0] ?? "";

/** Longest shared prefix, so "David" still matches the alias "dave". */
function commonPrefixLen(a: string, b: string): number {
  let i = 0;
  while (i < a.length && i < b.length && a[i] === b[i]) i++;
  return i;
}

/** TEAM entries whose list the user can actually see, paired with that list. */
function teamWithLists(lists: ListRef[]): { member: TeamMember; list: ListRef }[] {
  const byName = new Map(lists.map((l) => [norm(l.name), l]));
  return TEAM.flatMap((member) => {
    const list = byName.get(norm(member.listName));
    return list ? [{ member, list }] : [];
  });
}

function describeMember(m: TeamMember): string {
  const [first] = m.names;
  const full = m.names.find((n) => n.includes(" ") && n !== first);
  return `${first}${full ? ` (${full})` : ""}, ${m.role}`;
}

/** The team-lists block of the prompt: TEAM entries first, then other EC/* aliases. */
export function teamListBlock(lists: ListRef[]): string {
  const team = teamWithLists(lists);
  const teamNames = new Set(team.map((t) => norm(t.list.name)));
  const lines = [
    ...team.map((t) => `- "${t.list.name}" — ${describeMember(t.member)}`),
    ...aliasTargetsFromLists(lists)
      .filter((t) => !teamNames.has(norm(t.listName)))
      .map((t) => `- "${t.listName}" — ${t.alias}`),
  ];
  return lines.length ? lines.join("\n") : "- (none — leave listName null for every item)";
}

export function buildSystem(lists: ListRef[], today: string): string {
  return `You extract action items from a meeting for Eddie Cohen's personal task manager. Eddie delegates work to his team through per-person lists.

The input is a Granola meeting note: Granola's AI summary (often with a "Next Steps" section naming owners in parentheses), sometimes Eddie's own notes, then the raw transcript. Meetings ramble — pull out ONLY the concrete next steps: things a specific person committed to do, or the group explicitly agreed someone should do. Use the summary as a strong hint, and the transcript to confirm owners and add context.

Output ONLY a single JSON object, no prose. Schema:
{
  "items": [
    {
      "title": string,             // short imperative task, faithful to the meeting's own wording
      "owner": string | null,      // first name of the person responsible, as referred to in the meeting
      "notes": string | null,      // up to ~200 chars of context from the discussion the owner needs; null if the title is self-explanatory
      "dueDate": "YYYY-MM-DD" | null, // only if an explicit deadline was stated; else null
      "listName": string | null    // one of the team lists below when the owner clearly maps to one; else null
    }
  ]
}

Team lists (route an item to one when its OWNER is that person):
${teamListBlock(lists)}

Rules:
- Only real commitments. Skip ideas merely floated, open questions, and decisions that need no follow-up work.
- Titles stay close to the words used in the meeting; never invent or embellish work that wasn't agreed.
- One item per distinct commitment; collapse restatements of the same commitment into one.
- owner is whoever will DO the work (addressed by name or volunteering), not whoever raised the topic. Names are often transcribed sloppily ("Obi"/"Obie") — normalize to the team-list spelling when it's clearly the same person.
- Items owned by Eddie himself, or with no clear owner, get listName null (they go to Eddie's own To Do). Set owner to "Eddie" for his own items, null when nobody is clearly responsible.
- If the owner doesn't map to a team list, leave listName null.
- Today is ${today}. Resolve relative deadlines ("by end of day", "Wednesday") against the meeting date if known, else today.
- If nothing actionable, return { "items": [] }.`;
}

/**
 * Where an item goes: the model's listName when it names a real accessible
 * list; else the owner matched against TEAM names (case-insensitive, also by
 * first token so "David Vollbach" → EC/DV); else the EC/* alias table (exact
 * or shared prefix ≥ 3 so "David" → EC/Dave); else null (To Do).
 */
export function resolveList(
  listName: string | null,
  owner: string | null,
  lists: ListRef[],
): ListRef | null {
  if (listName) {
    const hit = lists.find((l) => norm(l.name) === norm(listName));
    if (hit) return hit;
  }
  if (!owner?.trim()) return null;
  const o = norm(owner);
  const oFirst = firstToken(owner);

  for (const { member, list } of teamWithLists(lists)) {
    const names = member.names.map(norm);
    if (names.includes(o) || names.includes(oFirst)) return list;
  }

  const targets = aliasTargetsFromLists(lists);
  const t =
    targets.find((t) => t.alias === o || t.alias === oFirst) ??
    targets.find((t) => commonPrefixLen(t.alias, oFirst) >= 3);
  return t ? { id: t.listId, name: t.listName } : null;
}

const str = (v: unknown): string | null => (typeof v === "string" ? v.trim() || null : null);

function validDate(v: unknown): string | null {
  if (typeof v !== "string" || !/^\d{4}-\d{2}-\d{2}$/.test(v)) return null;
  const d = new Date(`${v}T00:00:00Z`);
  return !Number.isNaN(d.getTime()) && d.toISOString().slice(0, 10) === v ? v : null;
}

/** Validate the model's items and attach each one's resolved list. */
export function normalizeItems(raw: unknown, lists: ListRef[]): MeetingItem[] {
  if (!Array.isArray(raw)) return [];
  return raw.flatMap((it: RawItem | null) => {
    if (!it || typeof it !== "object") return [];
    const title = str(it.title);
    if (!title) return [];
    const owner = str(it.owner);
    const list = resolveList(str(it.listName), owner, lists);
    return [
      {
        title,
        owner,
        notes: str(it.notes),
        dueDate: validDate(it.dueDate),
        listId: list?.id ?? null,
        listName: list?.name ?? null,
      },
    ];
  });
}

/** YYYY-MM-DD in Eddie's timezone, so an evening meeting keeps its own date. */
export function meetingDay(iso: string | null | undefined, timeZone = "America/New_York"): string | null {
  if (!iso) return null;
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return null;
  return new Intl.DateTimeFormat("en-CA", { timeZone, year: "numeric", month: "2-digit", day: "2-digit" }).format(d);
}
