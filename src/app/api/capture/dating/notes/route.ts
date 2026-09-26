import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { resolveCaptureUser } from "@/lib/capture-auth";
import { granolaExternalId, noonUTC, suggestionsFrom } from "@/lib/dating";
import { applyProposedPerson, fileDatingNote, loadKnownPeople, NOTE_BUDGET } from "@/lib/dating-filer";

export const dynamic = "force-dynamic";
export const maxDuration = 300;

// Granola meeting notes → dating timeline. Bearer CAPTURE_TOKEN.
//
// POST { items: [{ externalId, occurredAt, title, url, text }] } (max 20)
//   Each meeting is filed by Claude. Notes about people already on /dating are
//   saved straight away (source "granola", keyed granola:<meeting>:<person>, so
//   re-sending a meeting is a no-op). Someone new is never created here: they
//   are stored as pending DatingSuggestions ("New from Granola" on /dating)
//   and also returned under `suggestions`. A meeting that already filed
//   anything or left a suggestion is skipped before the Claude call.
// → { filed: [...], skipped, suggestions: [...], errors: [...] }

const MAX_ITEMS = 20;

type Incoming = { externalId?: unknown; occurredAt?: unknown; title?: unknown; url?: unknown; text?: unknown };

export async function POST(request: Request) {
  const userId = await resolveCaptureUser(request);
  if (!userId) return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  const body = (await request.json().catch(() => ({}))) as { items?: unknown };
  if (!Array.isArray(body.items)) return NextResponse.json({ error: "items[] required" }, { status: 400 });
  if (body.items.length > MAX_ITEMS) return NextResponse.json({ error: `max ${MAX_ITEMS} per batch` }, { status: 413 });

  const filed: { meetingId: string; personId: string; name: string; eventIds: string[] }[] = [];
  const suggestions: {
    meetingId: string;
    name: string;
    title: string | null;
    url: string | null;
    occurredAt: string;
    summary: string;
    note: string;
  }[] = [];
  const errors: { meetingId: string; error: string }[] = [];
  let skipped = 0;

  for (const raw of body.items as Incoming[]) {
    const meetingId = typeof raw.externalId === "string" ? raw.externalId.trim().slice(0, 120) : "";
    const text = typeof raw.text === "string" ? raw.text.trim().slice(0, NOTE_BUDGET) : "";
    const occurredAt = typeof raw.occurredAt === "string" ? new Date(raw.occurredAt) : null;
    if (!meetingId || !text || !occurredAt || Number.isNaN(occurredAt.getTime())) {
      errors.push({ meetingId: meetingId || "?", error: "externalId, occurredAt and text are required" });
      continue;
    }
    const title = typeof raw.title === "string" && raw.title.trim() ? raw.title.trim().slice(0, 200) : null;
    const url = typeof raw.url === "string" && /^https?:\/\/\S+$/.test(raw.url.trim()) ? raw.url.trim() : null;

    // Already filed to anyone, or already suggested someone (even if since
    // added or dismissed): skip before spending a Claude call.
    const [filedBefore, suggestedBefore] = await Promise.all([
      prisma.datingEvent.findFirst({
        where: { userId, externalId: { startsWith: granolaExternalId(meetingId, "") } },
        select: { id: true },
      }),
      prisma.datingSuggestion.findFirst({ where: { userId, meetingId }, select: { id: true } }),
    ]);
    if (filedBefore || suggestedBefore) {
      skipped++;
      continue;
    }

    let result;
    try {
      result = await fileDatingNote({
        userId,
        text,
        occurredAt,
        source: "granola",
        sourceLabel: title,
        sourceUrl: url,
        people: await loadKnownPeople(userId),
      });
    } catch (e) {
      console.error("granola dating filing failed", meetingId, e);
      errors.push({ meetingId, error: "Claude could not file this one" });
      continue;
    }

    const drafts = suggestionsFrom(result.proposal.people);
    if (drafts.length) {
      // Insert-only: an existing row (pending, added or dismissed) is left alone.
      await prisma.datingSuggestion.createMany({
        data: drafts.map((d) => ({ userId, meetingId, title, url, occurredAt: noonUTC(result.day), ...d })),
        skipDuplicates: true,
      });
      for (const d of drafts) suggestions.push({ meetingId, title, url, occurredAt: result.day, ...d });
    }

    for (const item of result.proposal.people) {
      if (!item.personId) continue;
      const applied = await applyProposedPerson(userId, item, {
        day: result.day,
        source: "granola",
        sourceLabel: title ?? "Granola",
        sourceUrl: url,
        externalId: (personId) => granolaExternalId(meetingId, personId),
      });
      if (applied) filed.push({ meetingId, personId: applied.personId, name: applied.name, eventIds: applied.eventIds });
      else skipped++;
    }
  }

  return NextResponse.json({ filed, skipped, suggestions, errors });
}
