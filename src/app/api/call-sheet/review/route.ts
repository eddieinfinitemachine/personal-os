import { NextResponse } from "next/server";
import { getCurrentUserId } from "@/lib/auth";
import { IntakeError, readJSON } from "@/lib/dating-intake/contracts";
import {
  decideCallSheetReview,
  getCallSheetReview,
} from "@/lib/call-sheet/service";
import { callSheetFailure } from "@/lib/call-sheet/http";
export const dynamic = "force-dynamic";
const headers = { "Cache-Control": "private, no-store" };
export async function GET(request: Request) {
  try {
    const userId = await getCurrentUserId(request);
    if (!userId) throw new IntakeError("unauthorized", 401);
    return NextResponse.json(await getCallSheetReview(userId), { headers });
  } catch (error) {
    return callSheetFailure(error);
  }
}
export async function POST(request: Request) {
  try {
    const userId = await getCurrentUserId(request);
    if (!userId) throw new IntakeError("unauthorized", 401);
    return NextResponse.json(
      await decideCallSheetReview(userId, await readJSON(request, 4096)),
      { headers },
    );
  } catch (error) {
    return callSheetFailure(error);
  }
}
