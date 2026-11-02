import { NextResponse, after } from "next/server";
import { resolveCaptureUser } from "@/lib/capture-auth";
import { prisma } from "@/lib/prisma";
import { syncRecentTodos } from "@/lib/gcal";
import { captureMobile } from "@/lib/mobile-capture";
import { MAX_MOBILE_FILES, MAX_MOBILE_REQUEST_BYTES, MobileCaptureError, readMobileCapture } from "@/lib/mobile-capture-input";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";
export const maxDuration = 60;

function failure(error: unknown) {
  if (error instanceof MobileCaptureError) return NextResponse.json({ error: error.message }, { status: error.status });
  console.error("mobile capture failed", error);
  return NextResponse.json({ error: "Personal OS could not save this yet. Your capture is safe on this device; try again." }, { status: 500 });
}
export async function GET(request: Request) {
  try {
    const userId = await resolveCaptureUser(request);
    if (!userId) return NextResponse.json({ error: "unauthorized" }, { status: 401 });
    const user = await prisma.user.findUnique({ where: { id: userId }, select: { email: true } });
    if (!user) return NextResponse.json({ error: "unauthorized" }, { status: 401 });
    return NextResponse.json({ ok: true, email: user.email, maxRequestBytes: MAX_MOBILE_REQUEST_BYTES, maxFiles: MAX_MOBILE_FILES }, { headers: { "Cache-Control": "no-store" } });
  } catch (error) { return failure(error); }
}
export async function POST(request: Request) {
  try {
    const userId = await resolveCaptureUser(request);
    if (!userId) return NextResponse.json({ error: "unauthorized" }, { status: 401 });
    const input = await readMobileCapture(request);
    const result = await captureMobile(userId, input);
    after(async () => { try { await syncRecentTodos(); } catch (error) { console.error("mobile capture calendar sync failed", error); } });
    return NextResponse.json(result, { headers: { "Cache-Control": "no-store" } });
  } catch (error) { return failure(error); }
}
