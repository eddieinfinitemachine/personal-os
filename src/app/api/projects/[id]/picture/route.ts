import { NextResponse } from "next/server";
import type { Prisma } from "@prisma/client";
import { getCurrentUserId } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { loadHealthSummary } from "@/lib/health/load";
import {
  isPictureStale,
  pictureEvidence,
  pictureFailureClass,
  readStoredPicture,
  writeHealthPicture,
} from "@/lib/health/picture";

export const dynamic = "force-dynamic";
export const maxDuration = 300;

const headers = { "Cache-Control": "private, no-store" };

async function wantsForce(request: Request): Promise<boolean> {
  const body = await request.json().catch(() => null);
  return body?.force === true;
}

/** Writes the Health page's picture when the data behind it has changed, or when `force` asks for it. */
export async function POST(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const userId = await getCurrentUserId(request);
  if (!userId) return NextResponse.json({ error: "unauthorized" }, { status: 401, headers });

  const { id } = await params;
  const project = await prisma.project.findUnique({ where: { id }, select: { userId: true, kind: true } });
  if (!project || project.userId !== userId || project.kind !== "human") {
    return NextResponse.json({ error: "not found" }, { status: 404, headers });
  }
  const human = await prisma.human.findUnique({ where: { projectId: id } });
  if (!human) return NextResponse.json({ error: "not found" }, { status: 404, headers });

  const force = await wantsForce(request);
  const now = new Date();
  try {
    const summary = await loadHealthSummary(human, now);
    if (summary.labs.markers.length === 0) {
      return NextResponse.json({ picture: null, evidence: {}, updated: false }, { headers });
    }
    const stored = readStoredPicture(human.pictureJson);
    if (stored && !force && !isPictureStale(stored, summary, now)) {
      return NextResponse.json({ picture: stored, evidence: pictureEvidence(stored, summary), updated: false }, { headers });
    }
    const picture = await writeHealthPicture(summary, now);
    await prisma.human.update({
      where: { id: human.id },
      data: { pictureJson: picture as unknown as Prisma.InputJsonValue, pictureAt: now },
    });
    return NextResponse.json({ picture, evidence: pictureEvidence(picture, summary), updated: true }, { headers });
  } catch (error) {
    // The failure type only: messages from these errors can quote health data.
    console.error(`health picture failed: ${pictureFailureClass(error)}`);
    return NextResponse.json({ error: "Could not update the picture. Try again." }, { status: 502, headers });
  }
}
