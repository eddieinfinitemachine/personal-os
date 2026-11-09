// The calendar's data, read by both the /calendar page and GET /api/calendar
// so the web and the native app can't drift.
//
// What's on it: open todos (completedAt null) with a due date, on any list
// the caller can access (they own it or are a ListMember), dated subtasks
// included as their own items. As on Home, a todo snoozed into the future
// stays hidden until the snooze passes, and each item carries the list color
// the caller sees (a member's own color on a shared list).
//
// A due date is a calendar day stored as UTC midnight, so days are compared
// and grouped as UTC "YYYY-MM-DD" strings.

import type { Prisma } from "@prisma/client";
import { prisma } from "@/lib/prisma";
import { listAccessWhere, listColorFor } from "@/lib/list-access";
import { isDateOnly, toDateInputValue } from "@/lib/utils";

/** Longest range GET /api/calendar serves, counting both ends (three 31-day months). */
export const MAX_RANGE_DAYS = 93;
/** "Upcoming" covers today and the 13 days after it. */
export const UPCOMING_DAYS = 14;
/** The page's Upcoming panel shows at most this many items. */
export const UPCOMING_LIMIT = 30;

export type CalendarItem = {
  /** The todo id. */
  id: string;
  title: string;
  /** The calendar day, YYYY-MM-DD. */
  dueDate: string;
  /** Always null: the calendar shows open todos only. */
  completedAt: null;
  listId: string;
  listName: string;
  /** The color the caller sees for the list (see listColorFor). */
  listColor: string;
  projectId: string | null;
  projectName: string | null;
  /** Set when the item is a subtask. */
  parentId: string | null;
};

export type CalendarDay = { date: string; items: CalendarItem[] };

const DAY_MS = 86_400_000;
const pad = (n: number) => String(n).padStart(2, "0");

/** UTC midnight of a YYYY-MM-DD day, which is how due dates are stored. */
export function dayStart(day: string): Date {
  return new Date(`${day}T00:00:00.000Z`);
}

export function addDays(day: string, days: number): string {
  return toDateInputValue(new Date(dayStart(day).getTime() + days * DAY_MS));
}

/** Days from `from` to `to`, counting both ends. */
export function rangeDays(from: string, to: string): number {
  return Math.round((dayStart(to).getTime() - dayStart(from).getTime()) / DAY_MS) + 1;
}

/**
 * Today on the server's own clock, as the page has always used it (Vercel runs
 * in UTC, so in the US evening this is already tomorrow). The API prefers the
 * client's `?today=`.
 */
export function serverToday(now = new Date()): string {
  return `${now.getFullYear()}-${pad(now.getMonth() + 1)}-${pad(now.getDate())}`;
}

/** The page's `?month=YYYY-MM` (0-based month back), else the server's current month. */
export function calendarMonth(raw: string | undefined, now = new Date()): { year: number; month: number } {
  if (raw && /^\d{4}-(0[1-9]|1[0-2])$/.test(raw)) {
    const [year, month] = raw.split("-").map(Number);
    return { year, month: month - 1 };
  }
  return { year: now.getFullYear(), month: now.getMonth() };
}

/** First and last day of a month (0-based), both inclusive. */
export function monthRange(year: number, month: number): { from: string; to: string } {
  const lastDay = new Date(Date.UTC(year, month + 1, 0)).getUTCDate();
  return { from: `${year}-${pad(month + 1)}-01`, to: `${year}-${pad(month + 1)}-${pad(lastDay)}` };
}

export type CalendarQuery = { from: string; to: string; today: string | null };

/**
 * GET /api/calendar's query: `from` and `to` (YYYY-MM-DD, inclusive, together
 * or not at all; at most MAX_RANGE_DAYS) and an optional `today`. Without a
 * range it's the page's default month.
 */
export function parseCalendarQuery(params: URLSearchParams, now = new Date()): CalendarQuery | { error: string } {
  const from = params.get("from");
  const to = params.get("to");
  const today = params.get("today");
  if (today !== null && !isDateOnly(today)) return { error: "today must be YYYY-MM-DD" };
  if (from === null && to === null) {
    const { year, month } = calendarMonth(undefined, now);
    return { ...monthRange(year, month), today };
  }
  if (!isDateOnly(from) || !isDateOnly(to)) return { error: "from and to must both be YYYY-MM-DD" };
  if (from > to) return { error: "from must be on or before to" };
  if (rangeDays(from, to) > MAX_RANGE_DAYS) {
    return { error: `the range can't be longer than ${MAX_RANGE_DAYS} days` };
  }
  return { from, to, today };
}

/** Open, dated, not snoozed, on a list the caller can access, due in [from, until). */
function calendarWhere(userId: string, from: string, until: string, now: Date): Prisma.TodoWhereInput {
  return {
    dueDate: { gte: dayStart(from), lt: dayStart(until) },
    completedAt: null,
    list: listAccessWhere(userId),
    OR: [{ snoozedUntil: null }, { snoozedUntil: { lte: now } }],
  };
}

const orderBy: Prisma.TodoOrderByWithRelationInput[] = [{ dueDate: "asc" }, { position: "asc" }];

function itemSelect(userId: string) {
  return {
    id: true,
    title: true,
    dueDate: true,
    projectId: true,
    parentId: true,
    list: {
      select: {
        id: true,
        name: true,
        color: true,
        userId: true,
        members: { where: { userId }, select: { userId: true, color: true } },
      },
    },
    project: { select: { name: true } },
  } satisfies Prisma.TodoSelect;
}

type ItemRow = Prisma.TodoGetPayload<{ select: ReturnType<typeof itemSelect> }>;

function toItem(row: ItemRow, userId: string): CalendarItem {
  return {
    id: row.id,
    title: row.title,
    // The where clause requires a due date.
    dueDate: toDateInputValue(row.dueDate!),
    completedAt: null,
    listId: row.list.id,
    listName: row.list.name,
    listColor: listColorFor(row.list, userId),
    projectId: row.projectId,
    projectName: row.project?.name ?? null,
    parentId: row.parentId,
  };
}

/** Items due from `from` through `to` (both YYYY-MM-DD, inclusive), by due date, then manual order. */
export async function getCalendarItems(userId: string, from: string, to: string, now = new Date()): Promise<CalendarItem[]> {
  const rows = await prisma.todo.findMany({
    where: calendarWhere(userId, from, addDays(to, 1), now),
    orderBy,
    select: itemSelect(userId),
  });
  return rows.map((r) => toItem(r, userId));
}

/** The Upcoming panel: items due from `today` through 13 days later, first UPCOMING_LIMIT only. */
export async function getUpcomingItems(userId: string, today: string, now = new Date()): Promise<CalendarItem[]> {
  const rows = await prisma.todo.findMany({
    where: calendarWhere(userId, today, addDays(today, UPCOMING_DAYS), now),
    orderBy,
    select: itemSelect(userId),
    take: UPCOMING_LIMIT,
  });
  return rows.map((r) => toItem(r, userId));
}

/** Days that have items, ascending, keeping the query's order within a day (as the page's grid and agenda do). */
export function groupByDay(items: CalendarItem[]): CalendarDay[] {
  const days = new Map<string, CalendarItem[]>();
  for (const item of items) {
    const day = days.get(item.dueDate);
    if (day) day.push(item);
    else days.set(item.dueDate, [item]);
  }
  return [...days.keys()].sort().map((date) => ({ date, items: days.get(date)! }));
}
