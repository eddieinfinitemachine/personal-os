import { after, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { getCurrentUserId } from "@/lib/auth";
import { eventPatch, toEventDTO } from "@/lib/dating-server";

import {mutateEvent} from "@/lib/dating-intake/events";
import {refreshDatingInsights} from "@/lib/dating-insights";

export const dynamic = "force-dynamic";

type Ctx = { params: Promise<{ eventId: string }> };

export async function PATCH(request: Request, { params }: Ctx) {
  const userId = await getCurrentUserId(request);
  if (!userId) return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  const { eventId } = await params;
  const body = (await request.json().catch(() => ({}))) as Record<string, unknown>;
  const event = await mutateEvent(userId,eventId,eventPatch(body));
  if(!event)return NextResponse.json({error:"not found"},{status:404});
  after(async()=>{try{await refreshDatingInsights(userId,event.personId,{onlyIfStale:true});}catch{console.error("Dating summary refresh failed");}});
  return NextResponse.json({ event: toEventDTO(event) });
}

export async function DELETE(request: Request, { params }: Ctx) {
  const userId = await getCurrentUserId(request);
  if (!userId) return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  const { eventId } = await params;
  const event = await mutateEvent(userId,eventId,null);
  if(!event)return NextResponse.json({error:"not found"},{status:404});
  after(async()=>{try{await refreshDatingInsights(userId,event.personId,{onlyIfStale:true});}catch{console.error("Dating summary refresh failed");}});
  return NextResponse.json({ ok: true });
}
