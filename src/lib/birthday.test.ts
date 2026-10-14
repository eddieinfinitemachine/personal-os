import { describe, expect, it } from "vitest";
import {
  formatBirthday,
  nextBirthday,
  parseBirthday,
  YEARLESS_BIRTHDAY_YEAR,
} from "./birthday";

describe("parseBirthday", () => {
  it("reads a real YYYY-MM-DD date as UTC midnight", () => {
    expect(parseBirthday("1990-03-05")?.toISOString()).toBe(
      "1990-03-05T00:00:00.000Z",
    );
    expect(parseBirthday(" 2000-02-29 ")?.toISOString()).toBe(
      "2000-02-29T00:00:00.000Z",
    );
  });
  it("keeps Contacts' yearless 1604 birthdays, including Feb 29", () => {
    expect(YEARLESS_BIRTHDAY_YEAR).toBe(1604);
    expect(parseBirthday("1604-07-14")?.toISOString()).toBe(
      "1604-07-14T00:00:00.000Z",
    );
    expect(parseBirthday("1604-02-29")?.getUTCDate()).toBe(29);
  });
  it.each([
    "2026-02-29",
    "1990-13-01",
    "1990-3-5",
    "--03-05",
    "1603-03-05",
    "2101-01-01",
    "1990-03-05T00:00:00Z",
    "March 5",
    "",
    null,
    19900305,
  ])("rejects %j", (value) => {
    expect(parseBirthday(value)).toBeNull();
  });
});

describe("nextBirthday", () => {
  const born = (date: string) => new Date(`${date}T00:00:00.000Z`);
  it("is today, later this year, or next year", () => {
    expect(nextBirthday(born("1990-09-28"), "2026-09-28")).toBe("2026-09-28");
    expect(nextBirthday(born("1990-10-01"), "2026-09-28")).toBe("2026-10-01");
    expect(nextBirthday(born("1990-09-27"), "2026-09-28")).toBe("2027-09-27");
    expect(nextBirthday(born("1990-01-01"), "2026-12-31")).toBe("2027-01-01");
  });
  it("marks Feb 29 on Feb 28 outside leap years", () => {
    const leapling = born("2000-02-29");
    expect(nextBirthday(leapling, "2027-02-01")).toBe("2027-02-28");
    expect(nextBirthday(leapling, "2027-02-28")).toBe("2027-02-28");
    expect(nextBirthday(leapling, "2027-03-01")).toBe("2028-02-29");
    expect(nextBirthday(leapling, "2028-02-28")).toBe("2028-02-29");
    expect(nextBirthday(born("1604-02-29"), "2100-02-01")).toBe("2100-02-28");
  });
});

describe("formatBirthday", () => {
  it("drops the placeholder year of a yearless birthday", () => {
    expect(formatBirthday(new Date("1990-03-05T00:00:00Z"))).toBe(
      "1990-03-05",
    );
    expect(formatBirthday(new Date("1604-03-05T00:00:00Z"))).toBe(
      "03-05 (year unknown)",
    );
  });
});
