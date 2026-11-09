import { describe, expect, it } from "vitest";
import { listAccessWhere, listColorFor } from "./list-access";

describe("listAccessWhere", () => {
  it("is the owner or a member", () => {
    expect(listAccessWhere("u1")).toEqual({ OR: [{ userId: "u1" }, { members: { some: { userId: "u1" } } }] });
  });
});

describe("listColorFor", () => {
  const list = (userId: string, members: { userId: string; color: string | null }[]) => ({ userId, color: "rose", members });

  it("gives the owner the list's color", () => {
    expect(listColorFor(list("u1", [{ userId: "u2", color: "cyan" }]), "u1")).toBe("rose");
  });

  it("gives a member their own color when they've set one, else the owner's", () => {
    expect(listColorFor(list("owner", [{ userId: "u2", color: "cyan" }, { userId: "u1", color: "emerald" }]), "u1")).toBe("emerald");
    expect(listColorFor(list("owner", [{ userId: "u1", color: null }]), "u1")).toBe("rose");
    expect(listColorFor(list("owner", []), "u1")).toBe("rose");
  });
});
