import { after, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { getCurrentUserId } from "@/lib/auth";
import { eventPatch, toEventDTO } from "@/lib/dating-server";

import {createEvent} from "@/lib/dating-intake/events";
import {refreshDatingInsights} from "@/lib/dating-insights";

export const dynamic = "force-dynamic";

type Ctx = { params: Promise<{ id: string }> };

export async function POST(request: Request, { params }: Ctx) {
  const userId = await getCurrentUserId(request);
  if (!userId) return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  const { id } = await params;
  const person = await prisma.datingPerson.findFirst({ where: { id, userId }, select: { id: true } });
  if (!person) return NextResponse.json({ error: "not found" }, { status: 404 });
  const body = (await request.json().catch(() => ({}))) as Record<string, unknown>;
  const data = eventPatch(body);
  if (!data.title) return NextResponse.json({ error: "title is required" }, { status: 400 });
  const event=await createEvent(userId,id,{...data,title:data.title});
  if(!event)return NextResponse.json({error:"not found"},{status:404});
  after(async()=>{try{await refreshDatingInsights(userId,id,{onlyIfStale:true});}catch{console.error("Dating summary refresh failed");}});
  return NextResponse.json({ event: toEventDTO(event) });
}
