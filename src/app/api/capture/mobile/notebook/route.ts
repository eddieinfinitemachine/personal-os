import { NextResponse, after } from "next/server";
import { resolveCaptureUser } from "@/lib/capture-auth";
import { syncRecentTodos } from "@/lib/gcal";
import { MobileCaptureError, readMobileCapture } from "@/lib/mobile-capture-input";
import { captureNotebook } from "@/lib/notebook-capture";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";
export const maxDuration = 90;

function failure(error: unknown) {
  if (error instanceof MobileCaptureError) return NextResponse.json({ error: error.message }, { status: error.status });
  console.error("notebook capture failed", error);
  return NextResponse.json({ error: "Personal OS could not save this yet. Your capture is safe on this device; try again." }, { status: 500 });
}
export async function POST(request: Request) {
  try {
    const userId = await resolveCaptureUser(request);
    if (!userId) return NextResponse.json({ error: "unauthorized" }, { status: 401 });
    const input = await readMobileCapture(request);
    const result = await captureNotebook(userId, input);
    after(async () => { try { await syncRecentTodos(); } catch (error) { console.error("notebook capture calendar sync failed", error); } });
    return NextResponse.json(result, { headers: { "Cache-Control": "no-store" } });
  } catch (error) { return failure(error); }
}
