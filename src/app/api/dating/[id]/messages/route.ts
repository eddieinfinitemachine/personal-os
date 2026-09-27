import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { getCurrentUserId } from "@/lib/auth";
import { parseTranscript, pasteExternalIds } from "@/lib/dating";
import { ingestMessages, toMessageDTO } from "@/lib/dating-server";

export const dynamic = "force-dynamic";

type Ctx = { params: Promise<{ id: string }> };

const PAGE = 200;

// GET ?before=<iso>&beforeId=<id>&q=<search> → newest-first page, returned oldest-first.
export async function GET(request: Request, { params }: Ctx) {
  const userId = await getCurrentUserId(request);
  if (!userId) return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  const { id } = await params;
  const url = new URL(request.url);
  const before = url.searchParams.get("before");
  const beforeId = url.searchParams.get("beforeId");
  const beforeDate = before ? new Date(before) : null;
  if ((before !== null || beforeId !== null) &&
      (!beforeDate || Number.isNaN(beforeDate.getTime()) || !beforeId?.trim() || beforeId.length > 200)) {
    return NextResponse.json({ error: "invalid message cursor" }, { status: 400 });
  }
  const person = await prisma.datingPerson.findFirst({ where: { id, userId }, select: { id: true } });
  if (!person) return NextResponse.json({ error: "not found" }, { status: 404 });
  const q = url.searchParams.get("q")?.trim();
  const rows = await prisma.datingMessage.findMany({
    where: {
      userId,
      personId: id,
      ...(beforeDate && beforeId ? { OR: [
        { sentAt: { lt: beforeDate } },
        { sentAt: beforeDate, id: { lt: beforeId } },
      ] } : {}),
      ...(q ? { text: { contains: q, mode: "insensitive" as const } } : {}),
    },
    orderBy: [{ sentAt: "desc" }, { id: "desc" }],
    take: PAGE + 1,
    select: { id: true, fromMe: true, text: true, source: true, sentAt: true },
  });
  return NextResponse.json({ messages: rows.slice(0, PAGE).reverse().map(toMessageDTO), more: rows.length > PAGE });
}

// POST { text, myName? } → parse a pasted chat and import it.
export async function POST(request: Request, { params }: Ctx) {
  const userId = await getCurrentUserId(request);
  if (!userId) return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  const { id } = await params;
  const person = await prisma.datingPerson.findFirst({ where: { id, userId }, select: { id: true, name: true } });
  if (!person) return NextResponse.json({ error: "not found" }, { status: 404 });
  const body = (await request.json().catch(() => ({}))) as { text?: unknown; myName?: unknown };
  if (!body || typeof body.text !== "string" || !body.text.trim()) {
    return NextResponse.json({ error: "paste some messages" }, { status: 400 });
  }
  if (body.text.length > 2_000_000) return NextResponse.json({ error: "too long" }, { status: 413 });
  const parsed = parseTranscript(body.text, {
    myName: typeof body.myName === "string" ? body.myName : undefined,
    theirName: person.name,
  });
  if (!parsed.length) {
    return NextResponse.json({ error: "no messages found; use one \"Name: message\" per line" }, { status: 400 });
  }
  const externalIds = await pasteExternalIds(parsed, id);
  const msgs = parsed.map((m, i) => ({
    externalId: externalIds[i],
    sentAt: m.sentAt,
    fromMe: m.fromMe,
    text: m.text,
    source: "paste" as const,
  }));
  const added = await ingestMessages(userId, id, msgs);
  const senders = [...new Set(parsed.map((m) => `${m.sender}${m.fromMe ? " (you)" : ""}`))];
  return NextResponse.json({ parsed: parsed.length, added, senders });
}
