import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { resolveCaptureUser } from "@/lib/capture-auth";
import { ingestMessages } from "@/lib/dating-server";
import { captureSource } from "@/lib/dating-message-sync";

export const dynamic = "force-dynamic";
export const maxDuration = 60;

// Mac iMessage + WhatsApp sync (scripts/dating-messages-sync.ts). Bearer CAPTURE_TOKEN.
//
// GET  → the handles to sync per person, plus the newest synced message
//        time per source (since = iMessage, whatsappSince = WhatsApp) so the
//        script only reads what's new.
// POST { personId, source?, messages: [{ guid, sentAt, fromMe, text, source? }] }
//        → insert, deduped by guid. source is "imessage" (default) or
//        "whatsapp", per batch and/or per message (the message wins).

export async function GET(request: Request) {
  const userId = await resolveCaptureUser(request);
  if (!userId) return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  const people = await prisma.datingPerson.findMany({
    where: { userId, handles: { isEmpty: false } },
    select: { id: true, name: true, handles: true },
  });
  const latest = await prisma.datingMessage.groupBy({
    by: ["personId", "source"],
    where: { userId, source: { in: ["imessage", "whatsapp"] } },
    _max: { sentAt: true },
  });
  const since = new Map(latest.map((l) => [`${l.personId}:${l.source}`, l._max.sentAt?.toISOString() ?? null]));
  return NextResponse.json({
    people: people.map((p) => ({
      ...p,
      since: since.get(`${p.id}:imessage`) ?? null,
      whatsappSince: since.get(`${p.id}:whatsapp`) ?? null,
    })),
  });
}

type Incoming = { guid?: unknown; sentAt?: unknown; fromMe?: unknown; text?: unknown; source?: unknown };

export async function POST(request: Request) {
  const userId = await resolveCaptureUser(request);
  if (!userId) return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  const body = (await request.json().catch(() => ({}))) as { personId?: unknown; messages?: unknown; source?: unknown };
  if (typeof body.personId !== "string" || !Array.isArray(body.messages)) {
    return NextResponse.json({ error: "personId and messages[] required" }, { status: 400 });
  }
  const batchSource = captureSource(body.source, "imessage");
  if (!batchSource) return NextResponse.json({ error: "source must be imessage or whatsapp" }, { status: 400 });
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
    const source = captureSource(m.source, batchSource);
    if (!source) return [];
    return [{ externalId: m.guid, sentAt, fromMe: m.fromMe === true, text: m.text.trim(), source }];
  });
  const added = await ingestMessages(userId, person.id, msgs);
  return NextResponse.json({ received: body.messages.length, added });
}
