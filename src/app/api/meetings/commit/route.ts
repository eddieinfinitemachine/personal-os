import { NextResponse } from "next/server";
import { getCurrentUserId } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { listAccessWhere } from "@/lib/list-access";
import { ensureDefaultLists, ensureInboxProject, CAPTURE_LIST_NAME } from "@/lib/lists";

export const dynamic = "force-dynamic";

// Commit step of meeting import: creates the reviewed todos. Only ever called
// after the user has edited and confirmed the rows on /capture/meeting —
// nothing in this feature writes todos without that explicit click.

type CommitItem = {
  title?: string;
  notes?: string | null;
  dueDate?: string | null; // YYYY-MM-DD
  listId?: string | null;
};

export async function POST(request: Request) {
  const userId = await getCurrentUserId(request);
  if (!userId) return NextResponse.json({ error: "unauthorized" }, { status: 401 });

  const body = (await request.json().catch(() => ({}))) as {
    meetingTitle?: string | null;
    meetingDate?: string | null;
    items?: CommitItem[];
  };

  const items = (Array.isArray(body.items) ? body.items : [])
    .map((it) => ({ ...it, title: typeof it.title === "string" ? it.title.trim() : "" }))
    .filter((it) => it.title.length > 0);
  if (items.length === 0) {
    return NextResponse.json({ error: "no items to add" }, { status: 400 });
  }
  if (items.length > 100) {
    return NextResponse.json({ error: "too many items (max 100)" }, { status: 400 });
  }

  await ensureDefaultLists(userId);
  const lists = await prisma.list.findMany({
    where: listAccessWhere(userId),
    select: { id: true, name: true, isDefault: true, userId: true },
  });
  const listById = new Map(lists.map((l) => [l.id, l]));
  const toDo = lists.find(
    (l) => l.userId === userId && l.isDefault && l.name === CAPTURE_LIST_NAME
  );
  if (!toDo) {
    return NextResponse.json({ error: "default To Do list missing" }, { status: 500 });
  }
  const inboxProjectId = await ensureInboxProject(userId);

  const meetingTitle =
    typeof body.meetingTitle === "string" ? body.meetingTitle.trim() || null : null;
  const meetingDate =
    typeof body.meetingDate === "string" ? body.meetingDate.trim() || null : null;
  const sourceLine = meetingTitle
    ? `From meeting: ${meetingTitle}${meetingDate ? ` (${meetingDate})` : ""}`
    : null;

  const rows = items.map((it) => {
    // Unknown/missing list falls back to To Do; anything landing on To Do is
    // filed under the Inbox project so it shows up for triage (same convention
    // as Smart Capture).
    const list = (it.listId && listById.get(it.listId)) || toDo;
    const notes = typeof it.notes === "string" ? it.notes.trim() : "";
    const dueDate =
      typeof it.dueDate === "string" && /^\d{4}-\d{2}-\d{2}$/.test(it.dueDate)
        ? new Date(it.dueDate)
        : null;
    return {
      userId,
      title: it.title,
      notes: [notes, sourceLine].filter(Boolean).join("\n") || null,
      dueDate,
      listId: list.id,
      projectId: list.id === toDo.id ? inboxProjectId : null,
    };
  });

  await prisma.todo.createMany({ data: rows });

  const counts = new Map<string, number>();
  for (const r of rows) counts.set(r.listId, (counts.get(r.listId) ?? 0) + 1);
  const byList = [...counts.entries()].map(([listId, count]) => ({
    listId,
    listName: listById.get(listId)?.name ?? "?",
    count,
  }));

  return NextResponse.json({ created: rows.length, byList });
}
