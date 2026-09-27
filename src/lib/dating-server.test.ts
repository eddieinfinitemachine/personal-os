import { describe, expect, it, vi } from "vitest";

vi.mock("@/lib/prisma", () => ({ prisma: {} }));

import { newPersonError, personPatch, personPatchError } from "@/lib/dating-server";

describe("quick add body", () => {
  const body = {
    name: "  Zoe Park ",
    stage: "dating",
    handles: "(415) 555-0123",
    instagram: "https://www.instagram.com/Zoe.Park/?igsh=abc",
    metVia: "Hinge",
    metAt: "2026-09-20T16:00:00.000Z",
  };

  it("accepts a full quick add and normalizes phone and Instagram", () => {
    expect(personPatchError(body) ?? newPersonError(body)).toBeNull();
    expect(personPatch(body)).toMatchObject({
      name: "Zoe Park",
      stage: "dating",
      handles: ["+14155550123"],
      instagram: "zoe.park",
      metVia: "Hinge",
      metAt: new Date("2026-09-20T16:00:00.000Z"),
    });
  });

  it("accepts just a name with blank optional fields", () => {
    const b = { name: "Ana", stage: "talking", handles: "", instagram: "", metVia: "", metAt: null };
    expect(personPatchError(b) ?? newPersonError(b)).toBeNull();
    expect(personPatch(b)).toMatchObject({ name: "Ana", handles: [], instagram: null, metVia: null, metAt: null });
  });

  it("rejects what can't be used", () => {
    expect(personPatchError({ instagram: "not a handle!" })).toMatch(/Instagram/);
    expect(personPatchError({ name: "  " })).toBe("Name can't be empty");
    expect(personPatchError({ name: null })).toBe("Name can't be empty");
    expect(personPatchError({ name: "Maya" })).toBeNull();
    expect(newPersonError({ stage: "married" })).toBe("Unknown stage");
    expect(newPersonError({ handles: "call me" })).toMatch(/phone/);
    expect(newPersonError({ handles: 42 })).toMatch(/handles/);
    expect(newPersonError({ metAt: "someday" })).toMatch(/date/);
  });
});
