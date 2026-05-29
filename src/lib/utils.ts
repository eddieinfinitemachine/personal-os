import { clsx, type ClassValue } from "clsx";
import { twMerge } from "tailwind-merge";

export function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs));
}

// --- Calendar-date helpers -------------------------------------------------
// Due dates / trip dates come from `<input type="date">` (a `YYYY-MM-DD`
// string) and are stored as `new Date("YYYY-MM-DD")`, i.e. anchored at UTC
// midnight. To avoid the classic off-by-one (a "Jun 16" date rendering as
// "Jun 15" in timezones west of UTC), format and compare them in UTC.

/** Format a date-only value for display, reading its UTC calendar day. */
export function formatCalendarDate(
  d: Date | string,
  opts: Intl.DateTimeFormatOptions = { month: "short", day: "numeric" },
): string {
  const date = typeof d === "string" ? new Date(d) : d;
  return date.toLocaleDateString(undefined, { ...opts, timeZone: "UTC" });
}

/** `YYYY-MM-DD` for an `<input type="date">`, reading the UTC calendar day. */
export function toDateInputValue(d: Date | string | null | undefined): string {
  if (!d) return "";
  const date = typeof d === "string" ? new Date(d) : d;
  if (Number.isNaN(date.getTime())) return "";
  return date.toISOString().slice(0, 10);
}

/** True if a date-only due date is before today's local calendar date. */
export function isCalendarDateOverdue(d: Date | string): boolean {
  const date = typeof d === "string" ? new Date(d) : d;
  if (Number.isNaN(date.getTime())) return false;
  const dueDay = Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), date.getUTCDate());
  const now = new Date();
  const today = Date.UTC(now.getFullYear(), now.getMonth(), now.getDate());
  return dueDay < today;
}
