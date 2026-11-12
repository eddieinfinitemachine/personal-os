import { NextResponse } from "next/server";
import { getCurrentUserId } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { isPrivateHost } from "@/lib/hosts";
import { getPersonalRecord } from "@/lib/personal-record";

export const dynamic = "force-dynamic";

// GET → the signed-in account's personal record, as the /personal page reads
// it, for the native app. Same gates as the page: private host only, and only
// the account's own row.
export async function GET(request: Request) {
  const headers = { "Cache-Control": "private, no-store" };
  const userId = await getCurrentUserId(request);
  if (!userId) return NextResponse.json({ error: "unauthorized" }, { status: 401, headers });
  if (!isPrivateHost(request.headers.get("host"))) {
    return NextResponse.json({ error: "not found" }, { status: 404, headers });
  }
  const record = await getPersonalRecord(prisma, userId);
  if (!record) return NextResponse.json({ error: "no personal record" }, { status: 404, headers });
  return NextResponse.json({ record }, { headers });
}
