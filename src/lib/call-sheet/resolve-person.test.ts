import { beforeEach, describe, expect, it, vi } from "vitest";
const prisma = vi.hoisted(() => ({
  person: { findMany: vi.fn(), create: vi.fn() },
}));
vi.mock("@/lib/prisma", () => ({ prisma }));
import { matchPerson, resolveOrCreatePerson } from "./resolve-person";

const people = [
  { id: "rivera", firstName: "Alex", lastName: "Rivera" },
  { id: "morgan", firstName: "Alex Morgan", lastName: null },
  { id: "sam", firstName: "Sam", lastName: "Lee" },
  { id: "maya", firstName: "maya", lastName: "ROSS" },
  { id: "mary", firstName: "Mary Ann", lastName: "Smith" },
];
describe("matchPerson", () => {
  it("matches a full name case-insensitively, with spacing noise", () => {
    expect(matchPerson(people, { firstName: "alex", lastName: "RIVERA" })).toEqual({
      kind: "match",
      person: people[0],
    });
    expect(matchPerson(people, { firstName: " Maya ", lastName: " Ross" })).toMatchObject({
      kind: "match",
      person: { id: "maya" },
    });
  });
  it("matches a record that stores the whole name in firstName", () => {
    expect(matchPerson(people, { firstName: "Alex", lastName: "Morgan" })).toMatchObject({
      kind: "match",
      person: { id: "morgan" },
    });
    expect(matchPerson(people, { firstName: "Alex Morgan", lastName: null })).toMatchObject({
      kind: "match",
      person: { id: "morgan" },
    });
  });
  it("matches a lone first name only when it is unique", () => {
    expect(matchPerson(people, { firstName: "Sam" })).toMatchObject({
      kind: "match",
      person: { id: "sam" },
    });
    expect(matchPerson(people, { firstName: "alex", lastName: null })).toEqual({
      kind: "ambiguous",
      candidates: [people[1], people[0]],
    });
    // A multi-word first name is not matched by its first word alone.
    expect(matchPerson(people, { firstName: "Mary" })).toEqual({ kind: "none" });
  });
  it("finds nobody for an unknown or empty name", () => {
    expect(matchPerson(people, { firstName: "Alex", lastName: "Hopper" })).toEqual({
      kind: "none",
    });
    expect(matchPerson(people, { firstName: "  " })).toEqual({ kind: "none" });
  });
});
describe("resolveOrCreatePerson", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    prisma.person.findMany.mockResolvedValue(people);
  });
  it("looks only at the owner's non-archived people", async () => {
    await resolveOrCreatePerson("owner", { firstName: "Alex", lastName: "Rivera" });
    expect(prisma.person.findMany).toHaveBeenCalledWith({
      where: {
        userId: "owner",
        archived: false,
        firstName: { startsWith: "Alex", mode: "insensitive" },
      },
      select: { id: true, firstName: true, lastName: true },
    });
    expect(prisma.person.create).not.toHaveBeenCalled();
  });
  it("returns candidates instead of guessing", async () => {
    const result = await resolveOrCreatePerson("owner", { firstName: "Alex" });
    expect(result.kind).toBe("ambiguous");
    expect(prisma.person.create).not.toHaveBeenCalled();
  });
  it("creates a bare person when nobody matches", async () => {
    prisma.person.create.mockResolvedValue({ id: "new", firstName: "Alex", lastName: "Hopper" });
    const result = await resolveOrCreatePerson("owner", {
      firstName: " Alex ",
      lastName: " Hopper ",
    });
    expect(result).toEqual({
      kind: "created",
      person: { id: "new", firstName: "Alex", lastName: "Hopper" },
    });
    expect(prisma.person.create).toHaveBeenCalledWith({
      data: { userId: "owner", firstName: "Alex", lastName: "Hopper" },
      select: { id: true, firstName: true, lastName: true },
    });
  });
});
