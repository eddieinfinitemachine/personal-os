import { describe, expect, it } from "vitest";
import { isDateOnly } from "./utils";

describe("isDateOnly", () => {
  it("accepts real calendar days", () => {
    for (const d of ["2026-11-08", "2028-02-29", "2026-12-31", "1999-01-01"]) expect(isDateOnly(d)).toBe(true);
  });

  it("rejects impossible days, other formats and non-strings", () => {
    for (const d of ["2026-02-30", "2027-02-29", "2026-13-01", "2026-11-8", "2026-11-08T00:00:00.000Z", "11/08/2026", "", "tomorrow", null, undefined, 20261108, new Date("2026-11-08")]) {
      expect(isDateOnly(d)).toBe(false);
    }
  });
});
