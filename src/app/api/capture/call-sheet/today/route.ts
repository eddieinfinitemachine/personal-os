import { NextResponse } from "next/server";
import { resolveCaptureUser } from "@/lib/capture-auth";
import { IntakeError } from "@/lib/dating-intake/contracts";
import { getCallSheet } from "@/lib/call-sheet/service";
import { callSheetFailure } from "@/lib/call-sheet/http";
import { appUrl } from "@/lib/gcal";
import type { CallSheetResponse } from "@/lib/call-sheet/types";
export const dynamic = "force-dynamic";
const headers = { "Cache-Control": "private, no-store" };

// Today's call sheet for native clients (Fork Calendar), behind the capture
// bearer. Same service as GET /api/call-sheet, mapped into a small fixed
// contract instead of the web UI's full shape:
//   { date: "YYYY-MM-DD",
//     items: [{ personId, name, reason: string | null, done, url }] }
export async function GET(request: Request) {
  try {
    const userId = await resolveCaptureUser(request);
    if (!userId) throw new IntakeError("unauthorized", 401);
    return NextResponse.json(toFeed(await getCallSheet(userId)), { headers });
  } catch (error) {
    return callSheetFailure(error);
  }
}

function toFeed(sheet: CallSheetResponse) {
  // The web sheet shows "Birthdays today" above the regular list; keep that
  // order (each group in service order).
  const entries = [
    ...sheet.entries.filter((entry) => entry.section === "birthday"),
    ...sheet.entries.filter((entry) => entry.section !== "birthday"),
  ];
  return {
    date: sheet.day.localDate,
    items: entries.map((entry) => ({
      personId: entry.personId,
      name: entry.name,
      reason: entry.reason || null,
      // "done" (checked in) and "contacted" (recent message seen) both count
      // as checked in on the web sheet.
      done: entry.status !== "pending",
      // Same profile link as the web call sheet row.
      url: new URL(
        `/friends?person=${encodeURIComponent(entry.personId)}`,
        appUrl(),
      ).toString(),
    })),
  };
}
