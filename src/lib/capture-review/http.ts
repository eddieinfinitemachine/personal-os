import { NextResponse } from "next/server";
import { CaptureReviewError } from "./types";
export function reviewFailure(error: unknown) {
  if (error instanceof CaptureReviewError) return NextResponse.json({ error: error.message }, { status: error.status, headers: { "Cache-Control": "no-store" } });
  if (error && typeof error === "object" && "code" in error && ["P2034", "P2002"].includes(String(error.code))) return NextResponse.json({ error: "This item changed during the update. Refresh it and try again." }, { status: 409 });
  console.error("capture review failed", error);
  return NextResponse.json({ error: "Couldn't update this capture. Please try again." }, { status: 500 });
}
export async function reviewJson(request: Request): Promise<Record<string, unknown>> {
  const reader = request.body?.getReader();
  if (!reader) throw new CaptureReviewError(400, "A JSON request is required.");
  const parts: Uint8Array[] = []; let size = 0;
  try {
    for (;;) { const chunk = await reader.read(); if (chunk.done) break; size += chunk.value.byteLength; if (size > 500_000) { await reader.cancel(); throw new CaptureReviewError(413, "This correction is too large."); } parts.push(chunk.value); }
  } finally { reader.releaseLock(); }
  let value: unknown;
  try { value = JSON.parse(Buffer.concat(parts).toString("utf8")); } catch { throw new CaptureReviewError(400, "Invalid JSON."); }
  if (!value || typeof value !== "object" || Array.isArray(value)) throw new CaptureReviewError(400, "Invalid request.");
  return value as Record<string, unknown>;
}
