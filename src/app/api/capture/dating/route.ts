import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { resolveCaptureUser } from "@/lib/capture-auth";
import { ingestMessages } from "@/lib/dating-server";

export const dynamic = "force-dynamic";
export const maxDuration = 60;

// Mac iMessage sync (scripts/dating-messages-sync.ts). Bearer CAPTURE_TOKEN.
//
// GET  → the handles to sync per person, plus the newest synced message
//        time so the script only reads what's new.
// POST { personId, messages: [{ guid, sentAt, fromMe, text }] } → insert,
//        deduped by guid.

export async function GET(request: Request) {
  const userId = await resolveCaptureUser(request);
  if (!userId) return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  const people = await prisma.datingPerson.findMany({
    where: { userId, handles: { isEmpty: false } },
    select: { id: true, name: true, handles: true },
  });
  const latest = await prisma.datingMessage.groupBy({
    by: ["personId"],
    where: { userId, source: "imessage" },
    _max: { sentAt: true },
  });
  const since = new Map(latest.map((l) => [l.personId, l._max.sentAt?.toISOString() ?? null]));
  return NextResponse.json({
    people: people.map((p) => ({ ...p, since: since.get(p.id) ?? null })),
  });
}

type Incoming = { guid?: unknown; sentAt?: unknown; fromMe?: unknown; text?: unknown };

export async function POST(request: Request) {
  const userId = await resolveCaptureUser(request);
  if (!userId) return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  const body = (await request.json().catch(() => ({}))) as { personId?: unknown; messages?: unknown };
  if (typeof body.personId !== "string" || !Array.isArray(body.messages)) {
    return NextResponse.json({ error: "personId and messages[] required" }, { status: 400 });
  }
  if (body.messages.length > 5000) return NextResponse.json({ error: "max 5000 per batch" }, { status: 413 });
  const person = await prisma.datingPerson.findFirst({
    where: { id: body.personId, userId },
    select: { id: true },
  });
  if (!person) return NextResponse.json({ error: "not found" }, { status: 404 });

  const msgs = (body.messages as Incoming[]).flatMap((m) => {
    const sentAt = typeof m.sentAt === "string" ? new Date(m.sentAt) : null;
    if (typeof m.guid !== "string" || !m.guid || typeof m.text !== "string" || !m.text.trim()) return [];
    if (!sentAt || Number.isNaN(sentAt.getTime())) return [];
    return [{ externalId: m.guid, sentAt, fromMe: m.fromMe === true, text: m.text.trim(), source: "imessage" as const }];
  });
  const added = await ingestMessages(userId, person.id, msgs);
  return NextResponse.json({ received: body.messages.length, added });
}
