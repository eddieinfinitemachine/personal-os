import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { sendPushToUser } from "@/lib/push";

export const dynamic = "force-dynamic";
export const maxDuration = 60;

// Morning digest push (one per user with subscribed devices): todos due
// today plus snoozes resurfacing today. Alerts only — nothing is created
// or modified. Scheduled daily in vercel.json.

function etDayWindow(): { start: Date; end: Date } {
  // The app's todos carry date-level intent; anchor "today" to US Eastern.
  const nowEt = new Date(
    new Date().toLocaleString("en-US", { timeZone: "America/New_York" })
  );
  const offsetMs = Date.now() - nowEt.getTime();
  const startEt = new Date(nowEt);
  startEt.setHours(0, 0, 0, 0);
  const endEt = new Date(nowEt);
  endEt.setHours(23, 59, 59, 999);
  return {
    start: new Date(startEt.getTime() + offsetMs),
    end: new Date(endEt.getTime() + offsetMs),
  };
}

export async function GET(request: Request) {
  const secret = process.env.CRON_SECRET;
  if (secret && request.headers.get("authorization") !== `Bearer ${secret}`) {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }

  const { start, end } = etDayWindow();

  // Only users who actually enabled push.
  const subscribedUsers = await prisma.pushSubscription.findMany({
    distinct: ["userId"],
    select: { userId: true },
  });

  const results: Record<string, number> = {};
  for (const { userId } of subscribedUsers) {
    const [due, resurfaced] = await Promise.all([
      prisma.todo.findMany({
        where: {
          userId,
          completedAt: null,
          parentId: null,
          dueDate: { gte: start, lte: end },
        },
        select: { title: true },
        take: 10,
      }),
      prisma.todo.findMany({
        where: {
          userId,
          completedAt: null,
          parentId: null,
          snoozedUntil: { gte: start, lte: end },
        },
        select: { title: true },
        take: 10,
      }),
    ]);
    const total = due.length + resurfaced.length;
    if (total === 0) continue;

    const parts: string[] = [];
    if (due.length) {
      parts.push(
        `Due: ${due.map((t) => t.title).slice(0, 4).join(" · ")}${due.length > 4 ? ` +${due.length - 4}` : ""}`
      );
    }
    if (resurfaced.length) {
      parts.push(
        `Back: ${resurfaced.map((t) => t.title).slice(0, 3).join(" · ")}${resurfaced.length > 3 ? ` +${resurfaced.length - 3}` : ""}`
      );
    }
    results[userId] = await sendPushToUser(userId, {
      title: total === 1 ? "1 thing today" : `${total} things today`,
      body: parts.join("\n"),
      url: "/",
      tag: "due-digest",
    });
  }
  return NextResponse.json({ ok: true, pushed: results });
}
