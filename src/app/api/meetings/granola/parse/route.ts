import { NextResponse } from "next/server";
import { GranolaError, granolaFromEnv } from "@/lib/granola";
import { CAPTURE_LIST_NAME } from "@/lib/lists";
import { extractFromNote, importLists } from "@/lib/meeting-import";
import { granolaImportGate } from "../gate";

export const dynamic = "force-dynamic";
// The note fetch plus one big model read — same headroom as the old importer.
export const maxDuration = 60;

// POST { noteId } → Claude proposes action items, each routed to a list.
// No writes: the review screen commits via /api/meetings/commit.
// → { noteId, meetingTitle, meetingDate, webUrl, items, lists }

export async function POST(request: Request) {
  const gate = await granolaImportGate(request);
  if ("response" in gate) return gate.response;
  const { userId } = gate;

  const body = (await request.json().catch(() => ({}))) as { noteId?: unknown };
  const noteId = typeof body.noteId === "string" ? body.noteId.trim() : "";
  if (!noteId || noteId.length > 120) {
    return NextResponse.json({ error: "noteId required" }, { status: 400 });
  }
  if (!process.env.ANTHROPIC_API_KEY) {
    return NextResponse.json({ error: "ANTHROPIC_API_KEY not set" }, { status: 500 });
  }

  const client = granolaFromEnv({ signal: request.signal });
  if (!client) return NextResponse.json({ error: "GRANOLA_API_KEY not set" }, { status: 503 });

  let note;
  try {
    note = await client.getNote(noteId, { transcript: true });
  } catch (e) {
    if (e instanceof GranolaError) return NextResponse.json({ error: e.message }, { status: 502 });
    throw e;
  }

  const lists = await importLists(userId);

  let extraction;
  try {
    extraction = await extractFromNote({ userId, note, lists });
  } catch {
    return NextResponse.json({ error: "could not extract action items" }, { status: 502 });
  }

  return NextResponse.json({
    noteId,
    ...extraction,
    // Destinations for the review's list picker. The user's own To Do is the
    // picker's "To Do (inbox)" option (listId null), so it isn't listed twice.
    lists: lists
      .filter((l) => !(l.userId === userId && l.isDefault && l.name === CAPTURE_LIST_NAME))
      .map((l) => ({ id: l.id, name: l.name })),
  });
}
