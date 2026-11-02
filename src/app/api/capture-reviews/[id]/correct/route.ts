import { after, NextResponse } from "next/server";
import { getCurrentUserId } from "@/lib/auth";
import { correctCaptureReview } from "@/lib/capture-review/correct";
import { reconcileReviewCalendar } from "@/lib/capture-review/calendar";
import { reviewFailure, reviewJson } from "@/lib/capture-review/http";
import type { ReviewCorrection } from "@/lib/capture-review/types";
export const dynamic = "force-dynamic";
export const runtime = "nodejs";
export const maxDuration = 60;
export async function POST(request: Request, context: { params: Promise<{ id: string }> }) {
  try {
    const userId = await getCurrentUserId(request);
    if (!userId) return NextResponse.json({ error: "unauthorized" }, { status: 401 });
    const body = await reviewJson(request), { id } = await context.params;
    const review = await correctCaptureReview(userId, id, body as unknown as ReviewCorrection);
    after(() => reconcileReviewCalendar(userId, id));
    return NextResponse.json({ review }, { headers: { "Cache-Control": "no-store" } });
  } catch (error) { return reviewFailure(error); }
}
