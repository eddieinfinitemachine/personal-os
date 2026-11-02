import { NextResponse } from "next/server";
import { getCurrentUserId } from "@/lib/auth";
import { getCaptureReview } from "@/lib/capture-review/read";
import { requireRevision, setReviewDismissal } from "@/lib/capture-review/mutate";
import { CaptureReviewError } from "@/lib/capture-review/types";
import { reviewFailure, reviewJson } from "@/lib/capture-review/http";
type Context = { params: Promise<{ id: string }> };
export const dynamic = "force-dynamic";
export async function GET(request: Request, context: Context) {
  try {
    const userId = await getCurrentUserId(request);
    if (!userId) return NextResponse.json({ error: "unauthorized" }, { status: 401 });
    const { id } = await context.params;
    const review = await getCaptureReview(userId, id);
    if (!review) throw new CaptureReviewError(404, "Capture not found.");
    return NextResponse.json({ review }, { headers: { "Cache-Control": "no-store" } });
  } catch (error) { return reviewFailure(error); }
}
export async function PATCH(request: Request, context: Context) {
  try {
    const userId = await getCurrentUserId(request);
    if (!userId) return NextResponse.json({ error: "unauthorized" }, { status: 401 });
    const data = await reviewJson(request);
    if (data.action !== "dismiss" && data.action !== "restore") throw new CaptureReviewError(400, "Invalid review action.");
    const revision = requireRevision(data.revision), { id } = await context.params;
    const review = await setReviewDismissal(userId, id, revision, data.action === "dismiss");
    return NextResponse.json({ review }, { headers: { "Cache-Control": "no-store" } });
  } catch (error) { return reviewFailure(error); }
}
