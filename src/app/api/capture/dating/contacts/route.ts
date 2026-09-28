import { NextResponse } from "next/server";
import { resolveCaptureUser } from "@/lib/capture-auth";
import {
  getContactRequests,
  recordContactLookup,
} from "@/lib/dating-contact-lookup";
import { readJSON } from "@/lib/dating-intake/contracts";
import { failure } from "@/lib/dating-intake/http";

export const dynamic = "force-dynamic";
// Only contacts for existing dating profiles leave the Mac, never its directory.
export async function GET(request: Request) {
  const userId = await resolveCaptureUser(request);
  if (!userId)
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  try {
    return NextResponse.json(await getContactRequests(userId), {
      headers: { "Cache-Control": "private, no-store" },
    });
  } catch (error) {
    return failure(error);
  }
}
export async function POST(request: Request) {
  const userId = await resolveCaptureUser(request);
  if (!userId)
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  try {
    return NextResponse.json(
      await recordContactLookup(userId, await readJSON(request, 32768)),
    );
  } catch (error) {
    return failure(error);
  }
}
