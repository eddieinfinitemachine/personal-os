import { prisma } from "@/lib/prisma";
import { CalendarView } from "@/components/calendar-view";

export const dynamic = "force-dynamic";

export default async function CalendarPage({
  searchParams,
}: {
  searchParams: Promise<{ month?: string }>;
}) {
  const { month: rawMonth } = await searchParams;
  // Month is YYYY-MM. Default to current month.
  const today = new Date();
  let year = today.getFullYear();
  let month = today.getMonth(); // 0-indexed
  if (rawMonth && /^\d{4}-\d{2}$/.test(rawMonth)) {
    const [y, m] = rawMonth.split("-").map(Number);
    year = y;
    month = m - 1;
  }
  const start = new Date(Date.UTC(year, month, 1));
  const end = new Date(Date.UTC(year, month + 1, 1));

  const todos = await prisma.todo.findMany({
    where: {
      dueDate: { gte: start, lt: end },
      completedAt: null,
    },
    orderBy: [{ dueDate: "asc" }, { position: "asc" }],
    include: {
      list: { select: { id: true, name: true, color: true } },
      project: { select: { id: true, name: true } },
    },
  });

  const events = todos.map((t) => ({
    id: t.id,
    title: t.title,
    dueDate: t.dueDate!.toISOString(),
    listColor: t.list.color,
    listName: t.list.name,
    projectId: t.projectId,
    projectName: t.project?.name ?? null,
  }));

  // Also pull a small "Upcoming" list for the next 14 days outside the visible month.
  const upcomingStart = new Date();
  upcomingStart.setHours(0, 0, 0, 0);
  const upcomingEnd = new Date(upcomingStart);
  upcomingEnd.setDate(upcomingEnd.getDate() + 14);
  const upcomingTodos = await prisma.todo.findMany({
    where: {
      dueDate: { gte: upcomingStart, lt: upcomingEnd },
      completedAt: null,
    },
    orderBy: [{ dueDate: "asc" }],
    include: {
      list: { select: { color: true, name: true } },
      project: { select: { name: true } },
    },
    take: 30,
  });
  const upcoming = upcomingTodos.map((t) => ({
    id: t.id,
    title: t.title,
    dueDate: t.dueDate!.toISOString(),
    listColor: t.list.color,
    listName: t.list.name,
    projectName: t.project?.name ?? null,
  }));

  return (
    <div className="px-4 py-4 sm:px-6 md:px-8 md:py-6">
      <header className="mb-6">
        <h1 className="text-2xl font-semibold tracking-tight">Calendar</h1>
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
