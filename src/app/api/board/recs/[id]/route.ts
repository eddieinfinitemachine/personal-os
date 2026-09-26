import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { getCurrentUserId } from "@/lib/auth";
import { saveToBoard } from "@/lib/board-save";
import { InputError } from "@/lib/board-input";

export const dynamic = "force-dynamic";
export const maxDuration = 60;

type Ctx = { params: Promise<{ id: string }> };

// { action: "save" }    copy the pick onto the board (and count it as a like)
// { action: "dismiss" } not for me; steers the next run away from it
export async function POST(request: Request, { params }: Ctx) {
  const userId = await getCurrentUserId(request);
  if (!userId) return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  const { id } = await params;
  const rec = await prisma.boardRec.findFirst({ where: { id, userId } });
  if (!rec) return NextResponse.json({ error: "not found" }, { status: 404 });
  const { action } = (await request.json().catch(() => ({}))) as { action?: string };

  if (action === "dismiss") {
    await prisma.boardRec.update({ where: { id }, data: { status: "dismissed" } });
    return NextResponse.json({ ok: true });
  }
  if (action !== "save") return NextResponse.json({ error: "unknown action" }, { status: 400 });

  try {
    // Search-page fallbacks aren't the thing itself; save those as a note.
    const isSearch = rec.url ? /\/(results|search)\b|[?&](q|search_query)=/.test(rec.url) : true;
    const title = rec.creator ? `${rec.title} · ${rec.creator}` : rec.title;
    const { item } = await saveToBoard(
      userId,
      isSearch
        ? { note: `${title}\n${rec.url ?? ""}`.trim(), via: "rec" }
        : { url: rec.url!, title: rec.title, via: "rec" },
    );
    await prisma.boardRec.update({ where: { id }, data: { status: "saved", boardItemId: item.id } });
    return NextResponse.json({ ok: true, item });
  } catch (e) {
    if (e instanceof InputError) return NextResponse.json({ error: e.message }, { status: e.status });
    console.error("[board-recs] save failed", e);
    return NextResponse.json({ error: "Couldn't save that." }, { status: 500 });
  }
}
