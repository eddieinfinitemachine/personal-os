// Pure helpers for the project notes pane (components/notes-pane.tsx):
// Apple Notes-style recency groups, row dates, previews, and the focus-mode
// shortcut. Kept framework-free so they're unit-testable.

type Dated = { updatedAt: Date | string };

const DAY_MS = 86_400_000;

// Whole calendar days between two instants in local time. Built from the
// local Y/M/D so DST shifts (23h / 25h days) don't skew the count.
export function calendarDaysBetween(earlier: Date, later: Date): number {
  const a = Date.UTC(earlier.getFullYear(), earlier.getMonth(), earlier.getDate());
  const b = Date.UTC(later.getFullYear(), later.getMonth(), later.getDate());
  return Math.round((b - a) / DAY_MS);
}

// Apple Notes' buckets: Today, Yesterday, Previous 7 Days, Previous 30 Days,
// then month names for the current year and bare years before that.
export function recencyLabel(
  date: Date,
  now: Date,
  locale?: string
): string {
  const days = calendarDaysBetween(date, now);
  if (days <= 0) return "Today";
  if (days === 1) return "Yesterday";
  if (days <= 7) return "Previous 7 Days";
  if (days <= 30) return "Previous 30 Days";
  if (date.getFullYear() === now.getFullYear()) {
    return date.toLocaleDateString(locale, { month: "long" });
  }
  return String(date.getFullYear());
}

// Groups notes (already sorted newest-first) into consecutive recency
// buckets, preserving input order inside each bucket.
export function groupNotesByRecency<T extends Dated>(
  notes: T[],
  now: Date,
  locale?: string
): { label: string; notes: T[] }[] {
  const groups: { label: string; notes: T[] }[] = [];
  for (const n of notes) {
    const label = recencyLabel(new Date(n.updatedAt), now, locale);
    const last = groups[groups.length - 1];
    if (last && last.label === label) last.notes.push(n);
    else groups.push({ label, notes: [n] });
  }
  return groups;
}

// Compact date for a list row: time today, "Yesterday", weekday this week,
// numeric date otherwise (Apple Notes list convention).
export function formatRowDate(date: Date, now: Date, locale?: string): string {
  const days = calendarDaysBetween(date, now);
  if (days <= 0) {
    return date.toLocaleTimeString(locale, { hour: "numeric", minute: "2-digit" });
  }
  if (days === 1) return "Yesterday";
  if (days < 7) return date.toLocaleDateString(locale, { weekday: "long" });
  return date.toLocaleDateString(locale, {
    month: "numeric",
    day: "numeric",
    year: "2-digit",
  });
}

// Full timestamp shown above the editor ("September 26, 2026 at 3:04 PM").
export function formatEditedAt(date: Date, locale?: string): string {
  return date.toLocaleString(locale, {
    dateStyle: "long",
    timeStyle: "short",
  });
}

// First non-empty line of the body, trimmed — the row's secondary text.
export function notePreview(body: string): string {
  for (const line of body.split("\n")) {
    const t = line.trim();
    if (t) return t;
  }
  return "";
}

// ⌘\ (Mac) / Ctrl+\ (others) toggles notes focus mode. `code` first so
// non-US layouts (where "\" sits elsewhere or needs Alt) still work.
export function isFocusShortcut(e: {
  key: string;
  code?: string;
  metaKey: boolean;
  ctrlKey: boolean;
  altKey: boolean;
  shiftKey: boolean;
}): boolean {
  if (!(e.metaKey || e.ctrlKey) || e.altKey || e.shiftKey) return false;
  return e.code === "Backslash" || e.key === "\\";
}
