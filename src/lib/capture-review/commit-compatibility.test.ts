import { describe, expect, it, vi } from "vitest";
import type { Prisma } from "@prisma/client";
import { commitCore, type CoreProposal } from "./commit";

function client() {
  let serial = 0;
  const person = {
    id: "existing-person", userId: "alice", firstName: "Synthetic", lastName: "Contact",
    archived: true, role: null, company: null, city: null, country: null, email: null,
    phone: null, howWeMet: null, strength: null, imageUrl: null, notes: "Existing context",
    circles: [], interests: [], birthday: null, socialUrls: null,
  };
  const people: Array<Record<string, unknown>> = [person];
  const makeRow = async ({ data }: { data: Record<string, unknown> }) => ({ id: `row-${++serial}`, ...data });
  const personCreate = vi.fn(async ({ data }: { data: Record<string, unknown> }) => {
    const row = { id: `person-${++serial}`, archived: false, ...data };
    people.push(row);
    return row;
  });
  const personUpdate = vi.fn(async ({ where, data }: { where: { id: string }; data: Record<string, unknown> }) => {
    const row = people.find(item => item.id === where.id)!;
    Object.assign(row, data);
    return row;
  });
  const tx = {
    list: { findFirst: vi.fn(async ({ where }: { where: { name: { equals: string } } }) => ({ id: "list", name: where.name.equals })), create: vi.fn(makeRow) },
    project: { findFirst: vi.fn(async () => ({ id: "inbox", name: "Inbox" })), create: vi.fn(makeRow) },
    todo: { create: vi.fn(makeRow) }, asset: { create: vi.fn(makeRow) }, interaction: { create: vi.fn(makeRow) },
    person: {
      findFirst: vi.fn(async ({ where }: { where: { userId: string; archived?: boolean; firstName: { equals: string }; lastName: { equals: string } | null } }) => people.find(item =>
        item.userId === where.userId &&
        (where.archived === undefined || item.archived === where.archived) &&
        String(item.firstName).toLowerCase() === where.firstName.equals.toLowerCase() &&
        (where.lastName === null ? item.lastName === null : String(item.lastName).toLowerCase() === where.lastName.equals.toLowerCase()),
      ) ?? null),
      create: personCreate, update: personUpdate, updateMany: vi.fn(async () => ({ count: 1 })),
    },
  };
  return { tx: tx as unknown as Prisma.TransactionClient, raw: tx, person, people };
}

const personProposal: CoreProposal = { type: "person", firstName: "Synthetic", lastName: "Contact", role: "Designer" };
const interactionProposal: CoreProposal = {
  type: "interaction", title: "Synthetic meeting", kind: "meeting", occurredAt: "2026-11-01",
  personHints: [{ firstName: "Synthetic", lastName: "Contact" }],
};

describe("capture commit backward compatibility", () => {
  it.each(["web", "mobile"] as const)("reuses an archived person in %s capture without changing archive state", async mode => {
    const { tx, raw, person, people } = client();
    const result = await commitCore(tx, "alice", { text: "Add Synthetic Contact", url: null }, personProposal, [], { mode });
    expect(result.id).toBe(person.id);
    expect(people).toHaveLength(1);
    expect(person).toMatchObject({ archived: true, role: "Designer" });
    expect(raw.person.create).not.toHaveBeenCalled();
  });

  it.each(["web", "mobile", "auto"] as const)("links %s interactions to the existing archived person", async mode => {
    const { tx, raw, person, people } = client();
    await commitCore(tx, "alice", { text: "Met Synthetic Contact", url: null }, interactionProposal, [], { mode });
    expect(raw.interaction.create).toHaveBeenCalledWith(expect.objectContaining({ data: expect.objectContaining({ personIds: [person.id] }) }));
    expect(people).toHaveLength(1);
    expect(person.archived).toBe(true);
    expect(raw.person.create).not.toHaveBeenCalled();
  });

  it.each([personProposal, interactionProposal])("unarchives the reused contact when correcting to $type", async proposal => {
    const { tx, raw, person, people } = client();
    const result = await commitCore(tx, "alice", { text: "Synthetic capture", url: null }, proposal, [], { mode: "correction" });
    expect(people).toHaveLength(1);
    expect(person.archived).toBe(false);
    expect(raw.person.update).toHaveBeenCalledWith(expect.objectContaining({ where: { id: person.id }, data: expect.objectContaining({ archived: false }) }));
    expect(raw.person.create).not.toHaveBeenCalled();
    if (proposal.type === "person") expect(result.id).toBe(person.id);
    else expect(raw.interaction.create).toHaveBeenCalledWith(expect.objectContaining({ data: expect.objectContaining({ personIds: [person.id] }) }));
  });

  it.each(["media", "place"] as const)("keeps canonical URL and organizer notes on automatic %s Later tasks", async assetKind => {
    const { tx, raw } = client();
    await commitCore(tx, "alice", { text: "Save for the lighting project", url: "https://short.test/a" }, {
      type: "asset", assetKind, title: "Synthetic reference", url: "https://canonical.test/reference",
      notes: "Read for the lighting project", details: { format: "article" },
    }, [], { mode: "auto" });
    const task = raw.todo.create.mock.calls[0][0].data;
    expect(task.notes).toContain("https://canonical.test/reference");
    expect(task.notes).toContain("Read for the lighting project");
    expect(task.notes).not.toContain("https://short.test/a");
  });
});
