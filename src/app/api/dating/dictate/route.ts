import { NextResponse } from "next/server";
import { getCurrentUserId } from "@/lib/auth";
import { fileDatingNote, loadKnownPeople, NOTE_BUDGET } from "@/lib/dating-filer";

export const dynamic = "force-dynamic";
export const maxDuration = 120;

// POST { text, personId?, day? } → { proposal, day }. Claude reads a dictated
// note and proposes what to file on whom. Nothing is written; the reviewed
// proposal goes to /api/dating/dictate/apply.
export async function POST(request: Request) {
  const userId = await getCurrentUserId(request);
  if (!userId) return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  const body = (await request.json().catch(() => ({}))) as { text?: unknown; personId?: unknown; day?: unknown };
  const text = typeof body.text === "string" ? body.text.trim() : "";
  if (!text) return NextResponse.json({ error: "say or type something first" }, { status: 400 });
  if (text.length > NOTE_BUDGET) return NextResponse.json({ error: "that note is too long" }, { status: 413 });

  const people = await loadKnownPeople(userId);
  const personId = typeof body.personId === "string" && body.personId ? body.personId : null;
  if (personId && !people.some((p) => p.id === personId)) {
    return NextResponse.json({ error: "not found" }, { status: 404 });
  }
  // The client's local day, so a note dictated late in the evening isn't
  // dated tomorrow (UTC).
  const day = typeof body.day === "string" && /^\d{4}-\d{2}-\d{2}$/.test(body.day) ? body.day : undefined;

  try {
    const res = await fileDatingNote({ userId, text, occurredAt: day, personId, source: "dictation", people });
    return NextResponse.json(res);
  } catch (e) {
    console.error("dating dictate failed", e);
    return NextResponse.json({ error: "Claude could not file this one; try again" }, { status: 502 });
  }
}
