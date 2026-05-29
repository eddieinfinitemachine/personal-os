"use client";

import Link from "next/link";
import { ChevronLeft, ChevronRight } from "lucide-react";
import { palette } from "@/lib/lists";
import { cn, formatCalendarDate } from "@/lib/utils";

type Event = {
  id: string;
  title: string;
  dueDate: string;
  listColor: string;
  listName: string;
  projectId?: string | null;
  projectName: string | null;
};

type Upcoming = {
  id: string;
  title: string;
  dueDate: string;
  listColor: string;
  listName: string;
  projectName: string | null;
};

const MONTH_NAMES = [
  "January","February","March","April","May","June",
  "July","August","September","October","November","December",
];

function pad(n: number) {
  return n < 10 ? `0${n}` : `${n}`;
}

export function CalendarView({
  year,
  month,
  events,
  upcoming,
}: {
  year: number;
  month: number;
  events: Event[];
  upcoming: Upcoming[];
}) {
  const first = new Date(year, month, 1);
  const startWeekday = first.getDay(); // 0 = Sun
  const daysInMonth = new Date(year, month + 1, 0).getDate();

  const grid: (number | null)[] = [];
  for (let i = 0; i < startWeekday; i++) grid.push(null);
  for (let d = 1; d <= daysInMonth; d++) grid.push(d);
  while (grid.length % 7 !== 0) grid.push(null);

  const eventsByDay = new Map<number, Event[]>();
  for (const ev of events) {
    // dueDate is anchored at UTC midnight — read its UTC calendar day so it
    // lands on the cell the user actually picked, not one day earlier.
    const d = new Date(ev.dueDate);
    if (d.getUTCFullYear() === year && d.getUTCMonth() === month) {
      const day = d.getUTCDate();
      const arr = eventsByDay.get(day) ?? [];
      arr.push(ev);
      eventsByDay.set(day, arr);
    }
  }

  const today = new Date();
  const isThisMonth =
    today.getFullYear() === year && today.getMonth() === month;
  const todayDate = today.getDate();

  const prevMonth = month === 0 ? `${year - 1}-12` : `${year}-${pad(month)}`;
  const nextMonth =
    month === 11 ? `${year + 1}-01` : `${year}-${pad(month + 2)}`;
  const thisMonthLabel = `${MONTH_NAMES[month]} ${year}`;

  // Days that have events, sorted ascending — used by the mobile agenda view.
  const agendaDays = [...eventsByDay.entries()]
    .sort(([a], [b]) => a - b)
    .map(([day, evs]) => ({ day, evs }));

  return (
    <div className="grid grid-cols-1 lg:grid-cols-[1fr_280px] gap-6">
      <div>
        {/* Mobile agenda view — replaces the cramped 7-col grid */}
        <div className="md:hidden">
          <div className="flex items-center justify-between mb-3">
            <div className="text-lg font-semibold">{thisMonthLabel}</div>
            <div className="flex items-center gap-1">
              <Link
                href={`/calendar?month=${prevMonth}`}
                className="grid place-items-center size-9 rounded-md hover:bg-[var(--color-accent)]"
                aria-label="Previous month"
              >
                <ChevronLeft className="size-4" />
              </Link>
              <Link
                href="/calendar"
                className="rounded-md px-2.5 py-1.5 text-xs hover:bg-[var(--color-accent)]"
              >
                Today
              </Link>
              <Link
                href={`/calendar?month=${nextMonth}`}
                className="grid place-items-center size-9 rounded-md hover:bg-[var(--color-accent)]"
                aria-label="Next month"
              >
                <ChevronRight className="size-4" />
              </Link>
            </div>
          </div>

          {agendaDays.length === 0 ? (
            <div className="rounded-xl border border-dashed border-[var(--color-border)] p-8 text-center text-sm text-[var(--color-muted-foreground)]">
              Nothing scheduled for {MONTH_NAMES[month]}.
            </div>
          ) : (
            <ol className="space-y-3">
              {agendaDays.map(({ day, evs }) => {
                const dateObj = new Date(year, month, day);
                const isToday = isThisMonth && day === todayDate;
                return (
                  <li
                    key={day}
                    className="rounded-xl border border-[var(--color-border)] bg-[var(--color-card)]"
                  >
                    <div
                      className={cn(
                        "flex items-baseline gap-2 px-3 pt-3 pb-1.5 text-xs font-semibold uppercase tracking-wider",
                        isToday ? "text-[var(--color-foreground)]" : "text-[var(--color-muted-foreground)]"
                      )}
                    >
                      <span className="text-base font-bold tabular-nums">
                        {day}
                      </span>
                      <span>
                        {dateObj.toLocaleDateString(undefined, {
                          weekday: "short",
                        })}
                      </span>
                      {isToday ? (
                        <span className="ml-auto rounded-full bg-[var(--color-foreground)] text-[var(--color-background)] px-2 py-0.5 text-[10px] uppercase tracking-wider">
                          Today
                        </span>
                      ) : null}
                    </div>
                    <ul className="divide-y divide-[var(--color-border)]/40">
                      {evs.map((ev) => {
                        const p = palette(ev.listColor);
                        const inner = (
                          <div className="flex items-center gap-2 px-3 py-2.5 min-h-[44px]">
                            <span
                              className={cn(
                                "size-2 rounded-full shrink-0",
                                p.dot
                              )}
                            />
                            <div className="flex-1 min-w-0">
                              <div className="text-sm truncate">
                                {ev.title}
                              </div>
                              {ev.projectName ? (
                                <div className="text-[11px] text-[var(--color-muted-foreground)] truncate">
                                  {ev.projectName} · {ev.listName}
                                </div>
                              ) : (
                                <div className="text-[11px] text-[var(--color-muted-foreground)] truncate">
                                  {ev.listName}
                                </div>
                              )}
                            </div>
                          </div>
                        );
                        return (
                          <li key={ev.id}>
                            {ev.projectId ? (
                              <Link href={`/projects/${ev.projectId}?tab=tasks`}>
                                {inner}
                              </Link>
                            ) : (
                              inner
                            )}
                          </li>
                        );
                      })}
                    </ul>
                  </li>
                );
              })}
            </ol>
          )}
        </div>

        <div className="hidden md:block">
        <div className="flex items-center justify-between mb-3">
          <div className="text-lg font-semibold">{thisMonthLabel}</div>
          <div className="flex items-center gap-1">
            <Link
              href={`/calendar?month=${prevMonth}`}
              className="rounded p-1.5 hover:bg-[var(--color-accent)]"
              title="Previous month"
            >
              <ChevronLeft className="size-4" />
            </Link>
            <Link
              href="/calendar"
              className="rounded px-2 py-1 text-xs hover:bg-[var(--color-accent)]"
            >
              Today
            </Link>
            <Link
              href={`/calendar?month=${nextMonth}`}
              className="rounded p-1.5 hover:bg-[var(--color-accent)]"
              title="Next month"
            >
              <ChevronRight className="size-4" />
            </Link>
          </div>
        </div>

        <div className="grid grid-cols-7 gap-px bg-[var(--color-border)] rounded-lg overflow-hidden">
          {["Sun","Mon","Tue","Wed","Thu","Fri","Sat"].map((d) => (
            <div
              key={d}
              className="bg-[var(--color-card)] px-2 py-1.5 text-[11px] font-semibold uppercase tracking-wider text-[var(--color-muted-foreground)]"
            >
              {d}
            </div>
          ))}
          {grid.map((day, i) => {
            const dayEvents = day ? eventsByDay.get(day) ?? [] : [];
            const isToday = isThisMonth && day === todayDate;
            return (
              <div
                key={i}
                className={cn(
                  "bg-[var(--color-card)] min-h-[96px] px-2 py-1.5 text-xs",
                  !day && "bg-[var(--color-muted)]/30"
                )}
              >
                {day ? (
                  <>
                    <div
                      className={cn(
                        "text-[11px] font-medium tabular-nums mb-1",
                        isToday
                          ? "inline-grid place-items-center size-5 rounded-full bg-[var(--color-foreground)] text-[var(--color-background)]"
                          : "text-[var(--color-muted-foreground)]"
                      )}
                    >
                      {day}
                    </div>
                    <ul className="space-y-0.5">
                      {dayEvents.slice(0, 4).map((ev) => {
                        const p = palette(ev.listColor);
                        const content = (
                          <>
                            <span
                              className={cn(
                                "inline-block size-1.5 rounded-full mr-1.5 align-middle",
                                p.dot
                              )}
                            />
                            <span className="truncate align-middle">
                              {ev.title}
                              {ev.projectName ? (
                                <span className="text-[var(--color-muted-foreground)]">
                                  {" "}· {ev.projectName}
                                </span>
                              ) : null}
                            </span>
                          </>
                        );
                        return (
                          <li
                            key={ev.id}
                            className="rounded px-1 py-0.5 hover:bg-[var(--color-accent)]/60 truncate"
                            title={`${ev.title}${ev.projectName ? ` · ${ev.projectName}` : ""} · ${ev.listName}`}
                          >
                            {ev.projectId ? (
                              <Link
                                href={`/projects/${ev.projectId}?tab=tasks`}
                                className="flex items-center"
                              >
                                {content}
                              </Link>
                            ) : (
                              <span className="flex items-center">
                                {content}
                              </span>
                            )}
                          </li>
                        );
                      })}
                      {dayEvents.length > 4 ? (
                        <li className="text-[10px] text-[var(--color-muted-foreground)] px-1">
                          +{dayEvents.length - 4} more
                        </li>
                      ) : null}
                    </ul>
                  </>
                ) : null}
              </div>
            );
          })}
        </div>
        </div>
      </div>

      <aside className="hidden md:block rounded-2xl border border-[var(--color-border)] bg-[var(--color-card)] p-4">
        <h3 className="font-semibold mb-3">Upcoming · 14 days</h3>
        {upcoming.length === 0 ? (
          <div className="text-sm text-[var(--color-muted-foreground)]">
            Nothing scheduled.
          </div>
        ) : (
          <ul className="space-y-2.5">
            {upcoming.map((ev) => {
              const p = palette(ev.listColor);
              return (
                <li key={ev.id} className="flex items-start gap-2 text-sm">
                  <span
                    className={cn(
                      "mt-1.5 size-2 shrink-0 rounded-full",
                      p.dot
                    )}
                  />
                  <div className="min-w-0 flex-1">
                    <div className="truncate">{ev.title}</div>
                    <div className="text-[11px] text-[var(--color-muted-foreground)]">
                      {formatCalendarDate(ev.dueDate, {
                        weekday: "short",
                        month: "short",
                        day: "numeric",
                      })}
                      {ev.projectName ? ` · ${ev.projectName}` : ""}
                    </div>
                  </div>
                </li>
              );
            })}
          </ul>
        )}
      </aside>
    </div>
  );
}
