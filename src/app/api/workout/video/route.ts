import { NextResponse } from "next/server";
import { getCurrentUserId } from "@/lib/auth";
import { findExerciseVideo, VIDEO_MAX_NAME } from "@/lib/workout-video";

export const maxDuration = 60;

// One exercise → one YouTube demo. The client asks for each exercise on the
// plan after it arrives and keeps the answer with the plan in localStorage.
export async function GET(request: Request) {
  const userId = await getCurrentUserId(request);
  if (!userId) return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  const url = new URL(request.url);
  const name = (url.searchParams.get("name") ?? "").trim().slice(0, VIDEO_MAX_NAME);
  const equipment = (url.searchParams.get("equipment") ?? "").trim().slice(0, 80);
  if (!name) return NextResponse.json({ error: "name is required" }, { status: 400 });
  try {
    const video = await findExerciseVideo(name, equipment);
    return NextResponse.json({ video }, { headers: { "Cache-Control": "private, max-age=86400" } });
  } catch (error) {
    console.error("[workout/video]", error instanceof Error ? error.message : error);
    return NextResponse.json({ error: "Could not find a video right now." }, { status: 502 });
  }
}
