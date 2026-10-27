import { NextResponse } from "next/server";
import { getCurrentUserId } from "@/lib/auth";
import { prisma } from "@/lib/prisma";

// Accept a suggested meeting topic: it becomes a personal-os Project (placed
// last, like POST /api/projects), and its meetings move onto that Project.
export async function POST(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const userId = await getCurrentUserId(request);
  if (!userId) return NextResponse.json({ error: "unauthorized" }, { status: 401 });

  const { id } = await params;
  const source = await prisma.projectSource.findUnique({ where: { id } });
  if (!source || source.userId !== userId) {
    return NextResponse.json({ error: "not found" }, { status: 404 });
  }
  if (source.kind !== "topic" || source.state !== "suggested") {
    return NextResponse.json({ error: "only suggested topics can be accepted" }, { status: 400 });
  }

  const project = await prisma.$transaction(async (tx) => {
    // Claim first, so a double click can't create two Projects.
    // syncedAt stays: it marks the last sync, not this click.
    const claimed = await tx.projectSource.updateMany({
      where: { id, state: "suggested" },
      data: { state: "accepted", syncedAt: source.syncedAt },
    });
    if (!claimed.count) return null;
    const max = await tx.project.aggregate({ where: { userId }, _max: { position: true } });
    const created = await tx.project.create({
      data: {
        userId,
        name: source.name,
        icon: "Folder",
        color: "neutral",
        position: (max._max.position ?? -1) + 1,
      },
    });
    await tx.projectSource.update({ where: { id }, data: { projectId: created.id, syncedAt: source.syncedAt } });
    await tx.projectMeeting.updateMany({ where: { userId, sourceId: id }, data: { projectId: created.id } });
    return created;
  });
  if (!project) return NextResponse.json({ error: "already handled" }, { status: 409 });
  return NextResponse.json({ project });
}
