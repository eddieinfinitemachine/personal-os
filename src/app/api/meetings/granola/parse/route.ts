import { NextResponse } from "next/server";
import { callClaudeJSON } from "@/lib/claude";
import { GranolaError, granolaFromEnv, granolaNoteText } from "@/lib/granola";
import { listAccessWhere } from "@/lib/list-access";
import { CAPTURE_LIST_NAME } from "@/lib/lists";
import { buildSystem, meetingDay, normalizeItems } from "@/lib/meeting-extract";
import { prisma } from "@/lib/prisma";
import { granolaImportGate } from "../gate";

export const dynamic = "force-dynamic";
// The note fetch plus one big model read — same headroom as the old importer.
export const maxDuration = 60;

// POST { noteId } → Claude proposes action items, each routed to a list.
// No writes: the review screen commits via /api/meetings/commit.
// → { meetingTitle, meetingDate, webUrl, items, lists }

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

  const lists = await prisma.list.findMany({
    where: listAccessWhere(userId),
    select: { id: true, name: true, isDefault: true, userId: true },
    orderBy: [{ position: "asc" }, { createdAt: "asc" }],
  });

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

  let parsed: { items?: unknown };
  try {
    parsed = await callClaudeJSON({
      system: buildSystem(lists, new Date().toISOString().slice(0, 10)),
      user: `${header}\n\n${granolaNoteText(note, 200_000)}`,
      // Items are short (~60 tokens each); 4000 covers a very busy meeting.
      maxTokens: 4000,
    });
  } catch {
    return NextResponse.json({ error: "could not extract action items" }, { status: 502 });
  }

  return NextResponse.json({
    meetingTitle,
    meetingDate,
    webUrl: note.web_url ?? null,
    items: normalizeItems(parsed?.items, lists),
    // Destinations for the review's list picker. The user's own To Do is the
    // picker's "To Do (inbox)" option (listId null), so it isn't listed twice.
    lists: lists
      .filter((l) => !(l.userId === userId && l.isDefault && l.name === CAPTURE_LIST_NAME))
      .map((l) => ({ id: l.id, name: l.name })),
  });
}
