// A lab result as the report gave it. "Less than" results can't be stored as a
// plain number, so `LabResult.value` holds the limit and `notes` holds the
// reported text ("<2"). Everything that shows or compares a value goes through
// here, so a reporting limit never reads as a measurement.

export type LabValue = {
  value: number;
  notes?: string | null;
  flag?: string | null;
  refLow: number | null;
  refHigh: number | null;
};

export type LabStatus = "low" | "high" | "normal" | "unknown";

const LIMIT_RESULT = /^\s*[<>]\s*\d+(?:\.\d+)?\s*$/;

export function isLimitResult(row: Pick<LabValue, "notes">): boolean {
  return LIMIT_RESULT.test(row.notes ?? "");
}

export function labShown(row: Pick<LabValue, "value" | "notes">): string {
  return isLimitResult(row) ? row.notes!.replace(/\s+/g, "") : String(row.value);
}

const PLAIN_NUMBER = /^\d+(?:\.\d+)?$/;

/**
 * Labs print 5.0, but it's stored as 5. Pads one marker's results to the same
 * number of decimals so they read as the report did. Limits like "<2" stay as they are.
 */
export function alignDecimals(shown: string[]): string[] {
  const places = shown.filter((s) => PLAIN_NUMBER.test(s)).map((s) => s.split(".")[1]?.length ?? 0);
  const wanted = Math.max(0, ...places);
  return shown.map((s) => (PLAIN_NUMBER.test(s) ? Number(s).toFixed(wanted) : s));
}

/** An ISO date as "Jan 10, 2030". UTC and en-US, so the server render and hydration always agree. */
export function labDate(iso: string): string {
  return new Date(iso).toLocaleDateString("en-US", {
    month: "short",
    day: "numeric",
    year: "numeric",
    timeZone: "UTC",
  });
}

export function labStatus(row: LabValue): LabStatus {
  if (row.flag === "low" || row.flag === "high" || row.flag === "normal") return row.flag;
  if (isLimitResult(row)) {
    // "<2" against an upper limit of 1 can't be called high: the true value may be in range.
    const below = row.notes!.trim().startsWith("<");
    if (below && row.refHigh != null && row.value <= row.refHigh) return "normal";
    if (!below && row.refLow != null && row.value >= row.refLow) return "normal";
    return "unknown";
  }
  if (row.refLow != null && row.value < row.refLow) return "low";
  if (row.refHigh != null && row.value > row.refHigh) return "high";
  if (row.refLow != null || row.refHigh != null) return "normal";
  return "unknown";
}

export function labRange(row: Pick<LabValue, "refLow" | "refHigh">): string | null {
  if (row.refLow != null && row.refHigh != null) return `${row.refLow}–${row.refHigh}`;
  if (row.refLow != null) return `>${row.refLow}`;
  if (row.refHigh != null) return `<${row.refHigh}`;
  return null;
}
