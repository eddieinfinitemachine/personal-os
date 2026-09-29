import { NextResponse, after } from "next/server";
import { getCurrentUserId } from "@/lib/auth";
import { syncRecentTodos } from "@/lib/gcal";
import { commitItems, type CommitItem } from "@/lib/meeting-import";

export const dynamic = "force-dynamic";

// Commit step of the Import Granola button: creates the reviewed todos. Only
// ever called after the user has edited and confirmed the rows in the Home
// review. (The GTM / C2 / Leads cron commits without review, via the same
// commitItems in src/lib/meeting-import.ts.)

export async function POST(request: Request) {
  const userId = await getCurrentUserId(request);
  if (!userId) return NextResponse.json({ error: "unauthorized" }, { status: 401 });

  const body = (await request.json().catch(() => ({}))) as {
    noteId?: unknown;
    meetingTitle?: unknown;
    meetingDate?: unknown;
    sourceUrl?: unknown;
    items?: Partial<CommitItem>[];
  };

  const items = (Array.isArray(body.items) ? body.items : [])
    .map((it) => ({ ...it, title: typeof it?.title === "string" ? it.title.trim() : "" }))
    .filter((it) => it.title.length > 0);
  if (items.length === 0) {
    return NextResponse.json({ error: "no items to add" }, { status: 400 });
  }
  if (items.length > 100) {
    return NextResponse.json({ error: "too many items (max 100)" }, { status: 400 });
  }

  const text = (v: unknown) => (typeof v === "string" ? v.trim() || null : null);
  // Granola note ids are short slugs (not_XXXXXXXXXXXXXX); anything else is ignored.
  const noteId = text(body.noteId);

  try {
    const result = await commitItems({
      userId,
      items,
      meetingTitle: text(body.meetingTitle),
      meetingDate: text(body.meetingDate),
      sourceUrl: text(body.sourceUrl),
      noteId: noteId && /^[\w-]{1,120}$/.test(noteId) ? noteId : null,
      source: "manual",
    });
    after(() => syncRecentTodos());
    return NextResponse.json(result);
  } catch (e) {
    const error = e instanceof Error ? e.message : String(e);
    return NextResponse.json({ error }, { status: 500 });
  }
}
