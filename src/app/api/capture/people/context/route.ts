import { NextResponse } from "next/server";
import { resolveCaptureUser } from "@/lib/capture-auth";
import { IntakeError, readJSON } from "@/lib/dating-intake/contracts";
import { contextTargets, parseContextCapture } from "@/lib/person-context/capture";
import { refreshPersonContext } from "@/lib/person-context/generate";
import { CONTEXT_LIMITS } from "@/lib/person-context/types";

export const dynamic = "force-dynamic";
export const maxDuration = 120;
const headers = { "Cache-Control": "private, no-store" };

// Raw threads live only in this request: never persisted, never logged.
function failure(error: unknown) {
  if (error instanceof IntakeError) return NextResponse.json({ error: error.message }, { status: error.status, headers });
  console.error("person context capture failed");
  return NextResponse.json({ error: "Could not refresh context; try again" }, { status: 502, headers });
}

/** Targets for the Mac: active people and handles it must not read. */
export async function GET(request: Request) {
  try {
    const userId = await resolveCaptureUser(request);
    if (!userId) throw new IntakeError("unauthorized", 401);
    return NextResponse.json(await contextTargets(userId), { headers });
  } catch (error) {
    return failure(error);
  }
}

/** One person's bounded 1:1 threads → refreshed AI context. */
export async function POST(request: Request) {
  try {
    const userId = await resolveCaptureUser(request);
    if (!userId) throw new IntakeError("unauthorized", 401);
    const { personId, threads, force } = parseContextCapture(await readJSON(request, CONTEXT_LIMITS.maxBodyBytes));
    return NextResponse.json(await refreshPersonContext(userId, personId, { threads, force }), { headers });
  } catch (error) {
    return failure(error);
  }
}
