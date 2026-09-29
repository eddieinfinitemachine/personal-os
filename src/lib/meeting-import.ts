// Granola meeting → todos, shared by the Import Granola button (parse + commit
// routes, with a review step in between) and the GTM / C2 / Leads auto-import
// cron (no review). The pure prompt / routing helpers live in meeting-extract.
import { callClaudeJSON } from "@/lib/claude";
import { granolaNoteText, type GranolaNote } from "@/lib/granola";
import { listAccessWhere } from "@/lib/list-access";
import { CAPTURE_LIST_NAME, ensureDefaultLists, ensureInboxProject } from "@/lib/lists";
import { buildSystem, meetingDay, normalizeItems, type MeetingItem } from "@/lib/meeting-extract";
import { prisma } from "@/lib/prisma";

export type ImportList = { id: string; name: string; isDefault: boolean; userId: string };

/** Every list the user can file into (own + shared), in board order. */
export function importLists(userId: string): Promise<ImportList[]> {
  return prisma.list.findMany({
    where: listAccessWhere(userId),
    select: { id: true, name: true, isDefault: true, userId: true },
    orderBy: [{ position: "asc" }, { createdAt: "asc" }],
  });
}

export type Extraction = {
  meetingTitle: string | null;
  meetingDate: string | null; // YYYY-MM-DD
  webUrl: string | null;
  items: MeetingItem[];
};

/**
 * One Claude read of the note (my notes + summary + transcript) → routed
 * action items. No writes. Throws when the model call fails.
 */
export async function extractFromNote({
  note,
  lists,
}: {
  userId: string;
  note: GranolaNote;
  lists: { id: string; name: string }[];
}): Promise<Extraction> {
  const meetingTitle = note.title?.trim() || note.calendar_event?.event_title?.trim() || null;
  const meetingDate = meetingDay(note.calendar_event?.scheduled_start_time ?? note.created_at);
  const header = [
    meetingTitle ? `Meeting: ${meetingTitle}` : null,
    meetingDate ? `Date: ${meetingDate}` : null,
    note.attendees?.length
      ? `Attendees: ${note.attendees.map((a) => a.name || a.email).join(", ")}`
      : null,
  ]
    .filter(Boolean)
    .join("\n");

  const parsed = await callClaudeJSON<{ items?: unknown }>({
    system: buildSystem(lists, new Date().toISOString().slice(0, 10)),
    user: `${header}\n\n${granolaNoteText(note, 200_000)}`,
    // Items are short (~60 tokens each); 4000 covers a very busy meeting.
    maxTokens: 4000,
  });

  return {
    meetingTitle,
    meetingDate,
    webUrl: note.web_url ?? null,
    items: normalizeItems(parsed?.items, lists),
  };
}

export type CommitItem = {
  title: string;
  notes?: string | null;
  dueDate?: string | null; // YYYY-MM-DD
  listId?: string | null;
};

export type CommitResult = {
  created: number;
  byList: { listId: string; listName: string; count: number }[];
};

/** "From meeting: {title} ({date})\n{url}", or null when there's nothing to say. */
export function provenanceLine(
  meetingTitle: string | null,
  meetingDate: string | null,
  sourceUrl: string | null,
): string | null {
  // Only http(s) links, so a note can't carry a javascript: URL.
  const url = sourceUrl && /^https?:\/\/\S+$/.test(sourceUrl.trim()) ? sourceUrl.trim() : null;
  return (
    [meetingTitle ? `From meeting: ${meetingTitle}${meetingDate ? ` (${meetingDate})` : ""}` : null, url]
      .filter(Boolean)
      .join("\n") || null
  );
}

/**
 * Create the todos. Unknown or missing lists fall back to the user's To Do,
 * and anything on To Do is filed under the Inbox project for triage (same
 * convention as Smart Capture). With a noteId, every todo gets an
 * autopilotKey under `granola:{noteId}:` and a GranolaImport row is written in
 * the same transaction, so the note shows as imported and the cron never
 * picks it up again. The auto path's keys are `granola:{noteId}:{index}`,
 * which makes a double insert impossible; a manual import adds a per-commit
 * segment so a deliberate re-import from the picker is never silently dropped.
 * Calendar sync is left to the caller (after() in a route, awaited in a cron).
 */
export async function commitItems({
  userId,
  items: rawItems,
  meetingTitle,
  meetingDate,
  sourceUrl,
  noteId,
  source,
  folder = null,
}: {
  userId: string;
  items: CommitItem[];
  meetingTitle: string | null;
  meetingDate: string | null;
  sourceUrl: string | null;
  noteId?: string | null;
  source: "auto" | "manual";
  folder?: string | null;
}): Promise<CommitResult> {
  const items = rawItems
    .map((it) => ({ ...it, title: typeof it.title === "string" ? it.title.trim() : "" }))
    .filter((it) => it.title.length > 0);

  await ensureDefaultLists(userId);
  const lists = await prisma.list.findMany({
    where: listAccessWhere(userId),
    select: { id: true, name: true, isDefault: true, userId: true },
  });
  const listById = new Map(lists.map((l) => [l.id, l]));
  const toDo = lists.find((l) => l.userId === userId && l.isDefault && l.name === CAPTURE_LIST_NAME);
  if (!toDo) throw new Error("default To Do list missing");
  const inboxProjectId = items.length ? await ensureInboxProject(userId) : null;

  const sourceLine = provenanceLine(meetingTitle, meetingDate, sourceUrl);
  const keyPrefix = noteId
    ? `granola:${noteId}:${source === "manual" ? `m${Date.now().toString(36)}:` : ""}`
    : null;

  const rows = items.map((it, i) => {
    const list = (it.listId && listById.get(it.listId)) || toDo;
    const notes = typeof it.notes === "string" ? it.notes.trim() : "";
    const dueDate =
      typeof it.dueDate === "string" && /^\d{4}-\d{2}-\d{2}$/.test(it.dueDate) ? new Date(it.dueDate) : null;
    return {
      userId,
      title: it.title,
      notes: [notes, sourceLine].filter(Boolean).join("\n") || null,
      dueDate,
      listId: list.id,
      projectId: list.id === toDo.id ? inboxProjectId : null,
      autopilotKey: keyPrefix ? `${keyPrefix}${i}` : null,
    };
  });

  const writes = [];
  if (rows.length) writes.push(prisma.todo.createMany({ data: rows, skipDuplicates: true }));
  if (noteId) {
    writes.push(
      prisma.granolaImport.upsert({
        where: { userId_noteId: { userId, noteId } },
        create: { userId, noteId, title: meetingTitle, folder, source, itemCount: rows.length },
        // A re-import from the picker adds to the count; the first import's
        // source and folder stay as the record of how the note arrived.
        update: { itemCount: { increment: rows.length } },
      }),
    );
  }
  const results = writes.length ? await prisma.$transaction(writes) : [];
  const created = rows.length ? (results[0] as { count: number }).count : 0;

  const counts = new Map<string, number>();
  for (const r of rows) counts.set(r.listId, (counts.get(r.listId) ?? 0) + 1);
  const byList = [...counts.entries()].map(([listId, count]) => ({
    listId,
    listName: listById.get(listId)?.name ?? "?",
    count,
  }));

  return { created, byList };
}
