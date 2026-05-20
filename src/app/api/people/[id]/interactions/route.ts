import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { getCurrentUserId } from "@/lib/auth";

// Returns all interactions involving the given person, scoped to the current
// user. Sorted newest first.
export async function GET(
  request: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const userId = await getCurrentUserId(request);
  if (!userId) return NextResponse.json({ error: "unauthorized" }, { status: 401 });

  const { id } = await params;
  const person = await prisma.person.findUnique({ where: { id } });
  if (!person || person.userId !== userId) {
    return NextResponse.json({ error: "not found" }, { status: 404 });
  }

  const interactions = await prisma.interaction.findMany({
    where: { userId, personIds: { has: id } },
    orderBy: [{ occurredAt: "desc" }, { createdAt: "desc" }],
    select: {
      id: true,
      occurredAt: true,
      kind: true,
      title: true,
      location: true,
      notes: true,
      source: true,
      projectId: true,
      createdAt: true,
    },
  });

  return NextResponse.json({ interactions });
}
