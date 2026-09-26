import { NextResponse } from "next/server";
import { resolveCaptureUser } from "@/lib/capture-auth";
import { fileGranolaMeeting, NOTE_BUDGET, type GranolaFiled, type GranolaSuggested } from "@/lib/dating-filer";

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

  const filed: GranolaFiled[] = [];
  const suggestions: GranolaSuggested[] = [];
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

    // Skipped before the Claude call when already filed or suggested.
    const res = await fileGranolaMeeting(userId, { meetingId, occurredAt, title, url, text });
    if (res.status === "skipped") skipped++;
    else if (res.status === "error") errors.push({ meetingId, error: res.error });
    else {
      filed.push(...res.filed);
      suggestions.push(...res.suggestions);
      skipped += res.skipped;
    }
  }

  return NextResponse.json({ filed, skipped, suggestions, errors });
}
