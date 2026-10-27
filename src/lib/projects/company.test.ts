import { describe, expect, it } from "vitest";
import { COMPANY_ORDER, companyFor } from "./company";

describe("companyFor", () => {
  it("applies the rules in order", () => {
    // An olto- repo under the IM org is Olto, not Infinite Machine.
    expect(companyFor({ name: "olto-dashboard", owner: "Infinite-Machine" })).toBe("Olto");
    expect(companyFor({ name: "silo-agents", owner: "Infinite-Machine" })).toBe("Silo");
    expect(companyFor({ name: "Silo Stack" })).toBe("Silo");
    expect(companyFor({ name: "walden-app" })).toBe("Walden");
    expect(companyFor({ name: "anything", owner: "waldenmeditation" })).toBe("Walden");
    expect(companyFor({ name: "service-and-troubleshooting", owner: "Infinite-Machine" })).toBe("Infinite Machine");
    expect(companyFor({ name: "im-creative-library", owner: "edcohen" })).toBe("Infinite Machine");
    expect(companyFor({ name: "Infinite Machine hiring" })).toBe("Infinite Machine");
    expect(companyFor({ name: "infinitemachine-site" })).toBe("Infinite Machine");
    expect(companyFor({ name: "c2-granola-sync" })).toBe("Infinite Machine");
    expect(companyFor({ name: "C2 launch" })).toBe("Infinite Machine");
    expect(companyFor({ name: "rushmore", owner: "edcohen" })).toBe("Personal");
  });

  it("only treats c2 as its own token", () => {
    expect(companyFor({ name: "ec2-tools" })).toBe("Personal");
    expect(companyFor({ name: "abc2" })).toBe("Personal");
    expect(companyFor({ name: "trim-ops" })).toBe("Personal");
  });

  it("overrides win, by owner/name or by name, any case", () => {
    const overrides = { "edcohen/rushmore": "Silo" as const, "Personal OS": "Walden" as const };
    expect(companyFor({ name: "rushmore", owner: "EdCohen" }, overrides)).toBe("Silo");
    expect(companyFor({ name: "personal os" }, overrides)).toBe("Walden");
    expect(companyFor({ name: "olto-x" }, overrides)).toBe("Olto");
  });

  it("orders companies with Personal last", () => {
    expect(COMPANY_ORDER).toEqual(["Infinite Machine", "Olto", "Silo", "Walden", "Personal"]);
  });
});
