import { after, NextResponse } from "next/server";
import { getSession } from "@/lib/auth";
import { InputError, parseBoardInput } from "@/lib/board-input";
import { saveToBoard } from "@/lib/board-save";
import { MAX_UPLOAD_BYTES } from "@/lib/board";
import { tagInBackground } from "@/lib/board-tags";

export const dynamic = "force-dynamic";
export const maxDuration = 60;

// PWA Web Share Target (manifest.share_target). The installed app appears in
// the Android / desktop Chrome share sheet; the share arrives here as a form
// POST with the session cookie, and we land back on the board.
export async function POST(request: Request) {
  const session = await getSession();
  const back = new URL("/board", request.url);
  if (!session) return NextResponse.redirect(new URL("/login?from=/board", request.url), 303);
  try {
    const input = await parseBoardInput(request, MAX_UPLOAD_BYTES);
    input.via = "share";
    const { item, duplicate } = await saveToBoard(session.userId, input);
    if (!duplicate) after(() => tagInBackground(session.userId, item.id));
    back.searchParams.set("saved", item.id);
  } catch (e) {
    console.error("[board] share target save failed", e);
    back.searchParams.set("error", e instanceof InputError ? e.message : "Couldn't save that.");
  }
  return NextResponse.redirect(back, 303);
}
