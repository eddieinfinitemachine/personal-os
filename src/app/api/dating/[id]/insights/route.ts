import { NextResponse } from "next/server";
import type { Prisma } from "@prisma/client";
import { prisma } from "@/lib/prisma";
import { getCurrentUserId } from "@/lib/auth";
import { callClaudeJSON } from "@/lib/claude";
import { cleanList, threadStats } from "@/lib/dating";
import { toPersonDTO, type DatingInsights } from "@/lib/dating-server";

export const dynamic = "force-dynamic";
export const maxDuration = 120;

type Ctx = { params: Promise<{ id: string }> };

// Keep the prompt bounded: the newest messages that fit in this many chars.
const THREAD_BUDGET = 80_000;

const SYSTEM = `You help one person keep track of someone they are dating so they remember what matters, show up well, and learn from it.
Read the profile, their notes, the dated timeline and the text thread. Be specific and grounded in what is actually there; quote small details (names, places, plans, preferences) rather than generalizing. Be honest about imbalance or warning signs without being dramatic. Never invent facts.
Reply with ONLY a JSON object:
{
  "summary": "3-5 sentences: where things stand, the dynamic, momentum",
  "remember": ["concrete things to remember about her: family, friends, work, favorites, dislikes, upcoming plans or dates she mentioned"],
  "greenFlags": ["short"],
  "redFlags": ["short"],
  "lessons": "2-4 sentences on what this is teaching me about myself and what I want",
  "ideas": ["3-5 specific next date or message ideas drawn from things she said"]
}
Skip anything already in the existing notes lists. Empty arrays are fine.`;

export async function POST(request: Request, { params }: Ctx) {
  const userId = await getCurrentUserId(request);
  if (!userId) return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  const { id } = await params;
  const person = await prisma.datingPerson.findFirst({ where: { id, userId } });
  if (!person) return NextResponse.json({ error: "not found" }, { status: 404 });

  const [events, recent, meta] = await Promise.all([
    prisma.datingEvent.findMany({ where: { personId: id }, orderBy: { occurredAt: "asc" } }),
    prisma.datingMessage.findMany({
      where: { personId: id },
      orderBy: { sentAt: "desc" },
      take: 3000,
      select: { sentAt: true, fromMe: true, text: true },
    }),
    prisma.datingMessage.findMany({ where: { personId: id }, select: { sentAt: true, fromMe: true } }),
  ]);
  if (!events.length && !recent.length && !person.notes) {
    return NextResponse.json({ error: "add some notes, dates or messages first" }, { status: 400 });
  }

  const lines: string[] = [];
  let used = 0;
  for (const m of recent) {
    const line = `[${m.sentAt.toISOString().slice(0, 16).replace("T", " ")}] ${m.fromMe ? "Me" : person.name}: ${m.text}`;
    if (used + line.length > THREAD_BUDGET) break;
    used += line.length;
    lines.push(line);
  }
  lines.reverse();
  const stats = threadStats(meta);

  const user = [
    `Name: ${person.name}`,
    `Stage: ${person.stage}`,
    person.metVia && `Met via: ${person.metVia}`,
    person.metAt && `Met on: ${person.metAt.toISOString().slice(0, 10)}`,
    person.age && `Age: ${person.age}`,
    person.city && `City: ${person.city}`,
    person.work && `Work: ${person.work}`,
    person.remember.length && `Already remembered: ${person.remember.join("; ")}`,
    person.greenFlags.length && `Green flags noted: ${person.greenFlags.join("; ")}`,
    person.redFlags.length && `Red flags noted: ${person.redFlags.join("; ")}`,
    person.notes && `Notes:\n${person.notes}`,
    person.lessons && `Lessons so far:\n${person.lessons}`,
    events.length &&
      `Timeline:\n${events
        .map((e) => `- ${e.occurredAt.toISOString().slice(0, 10)} ${e.kind}: ${e.title}${e.vibe ? ` (vibe ${e.vibe}/10)` : ""}${e.notes ? ` | ${e.notes}` : ""}`)
        .join("\n")}`,
    stats.total &&
      `Thread stats: ${stats.total} messages, ${stats.mine} from me; I started ${Math.round((stats.iInitiate ?? 0) * 100)}% of ${stats.conversations} conversations; median reply: me ${fmtMin(stats.myReplyMin)}, her ${fmtMin(stats.theirReplyMin)}.`,
    lines.length && `Messages (${lines.length} most recent of ${stats.total}):\n${lines.join("\n")}`,
  ]
    .filter(Boolean)
    .join("\n\n");

  let raw: DatingInsights;
  try {
    raw = await callClaudeJSON<DatingInsights>({ system: SYSTEM, user, maxTokens: 3000 });
  } catch (e) {
    console.error("dating insights failed", e);
    return NextResponse.json({ error: "Claude could not read this one; try again" }, { status: 502 });
  }
  const insights: DatingInsights = {
    summary: typeof raw.summary === "string" ? raw.summary.trim() : undefined,
    remember: cleanList(raw.remember, 30),
    greenFlags: cleanList(raw.greenFlags, 15),
    redFlags: cleanList(raw.redFlags, 15),
    lessons: typeof raw.lessons === "string" ? raw.lessons.trim() : undefined,
    ideas: cleanList(raw.ideas, 8),
  };
  const updated = await prisma.datingPerson.update({
    where: { id },
    data: { insights: insights as Prisma.InputJsonValue, insightsAt: new Date() },
  });
  return NextResponse.json({ person: toPersonDTO(updated) });
}

function fmtMin(m: number | null): string {
  if (m === null) return "n/a";
  return m < 60 ? `${Math.round(m)}m` : `${(m / 60).toFixed(1)}h`;
}
