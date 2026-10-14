// Person.birthday is stored as UTC midnight of the calendar date (the people
// API, the CRM form, smart capture and the Contacts sync all write
// `new Date("YYYY-MM-DD")`), so the month and day are always read in UTC.

/** Apple Contacts' year for a birthday saved without one. A leap year, so Feb 29 survives. */
export const YEARLESS_BIRTHDAY_YEAR = 1604;

const pad = (n: number) => String(n).padStart(2, "0");
const leap = (year: number) =>
  (year % 4 === 0 && year % 100 !== 0) || year % 400 === 0;

/** A real calendar date written as YYYY-MM-DD, from 1604 (year unknown) to 2100,
 * as the UTC-midnight Date that Person.birthday stores; otherwise null. */
export function parseBirthday(value: unknown): Date | null {
  if (typeof value !== "string") return null;
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(value.trim());
  if (!match) return null;
  const year = Number(match[1]);
  if (year < YEARLESS_BIRTHDAY_YEAR || year > 2100) return null;
  const date = new Date(`${match[0]}T00:00:00.000Z`);
  return !Number.isNaN(date.getTime()) &&
    date.toISOString().slice(0, 10) === match[0]
    ? date
    : null;
}

/** The next time the birthday falls on or after `today` (a local YYYY-MM-DD),
 * as YYYY-MM-DD. A Feb 29 birthday is marked on Feb 28 in other years. */
export function nextBirthday(birthday: Date, today: string): string {
  const month = birthday.getUTCMonth() + 1;
  const day = birthday.getUTCDate();
  const year = Number(today.slice(0, 4));
  const on = (y: number) =>
    `${y}-${pad(month)}-${pad(month === 2 && day === 29 && !leap(y) ? 28 : day)}`;
  return on(year) >= today ? on(year) : on(year + 1);
}

/** "1990-03-05", or "03-05 (year unknown)" for a yearless birthday. */
export function formatBirthday(birthday: Date): string {
  const date = birthday.toISOString().slice(0, 10);
  return birthday.getUTCFullYear() === YEARLESS_BIRTHDAY_YEAR
    ? `${date.slice(5)} (year unknown)`
    : date;
}
