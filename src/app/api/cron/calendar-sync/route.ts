import { NextResponse } from "next/server";
import {
  isCalendarSyncConfigured,
  reconcileCalendar,
} from "@/lib/gcal";

export const dynamic = "force-dynamic";
export const maxDuration = 60;

// Daily safety net for writes that bypass the request hooks (cascade deletes,
// manual DB edits) and for the initial backfill.
export async function GET(request: Request) {
  const secret = process.env.CRON_SECRET;
  if (secret && request.headers.get("authorization") !== `Bearer ${secret}`) {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }

  if (!isCalendarSyncConfigured()) {
    return NextResponse.json({ skipped: "not configured" });
  }

  const result = await reconcileCalendar();
  return NextResponse.json(result);
}
