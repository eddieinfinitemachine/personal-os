import { NextResponse } from "next/server";
import sharp from "sharp";
import { prisma } from "@/lib/prisma";
import { getCurrentUserId } from "@/lib/auth";
import { callClaudeText, type ClaudeContentBlock } from "@/lib/claude";
import { readUserImage } from "@/lib/user-image";
import {
  TASTE_MARKER,
  TASTE_PER_PERSON,
  datingPhotoFolder,
  durationLabel,
  selectTastePhotos,
  splitTaste,
} from "@/lib/dating-photos";

export const dynamic = "force-dynamic";
// Up to 24 photos ride along, which makes the Claude turn slower than text alone.
export const maxDuration = 300;

// Photos are stored at up to 1600px; the taste read doesn't need that, and
// smaller images keep the request light and the turn fast.
const VISION_EDGE = 768;

const SYSTEM = `You help one person learn from their dating life. Given notes on everyone they have dated (and sometimes a few photos of each), write two parts.

Part 1, patterns: find the patterns across people: what they are drawn to, what reliably goes well or badly, recurring flags they overlooked, how they show up, and what they seem to actually want. Cite people by name as evidence.

Then a line that is exactly ${TASTE_MARKER} and then part 2, their taste: insight into who they are actually drawn to.
- Traits shared by the people they stayed interested in versus the ones they lost interest in (use stage, how long it lasted, vibe scores, flags and notes to tell which is which).
- Where the type they describe in their own notes diverges from who they actually pursue and stay with.
- How looks and character relate to how long things lasted, e.g. whether initial attraction predicted staying power or character did.
Use the photos only for broad, respectful observations about style and presentation (for example "polished and put-together", "outdoorsy, low-key", "artsy"), and only where they help the pattern. Never rate, rank or score anyone's looks, never compare two people's attractiveness, no commentary on bodies beyond what the pattern truly needs, and never infer or mention ethnicity, race, religion, health or age from appearance. If there are no photos or too little signal, say what is missing instead of guessing.

Be direct, warm and specific. Address the reader as "you". Plain text, short sections with a heading line each ("## Heading"), bullets with "- ". No preamble, no em dashes.`;

type Img = { media_type: string; data: string };

async function toVisionImage(userId: string, personId: string, url: string): Promise<Img | null> {
  const raw = await readUserImage(userId, datingPhotoFolder(personId), url);
  if (!raw) return null;
  try {
    const buf = await sharp(raw, { limitInputPixels: 100_000_000 })
      .rotate()
      .resize({ width: VISION_EDGE, height: VISION_EDGE, fit: "inside", withoutEnlargement: true })
      .jpeg({ quality: 80 })
      .toBuffer();
    return { media_type: "image/jpeg", data: buf.toString("base64") };
  } catch (e) {
    console.warn("[dating patterns] photo decode failed", url, e instanceof Error ? e.message : String(e));
    return null;
  }
}

const month = (d: Date | null) => (d ? d.toISOString().slice(0, 7) : null);

// POST → a cross-person read of lessons, flags and outcomes, plus a "Your
// taste" read that also looks at each person's newest photos. Not stored.
export async function POST(request: Request) {
  const userId = await getCurrentUserId(request);
  if (!userId) return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  const people = await prisma.datingPerson.findMany({
    where: { userId },
    orderBy: { createdAt: "asc" },
    include: {
      events: { orderBy: { occurredAt: "asc" } },
      photos: { orderBy: { createdAt: "desc" }, take: TASTE_PER_PERSON, select: { id: true, url: true, createdAt: true } },
    },
  });
  const withSignal = people.filter(
    (p) => p.lessons || p.notes || p.greenFlags.length || p.redFlags.length || p.events.length || p.photos.length,
  );
  if (withSignal.length < 2) {
    return NextResponse.json({ error: "write lessons or notes on at least two people first" }, { status: 400 });
  }

  // Fetch + shrink every chosen photo in parallel (each read times out at 10 s).
  const picked = selectTastePhotos(withSignal);
  const images = new Map<string, Img[]>();
  await Promise.all(
    withSignal.map(async (p) => {
      const got = await Promise.all((picked.get(p.id) ?? []).map((ph) => toVisionImage(userId, p.id, ph.url)));
      images.set(p.id, got.filter((g): g is Img => g !== null));
    }),
  );

  const content: ClaudeContentBlock[] = [];
  let imageCount = 0;
  for (const p of withSignal) {
    const vibes = p.events.flatMap((e) => (e.vibe ? [e.vibe] : []));
    const lasted = durationLabel(p.metAt, p.endedAt);
    const imgs = images.get(p.id) ?? [];
    const head = [
      p.stage,
      p.metVia && `met via ${p.metVia}`,
      p.metAt && `${month(p.metAt)}${p.endedAt ? ` to ${month(p.endedAt)}` : ""}`,
      lasted && `${p.endedAt ? "lasted" : "so far"} ${lasted}`,
      vibes.length && `avg vibe ${(vibes.reduce((a, b) => a + b, 0) / vibes.length).toFixed(1)}/10`,
    ]
      .filter(Boolean)
      .join(", ");
    const text = [
      `## ${p.name} (${head})`,
      p.greenFlags.length && `Green: ${p.greenFlags.join("; ")}`,
      p.redFlags.length && `Red: ${p.redFlags.join("; ")}`,
      p.events.length &&
        `Timeline: ${p.events.map((e) => `${e.kind} "${e.title}"${e.vibe ? ` ${e.vibe}/10` : ""}`).join(", ")}`,
      p.notes && `Notes: ${p.notes.slice(0, 3000)}`,
      p.lessons && `Lessons: ${p.lessons.slice(0, 3000)}`,
      imgs.length ? `Photos of ${p.name} (${imgs.length}) follow.` : "No photos.",
    ]
      .filter(Boolean)
      .join("\n");
    content.push({ type: "text", text });
    for (const img of imgs) {
      content.push({ type: "image", source: { type: "base64", ...img } });
      imageCount++;
    }
  }

  try {
    const raw = await callClaudeText({
      system: SYSTEM,
      messages: [{ role: "user", content }],
      maxTokens: 4000,
    });
    const { text, taste } = splitTaste(raw);
    return NextResponse.json({ text, taste, photos: imageCount });
  } catch (e) {
    console.error("dating patterns failed", e);
    return NextResponse.json({ error: "Claude could not read this; try again" }, { status: 502 });
  }
}
