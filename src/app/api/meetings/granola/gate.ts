import { NextResponse } from "next/server";
import { getCurrentUserId } from "@/lib/auth";
import { isFounderUser } from "@/lib/cron";

/**
 * Shared gate for Granola meeting import: signed in, the founder (the API key
 * is Eddie's personal key), and GRANOLA_API_KEY configured.
 */
export async function granolaImportGate(
  request: Request,
): Promise<{ userId: string } | { response: NextResponse }> {
  const userId = await getCurrentUserId(request);
  if (!userId) return { response: NextResponse.json({ error: "unauthorized" }, { status: 401 }) };
  if (!(await isFounderUser(userId))) {
    return { response: NextResponse.json({ error: "forbidden" }, { status: 403 }) };
  }
  if (!process.env.GRANOLA_API_KEY?.trim()) {
    return { response: NextResponse.json({ error: "GRANOLA_API_KEY not set" }, { status: 503 }) };
  }
  return { userId };
}
