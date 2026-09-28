import { NextResponse } from "next/server";
import { getCurrentUserId } from "@/lib/auth";
import { listReview } from "@/lib/dating-intake/review";
import { failure } from "@/lib/dating-intake/http";
export async function GET(request: Request) {
  try {
    const id = await getCurrentUserId(request);
    if (!id)
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    return NextResponse.json(await listReview(id), {
      headers: { "Cache-Control": "no-store" },
    });
  } catch (e) {
    return failure(e);
  }
}
