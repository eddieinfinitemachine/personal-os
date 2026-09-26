import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { getSession } from "@/lib/auth";
import { resolveCaptureUser } from "@/lib/capture-auth";
import { InputError, parseBoardInput } from "@/lib/board-input";
import { saveToBoard } from "@/lib/board-save";
import { MAX_UPLOAD_BYTES } from "@/lib/board";

export const dynamic = "force-dynamic";
export const maxDuration = 60;

// Save anything to the mood board. Deliberately forgiving about shape, since
// the iOS Shortcut, Chrome extension and in-app paste all send differently:
//   - JSON  { url | text | input | imageUrl, note?, title?, via? }
//   - multipart form with a `file` image and/or text fields
//   - a raw image body (Content-Type: image/*)
//   - plain text, or ?url= / ?text= query params
// Auth: session cookie (the app) or the capture bearer token (Shortcut,
// extension); middleware lets POST through so the route decides.
export async function POST(request: Request) {
  const session = await getSession();
  const userId = session?.userId ?? (await resolveCaptureUser(request));
  if (!userId) return NextResponse.json({ error: "unauthorized" }, { status: 401 });

  try {
    const input = await parseBoardInput(request, MAX_UPLOAD_BYTES);
    if (!session && input.via === "app") input.via = "shortcut";
    const { item, duplicate } = await saveToBoard(userId, input);
    const label = item.title ?? item.siteName ?? item.kind;
    return NextResponse.json({
      ok: true,
      item,
      duplicate,
      message: duplicate ? `Already on your board · ${label}` : `Saved to board · ${label}`,
    });
  } catch (e) {
    if (e instanceof InputError) {
      return NextResponse.json({ error: e.message }, { status: e.status });
    }
    console.error("[board] save failed", e);
    return NextResponse.json({ error: "Couldn't save that." }, { status: 500 });
  }
}

export async function GET() {
  const session = await getSession();
  if (!session) return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  const items = await prisma.boardItem.findMany({
    where: { userId: session.userId },
    orderBy: { savedAt: "desc" },
    take: 1000,
  });
  return NextResponse.json({ items });
}
