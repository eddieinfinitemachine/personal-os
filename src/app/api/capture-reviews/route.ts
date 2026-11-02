import { after, NextResponse } from "next/server";
import { getCurrentUserId } from "@/lib/auth";
import { listCaptureReviews } from "@/lib/capture-review/read";
import { CaptureReviewError } from "@/lib/capture-review/types";
import { reviewFailure } from "@/lib/capture-review/http";
import { reconcilePendingReviewCalendars } from "@/lib/capture-review/calendar";
export const dynamic = "force-dynamic";
export async function GET(request: Request) {
  try {
    const userId = await getCurrentUserId(request);
    if (!userId) return NextResponse.json({ error: "unauthorized" }, { status: 401 });
    const params = new URL(request.url).searchParams;
    const state = params.get("state") ?? "pending";
    if (state !== "pending" && state !== "dismissed") throw new CaptureReviewError(400, "Invalid review state.");
    const number = (key: string, fallback: number) => {
      const raw = params.get(key); if (raw === null) return fallback;
      if (!/^\d+$/.test(raw) || !Number.isSafeInteger(Number(raw))) throw new CaptureReviewError(400, "Invalid pagination.");
      return Number(raw);
    };
    const list = await listCaptureReviews(userId, { state, offset: number("offset", 0), limit: number("limit", 10) });
    after(() => reconcilePendingReviewCalendars(userId, list.items.map(item => item.id)));
    return NextResponse.json(list, { headers: { "Cache-Control": "no-store" } });
  } catch (error) { return reviewFailure(error); }
}
