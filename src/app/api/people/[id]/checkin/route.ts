import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { getCurrentUserId } from "@/lib/auth";

export async function POST(
  request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  const userId = await getCurrentUserId(request);
  if (!userId) return NextResponse.json({ error: "unauthorized" }, { status: 401 });

  const { id } = await params;
  const existing = await prisma.person.findUnique({ where: { id } });
  if (!existing || existing.userId !== userId) {
    return NextResponse.json({ error: "not found" }, { status: 404 });
  }

  const now = new Date();
  const displayName = `${existing.firstName}${existing.lastName ? " " + existing.lastName : ""}`;

  // Atomically: bump lastInteractionAt + create a lightweight Interaction row
  // so the check-in shows up in the person's timeline.
  const [, person] = await prisma.$transaction([
    prisma.interaction.create({
      data: {
        userId,
        occurredAt: now,
        kind: "other",
        title: `Checked in with ${displayName}`,
        personIds: [id],
        source: "checkin",
      },
    }),
    prisma.person.update({
      where: { id },
      data: { lastInteractionAt: now },
    }),
  ]);

  return NextResponse.json({ person });
}
