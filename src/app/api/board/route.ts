import { after, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { getCurrentUserId, getSession } from "@/lib/auth";
import { bearerSession, resolveCaptureUser } from "@/lib/capture-auth";
import { InputError, parseBoardInput } from "@/lib/board-input";
import { saveToBoard } from "@/lib/board-save";
import { MAX_UPLOAD_BYTES } from "@/lib/board";
import { quickSource } from "@/lib/capture-review/record";
import { CaptureReviewError } from "@/lib/capture-review/types";
import { tagInBackground } from "@/lib/board-tags";

export const dynamic = "force-dynamic";
export const maxDuration = 60;

// Save anything to the mood board. Deliberately forgiving about shape, since
// the iOS Shortcut, Chrome extension and in-app paste all send differently:
//   - JSON  { url | text | input | imageUrl, note?, title?, via? }
//   - multipart form with a `file` image and/or text fields
//   - a raw image body (Content-Type: image/*)
//   - plain text, or ?url= / ?text= query params
// Auth: session cookie (the web app), the same session as a bearer (the
// native app, ec) or the capture bearer token (Shortcut, extension);
// middleware lets POST through so the route decides.
export async function POST(request: Request) {
  const cookieSession = await getSession();
  const appSession = cookieSession ? null : await bearerSession(request);
  const session = cookieSession ?? appSession;
  const userId = session?.userId ?? (await resolveCaptureUser(request));
  if (!userId) return NextResponse.json({ error: "unauthorized" }, { status: 401 });

  try {
    const input = await parseBoardInput(request, MAX_UPLOAD_BYTES);
    if (!session && input.via === "app") input.via = "shortcut";
    const marker = request.headers.get("X-Capture-Source") ?? input.source;
    const source =
      marker === "mac" || marker === "chrome" ? quickSource(marker) : appSession ? "ec" : session ? "web" : "quick";
    const { item, duplicate, reviewId, created } = await saveToBoard(userId, input, { request, source });
    if (created && !duplicate) after(() => tagInBackground(userId, item.id));
    const label = item.title ?? item.siteName ?? item.kind;
    return NextResponse.json({
      ok: true,
      item,
      duplicate,
      reviewId,
      message: duplicate ? `Already on your board · ${label}` : `Saved to board · ${label}`,
    });
  } catch (e) {
    if (e instanceof InputError || e instanceof CaptureReviewError) {
      return NextResponse.json({ error: e.message }, { status: e.status });
    }
    console.error("[board] save failed", e);
    return NextResponse.json({ error: "Couldn't save that." }, { status: 500 });
  }
}

// Cookie or bearer: middleware has already verified either and forwards the
// user id, so the native app reads the board with the same session it saves with.
export async function GET(request: Request) {
  const userId = await getCurrentUserId(request);
  if (!userId) return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  const items = await prisma.boardItem.findMany({
    where: { userId },
    orderBy: { savedAt: "desc" },
    take: 3000,
  });
  return NextResponse.json({ items });
}
