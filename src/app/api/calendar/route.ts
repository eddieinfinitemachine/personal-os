import { NextResponse } from "next/server";
import { getCurrentUserId } from "@/lib/auth";
import { getCalendarItems, getUpcomingItems, groupByDay, parseCalendarQuery } from "@/lib/calendar";

export const dynamic = "force-dynamic";

const headers = { "Cache-Control": "private, no-store" };

/**
 * The /calendar page's data for the native app, from the same reads
 * (src/lib/calendar.ts). `?from=&to=` (YYYY-MM-DD, inclusive, at most 93
 * days) defaults to the page's month on the server's clock. `upcoming` is
 * the page's Upcoming panel, computed only when the client sends its local
 * `?today=`, so it never starts on the server's (UTC) day.
 */
export async function GET(request: Request) {
  const userId = await getCurrentUserId(request);
  if (!userId) return NextResponse.json({ error: "unauthorized" }, { status: 401, headers });

  const query = parseCalendarQuery(new URL(request.url).searchParams);
  if ("error" in query) return NextResponse.json({ error: query.error }, { status: 400, headers });

  const [items, upcoming] = await Promise.all([
    getCalendarItems(userId, query.from, query.to),
    query.today ? getUpcomingItems(userId, query.today) : null,
  ]);
  return NextResponse.json(
    { from: query.from, to: query.to, today: query.today, days: groupByDay(items), upcoming },
    { headers },
  );
}
