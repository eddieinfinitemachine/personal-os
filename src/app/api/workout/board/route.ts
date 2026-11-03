import { NextResponse } from "next/server";
import { getCurrentUserId } from "@/lib/auth";
import { callClaudeJSON, type ClaudeContentBlock } from "@/lib/claude";
import { buildBoardPrompt, buildBoardUserPrompt, normalizeBoard } from "@/lib/workout-board";
import { loadHealth } from "@/lib/workout-health";

export const maxDuration = 120;

const MAX_PHOTOS = 3;
const MAX_PHOTO_BYTES = 6 * 1024 * 1024;
const ALLOWED_TYPES = new Set(["image/jpeg", "image/png", "image/webp", "image/gif"]);

// A photo of a class whiteboard → Claude (vision) → a draft of the workout
// ({ board }) for the athlete to check before it joins the workout log. The
// health profile's sex picks men's or women's Rx weights. Nothing is stored.
export async function POST(request: Request) {
  const userId = await getCurrentUserId(request);
  if (!userId) return NextResponse.json({ error: "unauthorized" }, { status: 401 });

  const form = await request.formData();
  const photos = form.getAll("photos").filter((p): p is File => p instanceof File && p.size > 0);
  if (!photos.length) return NextResponse.json({ error: "Add a photo of the whiteboard." }, { status: 400 });
  if (photos.length > MAX_PHOTOS) return NextResponse.json({ error: `Max ${MAX_PHOTOS} photos.` }, { status: 400 });

  const images: ClaudeContentBlock[] = [];
  for (const photo of photos) {
    if (photo.size > MAX_PHOTO_BYTES) {
      return NextResponse.json({ error: "A photo is too large (6 MB max)." }, { status: 413 });
    }
    const type = ALLOWED_TYPES.has(photo.type) ? photo.type : "image/jpeg";
    images.push({
      type: "image",
      source: { type: "base64", media_type: type, data: Buffer.from(await photo.arrayBuffer()).toString("base64") },
    });
  }
  const notes = typeof form.get("notes") === "string" ? String(form.get("notes")).slice(0, 500) : "";
  const health = await loadHealth(userId).catch((err) => {
    console.error("workout health load failed", err);
    return null;
  });

  let raw: unknown;
  try {
    raw = await callClaudeJSON<unknown>({
      system: buildBoardPrompt(),
      messages: [{ role: "user", content: [...images, { type: "text", text: buildBoardUserPrompt(health?.sex ?? null, notes) }] }],
      maxTokens: 3000,
    });
  } catch (err) {
    console.error("workout board read failed", err);
    const msg = err instanceof Error ? err.message : "read failed";
    const overloaded = /529|overloaded/i.test(msg);
    return NextResponse.json(
      { error: overloaded ? "Claude is overloaded right now — try again in a few seconds." : "Couldn't read that board. Try a sharper, straight-on photo." },
      { status: overloaded ? 503 : 502 },
    );
  }
  try {
    return NextResponse.json({ board: normalizeBoard(raw) });
  } catch (err) {
    const why = err instanceof Error ? err.message : "";
    return NextResponse.json({ error: `No workout found on that board${why && why !== "no workout on the board" ? `: ${why}` : "."}` }, { status: 422 });
  }
}
