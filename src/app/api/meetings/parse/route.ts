import { NextResponse } from "next/server";
import { getCurrentUserId } from "@/lib/auth";
import { callClaudeJSON } from "@/lib/claude";
import { prisma } from "@/lib/prisma";
import { listAccessWhere } from "@/lib/list-access";
import { aliasTargetsFromLists } from "@/lib/alias";

export const dynamic = "force-dynamic";
// Transcripts are long and the model call is a single big read — give the
// route the same headroom as /api/capture/smart/auto.
export const maxDuration = 60;

// One extracted action item, with the destination list resolved server-side.
// listId is null when no team list matched — the client defaults those to
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
type RawItem = {
  title?: string;
  owner?: string | null;
  notes?: string | null;
  dueDate?: string | null;
  listName?: string | null;
};

function buildSystem(teamLists: { alias: string; listName: string }[], today: string): string {
  const listBlock = teamLists.length
    ? teamLists.map((t) => `- "${t.listName}" — ${t.alias}`).join("\n")
    : "- (none — leave listName null for every item)";
  return `You extract action items from a meeting transcript for a personal task manager.

The user pastes a raw transcript (often from Granola), sometimes with a header (Meeting Title / Date / Meeting participants). Meetings ramble — pull out ONLY the concrete next steps: things a specific person committed to do, or the group explicitly agreed someone should do.

Output ONLY a single JSON object, no prose. Schema:
{
  "meetingTitle": string | null,   // from the header if present, else null
  "meetingDate": string | null,    // as written in the header (e.g. "Aug 17"), else null
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
${listBlock}

Rules:
- Only real commitments. Skip ideas merely floated, open questions, and decisions that need no follow-up work.
- Titles stay close to the words used in the meeting; never invent or embellish work that wasn't agreed.
- One item per distinct commitment; collapse restatements of the same commitment into one.
- owner is whoever will DO the work (addressed by name or volunteering), not whoever raised the topic. Names are often transcribed sloppily ("Obi"/"Obie") — normalize to the team-list spelling when it's clearly the same person.
- If the owner doesn't map to a team list, leave listName null.
- Today is ${today}. Resolve relative deadlines ("by end of day", "after Labor Day") against the meeting date if given, else today.
- If nothing actionable, return { "meetingTitle": ..., "meetingDate": ..., "items": [] }.`;
}

/** Longest shared prefix, so "David" still matches the alias "dave". */
function commonPrefixLen(a: string, b: string): number {
  let i = 0;
  while (i < a.length && i < b.length && a[i] === b[i]) i++;
  return i;
}

export async function POST(request: Request) {
  const userId = await getCurrentUserId(request);
  if (!userId) return NextResponse.json({ error: "unauthorized" }, { status: 401 });

  const body = (await request.json().catch(() => ({}))) as { text?: string };
  const text = body.text?.trim();
  if (!text) return NextResponse.json({ error: "text required" }, { status: 400 });
  if (text.length > 200000) {
    return NextResponse.json({ error: "transcript too long (max 200k chars)" }, { status: 400 });
  }
  if (!process.env.ANTHROPIC_API_KEY) {
    return NextResponse.json({ error: "ANTHROPIC_API_KEY not set" }, { status: 500 });
  }

  const lists = await prisma.list.findMany({
    where: listAccessWhere(userId),
    select: { id: true, name: true },
    orderBy: [{ position: "asc" }, { createdAt: "asc" }],
  });
  const listByName = new Map(lists.map((l) => [l.name.trim().toLowerCase(), l]));
  const targets = aliasTargetsFromLists(lists);

  const today = new Date().toISOString().slice(0, 10);
  let parsed: { meetingTitle?: string | null; meetingDate?: string | null; items?: RawItem[] };
  try {
    parsed = await callClaudeJSON({
      system: buildSystem(targets, today),
      user: text,
      // Items are short (~60 tokens each); 4000 covers a very busy meeting.
      maxTokens: 4000,
    });
  } catch {
    return NextResponse.json({ error: "could not parse model output" }, { status: 502 });
  }

  // Resolve each item's list: trust the model's listName only if it names a
  // real accessible list; otherwise fall back to matching the owner against
  // the EC/* alias table (shared prefix ≥ 3 so "David" → EC/Dave); else null.
  const resolveList = (listName: string | null, owner: string | null) => {
    if (listName) {
      const hit = listByName.get(listName.trim().toLowerCase());
      if (hit) return hit;
    }
    if (owner) {
      const o = owner.trim().toLowerCase();
      const t = targets.find(
        (t) => t.alias === o || commonPrefixLen(t.alias, o) >= 3
      );
      if (t) return { id: t.listId, name: t.listName };
    }
    return null;
  };

  const items: MeetingItem[] = Array.isArray(parsed.items)
    ? parsed.items
        .filter(
          (it): it is RawItem & { title: string } =>
            !!it && typeof it.title === "string" && it.title.trim().length > 0
        )
        .map((it) => {
          const owner = typeof it.owner === "string" ? it.owner.trim() || null : null;
          const list = resolveList(typeof it.listName === "string" ? it.listName : null, owner);
          return {
            title: it.title.trim(),
            owner,
            notes: typeof it.notes === "string" ? it.notes.trim() || null : null,
            dueDate:
              typeof it.dueDate === "string" && /^\d{4}-\d{2}-\d{2}$/.test(it.dueDate)
                ? it.dueDate
                : null,
            listId: list?.id ?? null,
            listName: list?.name ?? null,
          };
        })
    : [];

  return NextResponse.json({
    meetingTitle: typeof parsed.meetingTitle === "string" ? parsed.meetingTitle.trim() || null : null,
    meetingDate: typeof parsed.meetingDate === "string" ? parsed.meetingDate.trim() || null : null,
    items,
  });
}
