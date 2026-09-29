import { NextResponse } from "next/server";
import { getFounderUser, isAuthorizedCron } from "@/lib/cron";
import { syncRecentTodos } from "@/lib/gcal";
import { granolaFromEnv, type GranolaNoteSummary } from "@/lib/granola";
import { autoImportFolders } from "@/lib/granola-auto-import";
import { commitItems, extractFromNote, importLists } from "@/lib/meeting-import";
import { prisma } from "@/lib/prisma";

export const dynamic = "force-dynamic";
export const maxDuration = 300;

// Every 30 minutes: Granola notes in the GTM / C2 / Leads folders (see
// AUTO_IMPORT_FOLDERS) become todos routed to each owner's EC/* list, with no
// review step, exactly as the Import Granola button would file them. A note
// is imported once: a GranolaImport row (written with the todos, in one
// transaction) marks it done, including notes that yield no items. A note
// that fails has no row, so it is retried every tick until it ages out of the
// window. Granola only lists notes once they have a summary and transcript,
// so "new" means "became available".
const WINDOW_DAYS = 3;
// Each note is one ~25 s Claude read; 4 keeps a tick well inside 300 s.
const MAX_PER_TICK = 4;

type Candidate = { note: GranolaNoteSummary; folder: string };

export async function GET(request: Request) {
  if (!isAuthorizedCron(request)) {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }
  const client = granolaFromEnv({ signal: request.signal });
  if (!client) {
    console.log("granola-todos cron: GRANOLA_API_KEY not set, nothing to do");
    return NextResponse.json({ skipped: "GRANOLA_API_KEY not set" });
  }
  const founder = await getFounderUser();
  if (!founder) {
    console.error("granola-todos cron: founder user not found (FOUNDER_EMAIL)");
    return NextResponse.json({ error: "founder user not found" }, { status: 404 });
  }

  const createdAfter = new Date(Date.now() - WINDOW_DAYS * 24 * 60 * 60 * 1000);
  let candidates: Candidate[];
  let folderNames: string[];
  try {
    if (!client.listFolders) throw new Error("Granola client cannot list folders");
    const { matched, excludedChildren } = autoImportFolders(await client.listFolders());
    folderNames = matched.map((f) => f.name);

    const byId = new Map<string, Candidate>();
    for (const folder of matched) {
      for (const note of await client.listNotes({ createdAfter, folderId: folder.id })) {
        if (!byId.has(note.id)) byId.set(note.id, { note, folder: folder.name });
      }
    }
    for (const child of excludedChildren) {
      for (const note of await client.listNotes({ createdAfter, folderId: child.id })) byId.delete(note.id);
    }
    candidates = [...byId.values()];
  } catch (e) {
    const error = e instanceof Error ? e.message : String(e);
    console.error("granola-todos cron: listing failed:", error);
    return NextResponse.json({ error }, { status: 502 });
  }

  const done = candidates.length
    ? await prisma.granolaImport.findMany({
        where: { userId: founder.id, noteId: { in: candidates.map((c) => c.note.id) } },
        select: { noteId: true },
      })
    : [];
  const doneIds = new Set(done.map((d) => d.noteId));
  const fresh = candidates
    .filter((c) => !doneIds.has(c.note.id))
    .sort((a, b) => Date.parse(a.note.created_at) - Date.parse(b.note.created_at));
  const batch = fresh.slice(0, MAX_PER_TICK);

  const imported: {
    noteId: string;
    title: string | null;
    folder: string;
    items: number;
    byList: { listName: string; count: number }[];
  }[] = [];
  const errors: { noteId: string; title: string | null; error: string }[] = [];

  if (batch.length) {
    const lists = await importLists(founder.id);
    for (const { note: summary, folder } of batch) {
      try {
        const note = await client.getNote(summary.id, { transcript: true });
        const ext = await extractFromNote({ userId: founder.id, note, lists });
        const result = await commitItems({
          userId: founder.id,
          items: ext.items,
          meetingTitle: ext.meetingTitle,
          meetingDate: ext.meetingDate,
          sourceUrl: ext.webUrl,
          noteId: summary.id,
          source: "auto",
          folder,
        });
        imported.push({
          noteId: summary.id,
          title: ext.meetingTitle,
          folder,
          items: result.created,
          byList: result.byList.map(({ listName, count }) => ({ listName, count })),
        });
      } catch (e) {
        const error = e instanceof Error ? e.message : String(e);
        console.error(`granola-todos cron: note ${summary.id} failed:`, error);
        errors.push({ noteId: summary.id, title: summary.title, error });
      }
    }
    if (imported.some((i) => i.items > 0)) await syncRecentTodos();
  }

  const body = {
    folders: folderNames,
    checked: candidates.length,
    imported,
    skipped: doneIds.size,
    deferred: fresh.length - batch.length,
    errors,
  };
  console.log("granola-todos cron", JSON.stringify(body));
  return NextResponse.json(body);
}
