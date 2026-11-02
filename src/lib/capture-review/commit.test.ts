import { describe, expect, it, vi } from "vitest";
import type { Prisma } from "@prisma/client";
import { commitCore, validateCoreProposal } from "./commit";
function client() {
  let serial = 0;
  const create = vi.fn(async ({ data }) => ({ id: `row-${++serial}`, ...data }));
  const tx = {
    list: { findFirst: vi.fn(async () => ({ id: "list", name: "To Do" })), create },
    project: { findFirst: vi.fn(async () => ({ id: "project", name: "Inbox" })), create },
    todo: { create, update: vi.fn() }, asset: { create }, trip: { create }, interaction: { create },
    person: { findFirst: vi.fn(async () => null), create, update: vi.fn(), updateMany: vi.fn() },
    attachment: { findFirst: vi.fn(async () => ({ id: "attachment", userId: "alice", url: "https://blob.example/file" })), create: vi.fn(), update: vi.fn() },
  };
  return { tx: tx as unknown as Prisma.TransactionClient, raw: tx, create };
}
describe("core capture commit", () => {
  it.each([
    { type: "todo", title: "X", dueDate: "2026-02-31" },
    { type: "person", firstName: "X", circles: [3] },
    { type: "asset", title: "X", assetKind: "media", url: "javascript:alert(1)" },
    { type: "trip", name: "X", costUsd: "10" },
    { type: "interaction", title: "X", kind: "meeting", occurredAt: "2026-11-01", personHints: [{ firstName: 3 }] },
  ])("rejects malformed proposals before any write: %j", async proposal => {
    const { tx, create } = client();
    expect(() => validateCoreProposal(proposal)).toThrow();
    await expect(commitCore(tx, "alice", { text: "", url: null }, proposal as never, [])).rejects.toThrow();
    expect(create).not.toHaveBeenCalled();
  });
  it("transfers original attachment metadata instead of creating a second attachment", async () => {
    const { tx, raw } = client();
    const result = await commitCore(tx, "alice", { text: "shared", url: null }, { type: "asset", assetKind: "inventory", title: "Camera" }, [{ file: { name: "manual.pdf", type: "application/pdf", size: 20 }, url: "https://blob.example/file", attachmentId: "attachment" }], { mode: "correction" });
    expect(raw.attachment.create).not.toHaveBeenCalled();
    expect(raw.attachment.update).toHaveBeenCalledWith({ where: { id: "attachment" }, data: { todoId: null, projectId: null, assetId: result.id } });
  });
  it("retains mobile companion tasks while web person saves only create a person", async () => {
    const mobile = client();
    await commitCore(mobile.tx, "alice", { text: "Maya", url: null }, { type: "person", firstName: "Maya" }, [], { mode: "mobile" });
    expect(mobile.create.mock.calls.map(([x]) => x.data.title)).toContain("Follow up with Maya");
    const web = client();
    await commitCore(web.tx, "alice", { text: "Maya", url: null }, { type: "person", firstName: "Maya" }, [], { mode: "web" });
    expect(web.create).toHaveBeenCalledTimes(1);
  });
  it("rejects inaccessible explicit correction destinations before writes", async () => {
    const { tx, raw, create } = client();
    raw.list.findFirst.mockResolvedValue(null as never);
    await expect(commitCore(tx, "alice", { text: "", url: null }, { type: "todo", title: "Task" }, [], { mode: "correction", listId: "someone-elses-list" })).rejects.toMatchObject({ status: 404 });
    expect(create).not.toHaveBeenCalled();
  });
});
