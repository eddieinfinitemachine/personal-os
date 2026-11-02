import { prisma } from "@/lib/prisma";
import { getCaptureReview } from "./read";
import { CaptureReviewError } from "./types";

export function requireRevision(value: unknown): number {
  if (typeof value !== "number" || !Number.isSafeInteger(value) || value < 1) throw new CaptureReviewError(400, "A valid review revision is required.");
  return value;
}
export async function setReviewDismissal(userId: string, id: string, revision: number, dismissed: boolean) {
  requireRevision(revision);
  const changed = await prisma.captureReview.updateMany({ where: { id, userId, revision }, data: { dismissedAt: dismissed ? new Date() : null, revision: { increment: 1 } } });
  if (!changed.count) {
    const exists = await prisma.captureReview.findFirst({ where: { id, userId }, select: { id: true } });
    throw new CaptureReviewError(exists ? 409 : 404, exists ? "This capture changed. Refresh it and try again." : "Capture not found.");
  }
  const result = await getCaptureReview(userId, id);
  if (!result) throw new CaptureReviewError(404, "Capture not found.");
  return result;
}
