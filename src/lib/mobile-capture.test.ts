import { createHash } from "node:crypto";
import { beforeEach, describe, expect, it, vi } from "vitest";
const mocks = vi.hoisted(() => ({
  review: vi.fn(), record: vi.fn(), receiptFind: vi.fn(), receiptCreate: vi.fn(), transaction: vi.fn(), lock: vi.fn(),
  projectMany: vi.fn(), projectFirst: vi.fn(), projectCreate: vi.fn(),
  listFirst: vi.fn(), listCreate: vi.fn(), todoAggregate: vi.fn(), aggregate: vi.fn(), attachmentCreate: vi.fn(), attachmentMany: vi.fn(),
  todoCreate: vi.fn(), todoUpdate: vi.fn(), assetCreate: vi.fn(), personFirst: vi.fn(), personCreate: vi.fn(), personUpdate: vi.fn(), personUpdateMany: vi.fn(),
  tripCreate: vi.fn(), interactionCreate: vi.fn(), parse: vi.fn(), put: vi.fn(), del: vi.fn(),
}));
vi.mock("@/lib/prisma", () => ({ prisma: {
  mobileCaptureReceipt: { findFirst: mocks.receiptFind }, $transaction: mocks.transaction,
  project: { findMany: mocks.projectMany }, list: { findFirst: mocks.listFirst },
  attachment: { aggregate: mocks.aggregate, findMany: mocks.attachmentMany },
} }));
vi.mock("@/lib/smart-capture", () => ({ parseCapture: mocks.parse }));
vi.mock("@vercel/blob", () => ({ put: mocks.put, del: mocks.del }));
vi.mock("./capture-review/journal", () => ({ journalClient: (client: unknown) => ({ client, effects: () => ({ version: 1, writes: [] }) }) }));
vi.mock("./capture-review/record", () => ({ captureLock: vi.fn(), recordCapture: mocks.record }));
vi.mock("./capture-review/read", () => ({ getCaptureReview: mocks.review }));
import { captureMobile } from "./mobile-capture";
import { mobileReceiptId, type MobileCaptureInput } from "./mobile-capture-input";
const requestId = "12345678-1234-4234-8234-123456789abc";
const input = (overrides: Partial<MobileCaptureInput> = {}): MobileCaptureInput => ({ requestId, text: "buy milk", url: null, files: [], ...overrides });
// Computed here rather than through mobileReceiptId, so the test pins the key itself.
const reviewKey = (userId: string, id = requestId) => createHash("sha256").update(JSON.stringify([userId, id.toLowerCase()])).digest("hex");
type Row = Record<string, unknown> & { id: string };
let records: Array<{ table: string; row: Row }>;
let receipts: Map<string, { id: string; userId: string; requestHash: string; result: unknown }>;
let serial: number;
let events: string[];
beforeEach(() => {
  vi.resetAllMocks(); mocks.review.mockResolvedValue(null); records = []; receipts = new Map(); serial = 0; events = [];
  const create = (table: string) => async ({ data }: { data: Record<string, unknown> }) => {
    events.push(table); const row = { id: `${table}-${++serial}`, ...data } as Row;
    records.push({ table, row }); return row;
  };
  mocks.parse.mockResolvedValue({ type: "todo", title: "Buy milk" });
  mocks.receiptFind.mockImplementation(async ({ where }) => { const found = receipts.get(where.id); return found?.userId === where.userId ? found : null; });
  mocks.receiptCreate.mockImplementation(async ({ data }) => { events.push("receipt"); receipts.set(data.id, data); return data; });
  mocks.projectMany.mockResolvedValue([]);
  mocks.projectFirst.mockImplementation(async ({ where }) => where.name ? { id: `inbox-${where.userId}`, name: "Inbox" } : null);
  mocks.projectCreate.mockImplementation(create("project"));
  mocks.listFirst.mockImplementation(async ({ where }) => where.OR ? null : { id: `list-${where.userId}-${where.name.equals}`, name: where.name.equals });
  mocks.todoAggregate.mockImplementation(async ({ where }) => ({ _max: { position: records.filter(item => item.table === "todo" && item.row.listId === where.listId).length ? 7 : null } }));
  mocks.listCreate.mockImplementation(create("list"));
  mocks.aggregate.mockImplementation(async ({ where }) => ({ _sum: { size: records.filter(item => item.table === "attachment" && item.row.userId === where.userId).reduce((sum, item) => sum + Number(item.row.size), 0) } }));
  mocks.attachmentCreate.mockImplementation(create("attachment"));
  mocks.attachmentMany.mockImplementation(async ({ where }) => records.filter(item => item.table === "attachment" && item.row.userId === where.userId && where.url.in.includes(item.row.url)).map(item => ({ url: item.row.url })));
  mocks.todoCreate.mockImplementation(create("todo")); mocks.todoUpdate.mockImplementation(async ({ where, data }) => ({ id: where.id, ...data }));
  mocks.assetCreate.mockImplementation(create("asset")); mocks.personFirst.mockResolvedValue(null); mocks.personCreate.mockImplementation(create("person"));
  mocks.personUpdate.mockImplementation(async ({ where, data }) => ({ id: where.id, ...data })); mocks.personUpdateMany.mockResolvedValue({ count: 1 });
  mocks.tripCreate.mockImplementation(create("trip")); mocks.interactionCreate.mockImplementation(create("interaction"));
  mocks.lock.mockImplementation(async () => { events.push("lock"); return []; });
  mocks.put.mockImplementation(async () => ({ url: `https://blob.example.com/file-${++serial}` })); mocks.del.mockResolvedValue(undefined);
  const tx = {
    $queryRaw: mocks.lock, mobileCaptureReceipt: { findFirst: mocks.receiptFind, create: mocks.receiptCreate },
    project: { findFirst: mocks.projectFirst, create: mocks.projectCreate }, list: { findFirst: mocks.listFirst, create: mocks.listCreate },
    attachment: { aggregate: mocks.aggregate, create: mocks.attachmentCreate }, todo: { create: mocks.todoCreate, update: mocks.todoUpdate, aggregate: mocks.todoAggregate },
    asset: { create: mocks.assetCreate }, person: { findFirst: mocks.personFirst, create: mocks.personCreate, update: mocks.personUpdate, updateMany: mocks.personUpdateMany },
    trip: { create: mocks.tripCreate }, interaction: { create: mocks.interactionCreate },
  };
  let tail = Promise.resolve();
  mocks.transaction.mockImplementation(async (callback: (client: typeof tx) => Promise<unknown>) => {
    const previous = tail; let release!: () => void;
    tail = new Promise<void>(resolve => { release = resolve; }); await previous;
    const beforeRecords = records.slice(); const beforeReceipts = new Map(receipts);
    try { return await callback(tx); }
    catch (error) { records = beforeRecords; receipts = beforeReceipts; throw error; }
    finally { release(); }
  });
});
describe("mobile capture receipts", () => {
  it("commits receipt and organized record together, then replays without AI", async () => {
    const first = await captureMobile("alice", input());
    expect(first).toMatchObject({ ok: true, type: "todo", title: "Buy milk", destination: "To Do", path: "/", reviewId: reviewKey("alice") });
    expect(events).toEqual(["lock", "todo", "receipt"]); expect(receipts.size).toBe(1);
    // The review row is written under the id the response names; the stored placement and receipt stay without it.
    expect(mocks.record.mock.calls[0][1]).toMatchObject({ id: first.reviewId });
    expect(mocks.record.mock.calls[0][1].placement).not.toHaveProperty("reviewId");
    expect(receipts.get(first.reviewId)!.result).not.toHaveProperty("reviewId");
    expect(await captureMobile("alice", input())).toEqual(first);
    expect(mocks.parse).toHaveBeenCalledTimes(1); expect(mocks.todoCreate).toHaveBeenCalledTimes(1);
  });
  it("replays the current placement after an Inbox correction without recreating the original", async () => {
    await captureMobile("alice", input());
    mocks.review.mockResolvedValue({ correctedAt: "2026-11-01T12:00:00Z", placement: { type: "asset", id: "corrected", title: "Milk", assetKind: "inventory", destination: "Inventory", path: "/inventory" } });
    expect(await captureMobile("alice", input())).toMatchObject({ id: "corrected", type: "asset", path: "/inventory", reviewId: reviewKey("alice") });
    expect(mocks.todoCreate).toHaveBeenCalledTimes(1);
    expect(mocks.parse).toHaveBeenCalledTimes(1);
  });
  it("rolls back the destination if creating its review fails", async () => {
    mocks.record.mockRejectedValue(new Error("review write failed"));
    await expect(captureMobile("alice", input())).rejects.toThrow("review write failed");
    expect(records).toHaveLength(0); expect(receipts.size).toBe(0);
  });
  it("rejects changed content for an existing UUID", async () => {
    await captureMobile("alice", input());
    await expect(captureMobile("alice", input({ text: "a different task" }))).rejects.toMatchObject({ status: 409 });
    expect(mocks.parse).toHaveBeenCalledTimes(1); expect(records).toHaveLength(1);
  });
  it("isolates identical request identifiers between users", async () => {
    const [alice, bob] = [await captureMobile("alice", input()), await captureMobile("bob", input())];
    expect(receipts.has(mobileReceiptId("alice", requestId))).toBe(true); expect(receipts.has(mobileReceiptId("bob", requestId))).toBe(true);
    expect([alice.reviewId, bob.reviewId]).toEqual([reviewKey("alice"), reviewKey("bob")]);
    expect(records.filter(item => item.table === "todo").map(item => item.row.userId)).toEqual(["alice", "bob"]);
  });
  it("serializes concurrent duplicate captures and removes the unused upload", async () => {
    const shared = input({ files: [new File(["hello"], "note.txt", { type: "text/plain" })] });
    const [first, second] = await Promise.all([captureMobile("alice", shared), captureMobile("alice", shared)]);
    expect(first).toEqual(second); expect(second.reviewId).toBe(reviewKey("alice")); expect(receipts.size).toBe(1); expect(records.filter(item => item.table === "todo")).toHaveLength(1);
    const attachments = records.filter(item => item.table === "attachment"); expect(attachments).toHaveLength(1);
    expect(mocks.put).toHaveBeenCalledTimes(2); expect(mocks.del).toHaveBeenCalledTimes(1);
    expect(mocks.del.mock.calls[0][0]).not.toContain(attachments[0].row.url);
  });
  it("rolls back records when receipt creation fails and cleans uploaded files", async () => {
    mocks.receiptCreate.mockRejectedValue(new Error("receipt write failed"));
    await expect(captureMobile("alice", input({ files: [new File(["hello"], "note.txt")] }))).rejects.toThrow("receipt write failed");
    expect(records).toHaveLength(0); expect(receipts.size).toBe(0); expect(mocks.del).toHaveBeenCalledTimes(1);
  });
});
describe("mobile capture organization and files", () => {
  it("rejects call-sheet proposals before uploading or saving unsupported records", async () => {
    mocks.parse.mockResolvedValue({ type: "call_sheet", firstName: "Alex", lastName: null, date: "2026-11-03", note: null });
    const log = vi.spyOn(console, "error").mockImplementation(() => {});
    try {
      await expect(captureMobile("alice", input({ files: [new File(["hello"], "note.txt")] }))).rejects.toMatchObject({ status: 502 });
      expect(mocks.put).not.toHaveBeenCalled();
      expect(mocks.transaction).not.toHaveBeenCalled();
      expect(receipts.size).toBe(0);
      expect(records).toHaveLength(0);
    } finally { log.mockRestore(); }
  });
  it("saves an interaction with owned people and retains its supporting files", async () => {
    mocks.parse.mockResolvedValue({ type: "interaction", title: "Coffee with Maya", kind: "meeting", occurredAt: "2026-11-01T12:00:00Z", personHints: [{ firstName: "Maya", lastName: "Chen" }], projectId: "another-user-project" });
    const result = await captureMobile("alice", input({ text: "Coffee with Maya", files: [new File(["hello"], "note.txt")] }));
    expect(result).toMatchObject({ type: "interaction", title: "Coffee with Maya", destination: "People", path: "/friends" });
    const person = records.find(item => item.table === "person")!;
    const interaction = records.find(item => item.table === "interaction")!;
    const todo = records.find(item => item.table === "todo")!;
    expect(person.row).toMatchObject({ userId: "alice", firstName: "Maya", lastName: "Chen" });
    expect(interaction.row).toMatchObject({ userId: "alice", projectId: null, personIds: [person.row.id] });
    expect(todo.row.notes).toContain(`Related interaction: ${result.id}`);
    expect(records.find(item => item.table === "attachment")!.row.todoId).toBe(todo.row.id);
    expect(mocks.personUpdateMany).toHaveBeenCalledWith(expect.objectContaining({ where: expect.objectContaining({ userId: "alice", id: { in: [person.row.id] } }) }));
  });
  it("does not save or upload on classification failure", async () => {
    mocks.parse.mockRejectedValue(new Error("temporarily unavailable"));
    const log = vi.spyOn(console, "error").mockImplementation(() => {});
    await expect(captureMobile("alice", input({ files: [new File(["hello"], "note.txt")] }))).rejects.toMatchObject({ status: 502 });
    expect(mocks.put).not.toHaveBeenCalled(); expect(mocks.transaction).not.toHaveBeenCalled(); expect(receipts.size).toBe(0); log.mockRestore();
  });
  it("honors explicit @name aliases without reclassifying", async () => {
    mocks.listFirst.mockImplementation(async () => ({ id: "shane", name: "EC/Shane" }));
    const result = await captureMobile("alice", input({ text: "@shane discuss shipping" }));
    expect(result.destination).toBe("EC/Shane"); expect(mocks.parse).not.toHaveBeenCalled();
    expect(mocks.todoCreate).toHaveBeenCalledWith({ data: expect.objectContaining({ title: "discuss shipping", listId: "shane", projectId: null, userId: "alice" }) });
  });
  it("files a classified todo in To Do whatever list the AI named, with no suggestion", async () => {
    mocks.parse.mockResolvedValue({ type: "todo", title: "Fix the garage door", listName: "Later" });
    const result = await captureMobile("alice", input({ text: "fix the garage door" }));
    expect(result).toMatchObject({ type: "todo", destination: "To Do" });
    expect(mocks.parse.mock.calls[0][0]).not.toHaveProperty("listNames");
    const row = records.find(item => item.table === "todo")!.row;
    expect(row).toMatchObject({ listId: "list-alice-To Do", projectId: "inbox-alice", position: 0 });
    expect(row).not.toHaveProperty("suggestedListId");
  });
  it("uses the first supported image for vision and attaches every original to the asset", async () => {
    mocks.parse.mockResolvedValue({ type: "asset", assetKind: "inventory", title: "Camera", projectId: "another-user-project" });
    const shared = input({ text: "My camera", files: [new File(["pdf bytes"], "manual.pdf", { type: "application/pdf" }), new File(["image bytes"], "camera.jpg", { type: "image/jpeg" })] });
    const result = await captureMobile("alice", shared);
    expect(result).toMatchObject({ type: "asset", assetKind: "inventory", destination: "Inventory", path: "/inventory" });
    expect(mocks.parse).toHaveBeenCalledWith(expect.objectContaining({ photo: { mediaType: "image/jpeg", base64: Buffer.from("image bytes").toString("base64") } }));
    expect(mocks.assetCreate).toHaveBeenCalledWith({ data: expect.objectContaining({ projectId: null, userId: "alice" }) });
    const attachments = records.filter(item => item.table === "attachment"); expect(attachments).toHaveLength(2);
    expect(attachments.every(item => item.row.assetId === result.id && item.row.userId === "alice")).toBe(true); expect(mocks.put.mock.calls[0][1]).toBe(shared.files[0]);
  });
  it("retains person file URLs and creates an explicitly linked supporting Inbox task", async () => {
    mocks.parse.mockResolvedValue({ type: "person", firstName: "Maya", lastName: "Chen" });
    const result = await captureMobile("alice", input({ files: [new File(["card"], "contact.vcf", { type: "text/vcard" })] }));
    expect(result).toMatchObject({ type: "person", title: "Maya Chen", destination: "People", path: "/friends" });
    const person = records.find(item => item.table === "person")!; const todo = records.find(item => item.table === "todo")!; const attachment = records.find(item => item.table === "attachment")!;
    expect(person.row.notes).toContain("https://blob.example.com/"); expect(todo.row.notes).toContain(`Related person: ${result.id}`); expect(attachment.row.todoId).toBe(todo.row.id);
  });
  it("retains trip originals in a supporting task without changing its destination", async () => {
    mocks.parse.mockResolvedValue({ type: "trip", name: "Tokyo", destination: "Tokyo" });
    const result = await captureMobile("alice", input({ files: [new File(["ticket"], "ticket.pdf", { type: "application/pdf" })] }));
    expect(result.type).toBe("trip"); expect(result.path).toBe(`/trips/${result.id}`);
    expect(records.find(item => item.table === "todo")!.row.notes).toContain(result.path); expect(records.find(item => item.table === "attachment")!.row.todoId).toBeTruthy();
  });
  it("checks quota before classification and again under the commit lock", async () => {
    mocks.aggregate.mockResolvedValueOnce({ _sum: { size: 0 } }).mockResolvedValueOnce({ _sum: { size: 1024 ** 3 } });
    await expect(captureMobile("alice", input({ files: [new File(["x"], "x.txt")] }))).rejects.toMatchObject({ status: 413 });
    expect(mocks.aggregate.mock.calls.every(call => call[0].where.userId === "alice")).toBe(true); expect(records).toHaveLength(0); expect(receipts.size).toBe(0); expect(mocks.del).toHaveBeenCalledTimes(1);
  });
  it("rejects incomplete AI proposals without silently creating a fallback", async () => {
    mocks.parse.mockResolvedValue({ type: "todo" }); const log = vi.spyOn(console, "error").mockImplementation(() => {});
    await expect(captureMobile("alice", input())).rejects.toMatchObject({ status: 502 }); expect(mocks.transaction).not.toHaveBeenCalled(); log.mockRestore();
  });
});
