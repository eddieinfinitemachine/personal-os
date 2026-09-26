import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { getCurrentUserId } from "@/lib/auth";
import { personPatch, toPersonDTO } from "@/lib/dating-server";

export const dynamic = "force-dynamic";

export async function GET(request: Request) {
  const userId = await getCurrentUserId(request);
  if (!userId) return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  const people = await prisma.datingPerson.findMany({
    where: { userId },
    orderBy: [{ lastMessageAt: { sort: "desc", nulls: "last" } }, { createdAt: "desc" }],
  });
  return NextResponse.json({ people: people.map(toPersonDTO) });
}

export async function POST(request: Request) {
  const userId = await getCurrentUserId(request);
  if (!userId) return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  const body = (await request.json().catch(() => ({}))) as Record<string, unknown>;
  const data = personPatch(body);
  if (!data.name) return NextResponse.json({ error: "name is required" }, { status: 400 });
  const person = await prisma.datingPerson.create({ data: { ...data, name: data.name, userId } });
  return NextResponse.json({ person: toPersonDTO(person) });
}
