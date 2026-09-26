import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { getCurrentUserId } from "@/lib/auth";
import { callClaudeText } from "@/lib/claude";

export const dynamic = "force-dynamic";
export const maxDuration = 120;

const SYSTEM = `You help one person learn from their dating life. Given notes on everyone they have dated, find the patterns across people: what they are drawn to, what reliably goes well or badly, recurring flags they overlooked, how they show up, and what they seem to actually want. Be direct, warm and specific; cite people by name as evidence. Plain text, short sections with a heading line each, bullets with "- ". No preamble, no em dashes.`;

// POST → a cross-person read of lessons, flags and outcomes. Not stored.
export async function POST(request: Request) {
  const userId = await getCurrentUserId(request);
  if (!userId) return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  const people = await prisma.datingPerson.findMany({
    where: { userId },
    orderBy: { createdAt: "asc" },
    include: { events: { orderBy: { occurredAt: "asc" } } },
  });
  const withSignal = people.filter((p) => p.lessons || p.notes || p.greenFlags.length || p.redFlags.length || p.events.length);
  if (withSignal.length < 2) {
    return NextResponse.json({ error: "write lessons or notes on at least two people first" }, { status: 400 });
  }
  const user = withSignal
    .map((p) =>
      [
        `## ${p.name} (${p.stage}${p.metVia ? `, met via ${p.metVia}` : ""}${p.metAt ? `, ${p.metAt.toISOString().slice(0, 7)}` : ""}${p.endedAt ? ` to ${p.endedAt.toISOString().slice(0, 7)}` : ""})`,
        p.greenFlags.length && `Green: ${p.greenFlags.join("; ")}`,
        p.redFlags.length && `Red: ${p.redFlags.join("; ")}`,
        p.events.length &&
          `Timeline: ${p.events.map((e) => `${e.kind} "${e.title}"${e.vibe ? ` ${e.vibe}/10` : ""}`).join(", ")}`,
        p.notes && `Notes: ${p.notes.slice(0, 3000)}`,
        p.lessons && `Lessons: ${p.lessons.slice(0, 3000)}`,
      ]
        .filter(Boolean)
        .join("\n"),
    )
    .join("\n\n");
  try {
    const text = await callClaudeText({ system: SYSTEM, user, maxTokens: 2500 });
    return NextResponse.json({ text });
  } catch (e) {
    console.error("dating patterns failed", e);
    return NextResponse.json({ error: "Claude could not read this; try again" }, { status: 502 });
  }
}
