import { after, NextResponse } from "next/server";
import { getCurrentUserId } from "@/lib/auth";
import { addSuggestion } from "@/lib/dating-filer";
import { toPersonDTO } from "@/lib/dating-server";

import {refreshDatingInsights} from "@/lib/dating-insights";

export const maxDuration=120;
export const dynamic = "force-dynamic";

type Ctx = { params: Promise<{ id: string }> };

// "Add her" on a Granola suggestion: creates the person and files the note(s).
export async function POST(request: Request, { params }: Ctx) {
  const userId = await getCurrentUserId(request);
  if (!userId) return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  const { id } = await params;
  const res = await addSuggestion(userId, id);
  if (!res) return NextResponse.json({ error: "not found" }, { status: 404 });
  after(async()=>{try{await refreshDatingInsights(userId,res.person.id,{onlyIfStale:true});}catch{console.error("Dating summary refresh failed");}});
  return NextResponse.json({ person: toPersonDTO(res.person), filed: res.filed });
}
