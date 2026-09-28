import { NextResponse } from "next/server";
import { getCurrentUserId } from "@/lib/auth";
import { IntakeError, readJSON } from "@/lib/dating-intake/contracts";
import { updateCallSheetSettings } from "@/lib/call-sheet/service";
import { callSheetFailure } from "@/lib/call-sheet/http";
export const dynamic = "force-dynamic";
export async function POST(request: Request) {
  try {
    const userId = await getCurrentUserId(request);
    if (!userId) throw new IntakeError("unauthorized", 401);
    return NextResponse.json(
      await updateCallSheetSettings(userId, await readJSON(request, 4096)),
      { headers: { "Cache-Control": "private, no-store" } },
    );
  } catch (error) {
    return callSheetFailure(error);
  }
}
