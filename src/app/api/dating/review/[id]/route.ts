import { after, NextResponse } from "next/server";
import { getCurrentUserId } from "@/lib/auth";
import { reviewCandidate } from "@/lib/dating-intake/review";
import { readJSON } from "@/lib/dating-intake/contracts";
import { refreshDatingInsights } from "@/lib/dating-insights";
import { failure } from "@/lib/dating-intake/http";
export const maxDuration = 120;
export async function POST(
  request: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  try {
    const owner = await getCurrentUserId(request);
    if (!owner)
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    const { id } = await params;
    const result = await reviewCandidate(
      owner,
      id,
      await readJSON(request, 12000),
    );
    if (result.personId)
      after(async () => {
        try {
          await refreshDatingInsights(owner, result.personId!);
        } catch {
          console.error("Dating summary refresh failed");
        }
      });
    return NextResponse.json(result);
  } catch (e) {
    return failure(e);
  }
}
