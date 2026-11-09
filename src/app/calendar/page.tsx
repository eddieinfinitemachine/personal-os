import { calendarMonth, getCalendarItems, getUpcomingItems, monthRange, serverToday } from "@/lib/calendar";
import { CalendarView } from "@/components/calendar-view";
import { getSession } from "@/lib/auth";
import { redirect } from "next/navigation";

export const dynamic = "force-dynamic";

export default async function CalendarPage({
  searchParams,
}: {
  searchParams: Promise<{ month?: string }>;
}) {
  const session = await getSession();
  if (!session) redirect("/login");
  const userId = session.userId;

  // The same reads as GET /api/calendar (src/lib/calendar.ts).
  const { month: rawMonth } = await searchParams;
  const { year, month } = calendarMonth(rawMonth);
  const { from, to } = monthRange(year, month);
  const [events, upcoming] = await Promise.all([
    getCalendarItems(userId, from, to),
    getUpcomingItems(userId, serverToday()),
  ]);

  return (
    <div className="px-4 py-4 sm:px-6 md:px-8 md:py-6">
      <header className="mb-6">
        <h1 className="text-large-title font-bold">Calendar</h1>
        <p className="text-sm text-[var(--color-muted-foreground)] mt-1">
          Everything with a due date.
        </p>
      </header>
      <CalendarView
        year={year}
        month={month}
        events={events}
        upcoming={upcoming}
      />
    </div>
  );
}
