import type { Prisma } from "@prisma/client";
import { prisma } from "@/lib/prisma";
import { callClaudeJSON } from "@/lib/claude";
import { cleanList, threadStats } from "@/lib/dating";
import type { DatingInsights, InsightSources } from "@/lib/dating-server";
export type { InsightSources } from "@/lib/dating-server";

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

/** Refresh derived insights only; never writes notes, remembered facts or other manual fields. */
export async function refreshDatingInsights(userId: string, id: string, options: { onlyIfStale?: boolean } = {}) {
  const person = await prisma.datingPerson.findFirst({ where: { id, userId } });
  if (!person) return { ok: false as const, status: 404, error: "not found" };
  // Record the start, not the finish: imports arriving during generation must
  // still cause a refresh on the next sync. createdAt catches historic backfills.
  const startedAt = new Date();
  const latest = await prisma.datingMessage.aggregate({ where: { personId: id, userId }, _max: { createdAt: true } });
  const newestImport = latest._max.createdAt;
  if (options.onlyIfStale) {
    if (!newestImport) return { ok: true as const, refreshed: false, reason: "no_messages", person };
    const existing = person.insights as DatingInsights | null;
    if (typeof existing?.summary === "string" && existing.summary.trim() && person.insightsAt && newestImport <= person.insightsAt) {
      return { ok: true as const, refreshed: false, reason: "fresh", person };
    }
  }

  const [events, recent, meta] = await Promise.all([
    prisma.datingEvent.findMany({ where: { personId: id, userId }, orderBy: { occurredAt: "asc" } }),
    prisma.datingMessage.findMany({
      where: { personId: id, userId },
      orderBy: [{ sentAt: "desc" }, { id: "desc" }],
      take: 3000,
      select: { sentAt: true, fromMe: true, text: true, source: true },
    }),
    prisma.datingMessage.findMany({ where: { personId: id, userId }, select: { sentAt: true, fromMe: true, source: true } }),
  ]);
  if (!events.length && !recent.length && !person.notes) {
    return { ok: false as const, status: 400, error: "add some notes, dates or messages first" };
  }

  const lines: string[] = [];
  const analyzedMessageSources: Record<string, number> = {};
  let used = 0;
  for (const m of recent) {
    const line = `[${m.sentAt.toISOString().slice(0, 16).replace("T", " ")}] ${m.fromMe ? "Me" : person.name}: ${m.text}`;
    if (used + line.length > THREAD_BUDGET) break;
    used += line.length;
    lines.push(line);
    analyzedMessageSources[m.source] = (analyzedMessageSources[m.source] ?? 0) + 1;
  }
  lines.reverse();
  const stats = threadStats(meta);
  const messageSources: Record<string, number> = {};
  for (const message of meta) messageSources[message.source] = (messageSources[message.source] ?? 0) + 1;
  const sources: InsightSources = {
    messageCount: meta.length, analyzedMessageCount: lines.length, messageSources, analyzedMessageSources,
    timelineCount: events.length, hasNotes: Boolean(person.notes),
    newestMessageImportedAt: newestImport?.toISOString() ?? null,
  };

  const user = [
    `Name: ${person.name}`,
    `Stage: ${person.stage}`,
    `Sources: ${Object.entries(messageSources).map(([source, count]) => `${source}: ${count} messages`).join("; ") || "no imported messages"}; ${events.length} timeline entries.`,
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
    if (!raw || typeof raw !== "object" || Array.isArray(raw) || typeof raw.summary !== "string" || !raw.summary.trim()) {
      throw new Error("Invalid insights response");
    }
  } catch {
    // Do not leak provider errors or mark failed evidence as covered.
    console.error("dating insights generation failed");
    return { ok: false as const, status: 502, error: "Could not refresh this summary; try again" };
  }
  const insights: DatingInsights = {
    summary: typeof raw.summary === "string" ? raw.summary.trim() : undefined,
    remember: cleanList(raw.remember, 30),
    greenFlags: cleanList(raw.greenFlags, 15),
    redFlags: cleanList(raw.redFlags, 15),
    lessons: typeof raw.lessons === "string" ? raw.lessons.trim() : undefined,
    ideas: cleanList(raw.ideas, 8),
    sources,
  };
  const saved = await prisma.datingPerson.updateMany({
    // Compare-and-swap: a slower concurrent request cannot overwrite a newer
    // successful summary. Explicit null also works under PostgreSQL semantics.
    where: { id, userId, insightsAt: person.insightsAt },
    data: { insights: insights as Prisma.InputJsonValue, insightsAt: startedAt },
  });
  const updated = await prisma.datingPerson.findFirst({ where: { id, userId } });
  if (!updated) return { ok: false as const, status: 404, error: "not found" };
  return { ok: true as const, refreshed: saved.count > 0, reason: saved.count ? "refreshed" : "superseded", person: updated, sources };
}

function fmtMin(m: number | null): string {
  if (m === null) return "n/a";
  return m < 60 ? `${Math.round(m)}m` : `${(m / 60).toFixed(1)}h`;
}
