import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { getCurrentUserId } from "@/lib/auth";
import { organizePersonNotes } from "@/lib/dating-organize";
import { toEventDTO, toPersonDTO } from "@/lib/dating-server";

export const dynamic = "force-dynamic";
export const maxDuration = 300;

type Ctx = { params: Promise<{ id: string }> };

// "Organize notes with Claude" on a person page: file her notes field into
// dated events, flags and lessons (see organizePersonNotes). A second call is
// a no-op ("skipped").
// → { result, person, events }
export async function POST(request: Request, { params }: Ctx) {
  const userId = await getCurrentUserId(request);
  if (!userId) return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  const { id } = await params;
  // { today?: "YYYY-MM-DD" } — the client's local day for the marker note.
  const body = (await request.json().catch(() => ({}))) as { today?: unknown };
  const result = await organizePersonNotes(userId, id, { today: body.today });
  if (!result) return NextResponse.json({ error: "not found" }, { status: 404 });
  if (result.status === "error") return NextResponse.json({ error: result.summary, result }, { status: 502 });

  const [person, events] = await Promise.all([
    prisma.datingPerson.findFirst({ where: { id, userId } }),
    prisma.datingEvent.findMany({ where: { personId: id, userId }, orderBy: { occurredAt: "asc" } }),
  ]);
  if (!person) return NextResponse.json({ error: "not found" }, { status: 404 });
  return NextResponse.json({ result, person: toPersonDTO(person), events: events.map(toEventDTO) });
}
