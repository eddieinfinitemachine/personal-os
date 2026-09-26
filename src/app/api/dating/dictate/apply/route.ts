import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { getCurrentUserId } from "@/lib/auth";
import { parseProposal } from "@/lib/dating";
import { applyProposedPerson, loadKnownPeople } from "@/lib/dating-filer";
import { toEventDTO, toPersonDTO } from "@/lib/dating-server";

export const dynamic = "force-dynamic";

// POST { proposal, day, personId? } → writes the reviewed proposal from
// /api/dating/dictate. The client sends only what stayed ticked; it is
// validated again here, and ids that aren't the user's are dropped.
export async function POST(request: Request) {
  const userId = await getCurrentUserId(request);
  if (!userId) return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  const body = (await request.json().catch(() => ({}))) as { proposal?: unknown; day?: unknown; personId?: unknown };
  const day = typeof body.day === "string" && /^\d{4}-\d{2}-\d{2}$/.test(body.day) ? body.day : null;
  if (!day) return NextResponse.json({ error: "day is required" }, { status: 400 });

  const people = await loadKnownPeople(userId);
  const personId = typeof body.personId === "string" && body.personId ? body.personId : null;
  if (personId && !people.some((p) => p.id === personId)) {
    return NextResponse.json({ error: "not found" }, { status: 404 });
  }
  const proposal = parseProposal(body.proposal, { people, noteDay: day, personId, strict: true });
  if (!proposal.people.length) return NextResponse.json({ error: "nothing to save" }, { status: 400 });

  const applied = [];
  for (const item of proposal.people) {
    const res = await applyProposedPerson(userId, item, { day, source: "dictation" });
    if (res) applied.push(res);
  }
  const [updated, events] = await Promise.all([
    prisma.datingPerson.findMany({ where: { userId, id: { in: applied.map((a) => a.personId) } } }),
    prisma.datingEvent.findMany({ where: { userId, id: { in: applied.flatMap((a) => a.eventIds) } } }),
  ]);
  return NextResponse.json({
    applied,
    people: updated.map(toPersonDTO),
    events: events.map(toEventDTO),
  });
}
