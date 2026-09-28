import { after, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { getCurrentUserId } from "@/lib/auth";
import { newPersonError, personPatch, personPatchError, toPersonDTO } from "@/lib/dating-server";
import { refreshDatingInsights } from "@/lib/dating-insights";

import { createWithIdentity } from "@/lib/dating-intake/people";
import { failure } from "@/lib/dating-intake/http";

export const dynamic = "force-dynamic";
export const maxDuration = 120;

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
  const invalid = personPatchError(body) ?? newPersonError(body);
  if (invalid) return NextResponse.json({ error: invalid }, { status: 400 });
  const data = personPatch(body);
  if (!data.name) return NextResponse.json({ error: "name is required" }, { status: 400 });
  let person;
  try { person = data.handles?.length ? await createWithIdentity(userId, { ...data, name:data.name }) : await prisma.datingPerson.create({ data: { ...data, name: data.name, userId } }); } catch(e) { return failure(e); }
  if (person.notes?.trim()) {
    after(async () => {
      try {
        const result = await refreshDatingInsights(userId, person.id);
        if (!result.ok) console.error("dating first summary refresh failed", { status: result.status });
      } catch {
        // Creation is already saved; background model errors cannot undo it.
        console.error("dating first summary refresh failed");
      }
    });
  }
  return NextResponse.json({ person: toPersonDTO(person) });
}
