import { NextResponse } from "next/server";
import { resolveCaptureUser } from "@/lib/capture-auth";
import { IntakeError, readJSON } from "@/lib/dating-intake/contracts";
import { captureCallSheet, getCaptureConfig } from "@/lib/call-sheet/capture";
import { callSheetFailure } from "@/lib/call-sheet/http";
export const dynamic = "force-dynamic";
export const maxDuration = 60;
const headers = { "Cache-Control": "private, no-store" };
export async function GET(request: Request) {
  try {
    const userId = await resolveCaptureUser(request);
    if (!userId) throw new IntakeError("unauthorized", 401);
    return NextResponse.json(await getCaptureConfig(userId), { headers });
  } catch (error) {
    return callSheetFailure(error);
  }
}
export async function POST(request: Request) {
  try {
    const userId = await resolveCaptureUser(request);
    if (!userId) throw new IntakeError("unauthorized", 401);
    return NextResponse.json(
      await captureCallSheet(userId, await readJSON(request, 160_000)),
      { headers },
    );
  } catch (error) {
    return callSheetFailure(error);
  }
}
