import { NextResponse } from "next/server";
import { getCurrentUserId } from "@/lib/auth";
import { linkSuggestion } from "@/lib/dating-filer";
import { toPersonDTO } from "@/lib/dating-server";

export const dynamic = "force-dynamic";

type Ctx = { params: Promise<{ id: string }> };

// "Add to…" on a Granola suggestion: files the note(s) onto someone already here.
export async function POST(request: Request, { params }: Ctx) {
  const userId = await getCurrentUserId(request);
  if (!userId) return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  const { id } = await params;
  const body = (await request.json().catch(() => ({}))) as { personId?: unknown };
  if (typeof body.personId !== "string" || !body.personId) {
    return NextResponse.json({ error: "personId is required" }, { status: 400 });
  }
  const res = await linkSuggestion(userId, id, body.personId);
  if (!res) return NextResponse.json({ error: "not found" }, { status: 404 });
  return NextResponse.json({ person: toPersonDTO(res.person), filed: res.filed, linked: res.linked });
}
