export type DueStatus = "overdue" | "due-soon" | "ok" | "unknown";

export type ServiceItemLike = {
  intervalMonths: number | null;
  intervalMileage: number | null;
  lastPerformedAt: Date | string | null;
  lastPerformedMileage: number | null;
};

export type DueInfo = {
  status: DueStatus;
  dueAt: Date | null;
  dueMileage: number | null;
  daysFromNow: number | null;
  milesFromNow: number | null;
};

export const DUE_SOON_DAYS = 30;
export const DUE_SOON_MILEAGE = 1000;

function addMonths(d: Date, months: number): Date {
  const r = new Date(d);
  r.setMonth(r.getMonth() + months);
  return r;
}

function daysBetween(from: Date, to: Date): number {
  return Math.floor((to.getTime() - from.getTime()) / 86_400_000);
}

export function computeDue(
  item: ServiceItemLike,
  currentMileage: number | null,
  today: Date = new Date()
): DueInfo {
  let dueAt: Date | null = null;
  let dueMileage: number | null = null;
  let daysFromNow: number | null = null;
  let milesFromNow: number | null = null;

  const last = item.lastPerformedAt ? new Date(item.lastPerformedAt) : null;
  if (last && item.intervalMonths) {
    dueAt = addMonths(last, item.intervalMonths);
    daysFromNow = daysBetween(today, dueAt);
  }
  if (
    item.lastPerformedMileage != null &&
    item.intervalMileage &&
    currentMileage != null
  ) {
    dueMileage = item.lastPerformedMileage + item.intervalMileage;
    milesFromNow = dueMileage - currentMileage;
  }

  let status: DueStatus = "unknown";
  if (daysFromNow !== null || milesFromNow !== null) {
    const overdue =
      (daysFromNow !== null && daysFromNow < 0) ||
      (milesFromNow !== null && milesFromNow < 0);
    const dueSoon =
      (daysFromNow !== null && daysFromNow <= DUE_SOON_DAYS) ||
      (milesFromNow !== null && milesFromNow <= DUE_SOON_MILEAGE);
    status = overdue ? "overdue" : dueSoon ? "due-soon" : "ok";
  }

  return { status, dueAt, dueMileage, daysFromNow, milesFromNow };
}

export function statusColor(status: DueStatus): {
  bg: string;
  text: string;
  ring: string;
} {
  switch (status) {
    case "overdue":
      return {
        bg: "bg-rose-500/10",
        text: "text-rose-500",
        ring: "ring-rose-500/30",
      };
    case "due-soon":
      return {
        bg: "bg-amber-500/10",
        text: "text-amber-500",
        ring: "ring-amber-500/30",
      };
    case "ok":
      return {
        bg: "bg-emerald-500/10",
        text: "text-emerald-500",
        ring: "ring-emerald-500/30",
      };
    case "unknown":
      return {
        bg: "bg-zinc-500/10",
        text: "text-zinc-400",
        ring: "ring-zinc-500/20",
      };
  }
}

export function formatRelativeDays(daysFromNow: number): string {
  if (daysFromNow === 0) return "today";
  if (daysFromNow > 0) {
    if (daysFromNow < 30) return `in ${daysFromNow}d`;
    if (daysFromNow < 365) return `in ${Math.round(daysFromNow / 30)}mo`;
    return `in ${(daysFromNow / 365).toFixed(1)}y`;
  }
  const past = Math.abs(daysFromNow);
  if (past < 30) return `${past}d overdue`;
  if (past < 365) return `${Math.round(past / 30)}mo overdue`;
  return `${(past / 365).toFixed(1)}y overdue`;
}

export function formatRelativeMiles(
  milesFromNow: number,
  unit: string
): string {
  if (milesFromNow === 0) return `now`;
  if (milesFromNow > 0) return `in ${milesFromNow.toLocaleString()} ${unit}`;
  return `${Math.abs(milesFromNow).toLocaleString()} ${unit} overdue`;
}
