import { createHash } from "node:crypto";
import { beforeEach, describe, expect, it, vi } from "vitest";
const mocks = vi.hoisted(() => ({ claude: vi.fn(), put: vi.fn(), del: vi.fn(), transaction: vi.fn(), receiptFind: vi.fn(), aggregate: vi.fn(), attachmentCount: vi.fn() }));
vi.mock("@/lib/prisma", () => ({ prisma: {
  mobileCaptureReceipt: { findFirst: mocks.receiptFind }, $transaction: mocks.transaction,
  attachment: { aggregate: mocks.aggregate, count: mocks.attachmentCount },
} }));
vi.mock("@/lib/claude", () => ({ callClaudeJSON: mocks.claude }));
vi.mock("@vercel/blob", () => ({ put: mocks.put, del: mocks.del }));
vi.mock("@/lib/smart-capture", () => ({ parseCapture: vi.fn() }));
vi.mock("./capture-review/read", () => ({ getCaptureReview: vi.fn() }));
vi.mock("@/lib/capture-auth", () => ({ resolveCaptureUser: vi.fn(async () => "alice") }));
vi.mock("@/lib/gcal", () => ({ syncRecentTodos: vi.fn() }));
vi.mock("next/server", async importOriginal => ({ ...await importOriginal<typeof import("next/server")>(), after: vi.fn() }));
import { POST } from "@/app/api/capture/mobile/notebook/route";
import { capturedFiles } from "./capture-review/correct-effects";
import { captureNotebook, extractNotebookItems, MAX_NOTEBOOK_ITEMS, normalizeNotebookItems, normalizeTitle, notebookSystem } from "./notebook-capture";
import type { MobileCaptureInput } from "./mobile-capture-input";
import type { Prisma } from "@prisma/client";

const requestId = "12345678-1234-4234-8234-123456789abc";
const jpeg = () => new File([new Uint8Array([0xff, 0xd8, 0xff, 0xe0, 1, 2, 3])], "page.jpg", { type: "image/jpeg" });
const input = (overrides: Partial<MobileCaptureInput> = {}): MobileCaptureInput => ({ requestId, text: "", url: null, files: [jpeg()], ...overrides });
const BLOB = "https://blob.example.com/page.jpg";
const DAY = 24 * 60 * 60 * 1000;
// Computed here rather than through captureKey, so the test pins the key itself.
const reviewKey = (userId: string, index: number) => createHash("sha256").update(JSON.stringify([userId, `notebook:${index}`, requestId])).digest("hex");
type Row = Record<string, unknown> & { id: string };
let todos: Row[], attachments: Row[], reviews: Row[], receipts: Row[], serial: number;

function modelReturns(...titles: Array<string | Record<string, unknown>>) {
  mocks.claude.mockResolvedValue({ items: titles.map(item => typeof item === "string" ? { title: item, notes: null, dueDate: null } : item) });
}
function existing(title: string, fields: Partial<Row> = {}) {
  const row = { id: `old-${++serial}`, userId: "alice", title, completedAt: null, ...fields } as Row;
  todos.push(row); return row;
}
beforeEach(() => {
  vi.resetAllMocks(); todos = []; attachments = []; reviews = []; receipts = []; serial = 0;
  mocks.put.mockResolvedValue({ url: BLOB }); mocks.del.mockResolvedValue(undefined);
  mocks.aggregate.mockResolvedValue({ _sum: { size: 0 } });
  mocks.receiptFind.mockImplementation(async ({ where }) => receipts.find(row => row.id === where.id && row.userId === where.userId) ?? null);
  mocks.attachmentCount.mockImplementation(async ({ where }) => attachments.filter(row => row.url === where.url).length);
  const tx = {
    $queryRaw: vi.fn().mockResolvedValue([]),
    // Each default list exists under its own id; shared-list lookups find nothing.
    list: { findFirst: vi.fn(async ({ where }) => { const name = typeof where.name === "string" ? where.name : where.name?.equals; return where.members || !name ? null : { id: `list-${name.toLowerCase().replace(/ /g, "")}`, name }; }), create: vi.fn() },
    project: { findFirst: vi.fn().mockResolvedValue({ id: "project-inbox", name: "Inbox" }), create: vi.fn() },
    todo: {
      create: vi.fn(async ({ data }) => { const row = { id: `todo-${++serial}`, completedAt: null, ...data } as Row; todos.push(row); return row; }),
      aggregate: vi.fn(async ({ where }) => { const positions = todos.filter(row => row.listId === where.listId && !row.parentId).map(row => Number(row.position ?? 0)); return { _max: { position: positions.length ? Math.max(...positions) : null } }; }),
      // Applies the query's own filter, so these tests fail if it stops scoping by user or date.
      findMany: vi.fn(async ({ where }) => todos.filter(row => row.userId === where.userId && where.OR.some((clause: { completedAt: null | { gte: Date } }) => clause.completedAt === null ? row.completedAt === null : row.completedAt !== null && (row.completedAt as Date) >= clause.completedAt.gte))),
    },
    attachment: {
      aggregate: mocks.aggregate,
      create: vi.fn(async ({ data }) => { const row = { id: `attachment-${++serial}`, ...data } as Row; attachments.push(row); return row; }),
    },
    captureReview: { create: vi.fn(async ({ data }) => { reviews.push(data); return data; }) },
    mobileCaptureReceipt: { findFirst: mocks.receiptFind, create: vi.fn(async ({ data }) => { receipts.push(data); return data; }) },
  };
  mocks.transaction.mockImplementation(async (callback: (client: typeof tx) => Promise<unknown>) => callback(tx));
});

describe("notebook extraction", () => {
  it("normalizes model output: trims, keeps order, nulls bad fields", () => {
    expect(normalizeNotebookItems({ items: [
      { title: "  Call\n plumber ", notes: "  House stuff ", dueDate: "2026-11-07" },
      { title: "Email Dana", notes: 7, dueDate: "Friday" },
      { title: "Bad month", dueDate: "2026-13-01" },
      { title: "Not a real day", dueDate: "2026-02-30" },
    ] })).toEqual([
      { title: "Call plumber", notes: "House stuff", dueDate: "2026-11-07" },
      { title: "Email Dana", notes: null, dueDate: null },
      { title: "Bad month", notes: null, dueDate: null },
      { title: "Not a real day", notes: null, dueDate: null },
    ]);
  });
  it("drops entries without a usable title", () => {
    expect(normalizeNotebookItems({ items: [null, 3, "text", {}, { title: 5 }, { title: "   " }, { title: "?!" }, { title: "买牛奶" }] })).toEqual([{ title: "买牛奶", notes: null, dueDate: null }]);
  });
  it("treats a reply with no items array as a failed read, and an empty array as an empty page", () => {
    for (const reply of [null, "items", [], {}, { items: "none" }, { items: { title: "x" } }]) expect(() => normalizeNotebookItems(reply)).toThrow();
    expect(normalizeNotebookItems({ items: [] })).toEqual([]);
  });
  it("caps items per page and limits long fields", () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    const items = normalizeNotebookItems({ items: Array.from({ length: 55 }, (_, i) => ({ title: `Item ${i}`, notes: "n".repeat(5000) })) });
    expect(items).toHaveLength(MAX_NOTEBOOK_ITEMS); expect(items[39].title).toBe("Item 39"); expect(items[0].notes).toHaveLength(2000);
    expect(normalizeNotebookItems({ items: [{ title: "t".repeat(900) }] })[0].title).toHaveLength(500);
    warn.mockRestore();
  });
  it("resolves TODAY in New York, not UTC", () => {
    const eveningInNewYork = new Date("2026-11-04T02:30:00Z");
    expect(notebookSystem(eveningInNewYork)).toContain("TODAY is Tuesday, 2026-11-03.");
  });
  it("sends the page as an image block to the chosen model", async () => {
    modelReturns("Call plumber");
    await extractNotebookItems({ mediaType: "image/png", base64: "QUJD", note: "from the kitchen notebook" });
    const call = mocks.claude.mock.calls[0][0];
    expect(call).toMatchObject({ model: "claude-opus-5-5", effort: "high", refusalFallback: true });
    expect(call.messages[0].content[0]).toEqual({ type: "image", source: { type: "base64", media_type: "image/png", data: "QUJD" } });
    expect(call.messages[0].content[1].text).toContain("from the kitchen notebook");
  });
  it("normalizes titles for dedupe", () => {
    expect(normalizeTitle("  Call   the PLUMBER!! ")).toBe("call the plumber");
    expect(normalizeTitle("Dana's lease, (signed)")).toBe("danas lease signed");
    expect(normalizeTitle("买牛奶")).toBe("买牛奶");
    expect(normalizeTitle("...")).toBe("");
  });
});

describe("notebook capture", () => {
  it("creates one todo and one review per item, in page order, under the locks", async () => {
    modelReturns({ title: "Call plumber", notes: "House stuff", dueDate: "2026-11-07" }, "Email Dana");
    const result = await captureNotebook("alice", input());
    expect(result).toEqual({
      ok: true, id: todos[0].id, type: "todo", title: "2 items from your notebook", destination: "Inbox", path: "/",
      items: [{ id: todos[0].id, title: "Call plumber", dueDate: "2026-11-07", reviewId: reviewKey("alice", 0) }, { id: todos[1].id, title: "Email Dana", dueDate: null, reviewId: reviewKey("alice", 1) }], skipped: [],
    });
    expect(reviews.map(review => review.id)).toEqual(result.items.map(item => item.reviewId));
    // Inbox, in page order, each suggesting To Do.
    expect(todos.map(todo => [todo.title, todo.notes, todo.listId, todo.suggestedListId, todo.position, todo.projectId])).toEqual([["Call plumber", "House stuff", "list-inbox", "list-todo", 0, "project-inbox"], ["Email Dana", null, "list-inbox", "list-todo", 1, "project-inbox"]]);
    expect((todos[0].dueDate as Date).toISOString()).toBe("2026-11-07T00:00:00.000Z");
    expect(reviews).toHaveLength(2); expect(new Set(reviews.map(review => review.id)).size).toBe(2);
    expect(reviews.map(review => review.source)).toEqual(["ec", "ec"]);
    // A shared review would label the other todos "Supporting task".
    for (const [i, review] of reviews.entries()) {
      const placement = review.placement as Record<string, unknown>;
      expect(placement.id).toBe(todos[i].id); expect(placement.related).toBeUndefined();
      const effects = review.effects as { writes: Array<{ model: string; id: string }> };
      expect(effects.writes.map(write => write.model)).toEqual(["todo", "attachment"]);
      expect(effects.writes[0].id).toBe(todos[i].id);
    }
    expect(receipts).toHaveLength(1);
  });
  it("gives only the first todo the file attachment, and links the rest to the same URL", async () => {
    modelReturns("One", "Two", "Three");
    await captureNotebook("alice", input());
    expect(attachments.map(row => [row.todoId, row.kind, row.url, row.size])).toEqual([[todos[0].id, "file", BLOB, 7], [todos[1].id, "link", BLOB, null], [todos[2].id, "link", BLOB, null]]);
    expect(attachments.every(row => row.mimeType === "image/jpeg")).toBe(true);
    for (const [i, review] of reviews.entries()) {
      const files = (review.input as { files: Array<Record<string, unknown>> }).files;
      expect(files).toEqual([{ name: "page.jpg", mimeType: "image/jpeg", size: 7, url: BLOB, attachmentId: attachments[i].id }]);
    }
    expect(mocks.del).not.toHaveBeenCalled();
  });
  it("orders todos ascending and reviews descending, one millisecond apart", async () => {
    modelReturns("One", "Two", "Three");
    await captureNotebook("alice", input());
    const todoTimes = todos.map(row => (row.createdAt as Date).getTime()), reviewTimes = reviews.map(row => (row.createdAt as Date).getTime());
    expect(todoTimes[1] - todoTimes[0]).toBe(1); expect(todoTimes[2] - todoTimes[1]).toBe(1);
    expect(reviewTimes[0] - reviewTimes[1]).toBe(1); expect(reviewTimes[1] - reviewTimes[2]).toBe(1);
  });
  it("derives review ids from the user, the request and the item index", async () => {
    modelReturns("One", "Two");
    await captureNotebook("alice", input());
    const first = reviews.map(review => review.id);
    expect(first).toEqual([reviewKey("alice", 0), reviewKey("alice", 1)]);
    reviews.length = 0; receipts.length = 0; todos.length = 0;
    await captureNotebook("alice", input());
    expect(reviews.map(review => review.id)).toEqual(first);
    reviews.length = 0; receipts.length = 0; todos.length = 0;
    await captureNotebook("bob", input());
    expect(reviews.map(review => review.id)).not.toEqual(first);
  });
  it("replays the stored receipt without AI, upload or writes", async () => {
    modelReturns("One", "Two");
    const first = await captureNotebook("alice", input());
    const result = await captureNotebook("alice", input());
    expect(result).toEqual(first);
    expect(result.items.map(item => item.reviewId)).toEqual([reviewKey("alice", 0), reviewKey("alice", 1)]);
    expect(mocks.claude).toHaveBeenCalledTimes(1); expect(mocks.put).toHaveBeenCalledTimes(1); expect(mocks.transaction).toHaveBeenCalledTimes(1);
    expect(todos).toHaveLength(2); expect(reviews).toHaveLength(2);
  });
  it("answers 409 when a requestId returns with different content", async () => {
    modelReturns("One");
    await captureNotebook("alice", input());
    const changed = new File([new Uint8Array([0xff, 0xd8, 0xff, 0xe0, 9, 9, 9])], "page.jpg", { type: "image/jpeg" });
    await expect(captureNotebook("alice", input({ files: [changed] }))).rejects.toMatchObject({ status: 409 });
    await expect(captureNotebook("alice", input({ text: "added a note" }))).rejects.toMatchObject({ status: 409 });
    expect(mocks.claude).toHaveBeenCalledTimes(1);
  });
  it("cannot replay a receipt written by the normal capture route", async () => {
    const { mobileCaptureHash, mobileReceiptId } = await import("./mobile-capture-input");
    receipts.push({ id: mobileReceiptId("alice", requestId), userId: "alice", requestHash: await mobileCaptureHash(input()), result: { ok: true } });
    await expect(captureNotebook("alice", input())).rejects.toMatchObject({ status: 409 });
    expect(mocks.claude).not.toHaveBeenCalled();
  });
  it("rejects a wrong file count with 400 and an unsupported file with 415, before any AI", async () => {
    const png = new File([new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a])], "p.png", { type: "image/png" });
    await expect(captureNotebook("alice", input({ files: [] }))).rejects.toMatchObject({ status: 400 });
    await expect(captureNotebook("alice", input({ files: [jpeg(), png] }))).rejects.toMatchObject({ status: 400 });
    await expect(captureNotebook("alice", input({ files: [new File(["%PDF-1.7"], "a.pdf", { type: "application/pdf" })] }))).rejects.toMatchObject({ status: 415 });
    await expect(captureNotebook("alice", input({ files: [new File(["not an image"], "a.jpg", { type: "image/jpeg" })] }))).rejects.toMatchObject({ status: 415 });
    await expect(captureNotebook("alice", input({ files: [new File([png], "mismatch.jpg", { type: "image/jpeg" })] }))).rejects.toMatchObject({ status: 415 });
    expect(mocks.claude).not.toHaveBeenCalled();
  });
  it("accepts each supported image type", async () => {
    modelReturns("One");
    const webp = new Uint8Array([0x52, 0x49, 0x46, 0x46, 0, 0, 0, 0, 0x57, 0x45, 0x42, 0x50]), gif = new TextEncoder().encode("GIF89a"), png = new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
    for (const [bytes, type] of [[webp, "image/webp"], [gif, "image/gif"], [png, "image/png"]] as const) {
      receipts.length = 0; todos.length = 0;
      await expect(captureNotebook("alice", input({ files: [new File([new Uint8Array(bytes)], "p", { type })] }))).resolves.toMatchObject({ ok: true });
    }
  });
  it("answers 422 for a page with no items and writes nothing, so a retry re-reads", async () => {
    mocks.claude.mockResolvedValue({ items: [] });
    await expect(captureNotebook("alice", input())).rejects.toMatchObject({ status: 422, message: "No items found on this page. Try again with more light, or from straight above." });
    expect(mocks.put).not.toHaveBeenCalled(); expect(mocks.transaction).not.toHaveBeenCalled();
    modelReturns("Now it can read");
    await expect(captureNotebook("alice", input())).resolves.toMatchObject({ title: "1 item from your notebook" });
  });
  it("answers 502 when extraction fails, with the page still retryable", async () => {
    const error = vi.spyOn(console, "error").mockImplementation(() => {});
    for (const failure of [() => mocks.claude.mockRejectedValue(new Error("Claude error 529")), () => mocks.claude.mockResolvedValue({ nope: true })]) {
      failure();
      await expect(captureNotebook("alice", input())).rejects.toMatchObject({ status: 502, message: expect.stringContaining("Your capture is safe on this device; try again.") });
    }
    expect(mocks.put).not.toHaveBeenCalled(); expect(mocks.transaction).not.toHaveBeenCalled();
    error.mockRestore();
  });
  it("skips an item matching an open todo in any list, ignoring case and punctuation", async () => {
    const open = existing("call the Plumber!", { listId: "another-list" });
    modelReturns("Call the plumber", "Email Dana");
    const result = await captureNotebook("alice", input());
    expect(result.skipped).toEqual(["Call the plumber"]);
    expect(result.items.map(item => item.title)).toEqual(["Email Dana"]);
    expect(result.title).toBe("1 item from your notebook");
    expect(result.id).toBe(result.items[0].id); expect(result.id).not.toBe(open.id);
  });
  it("skips an item completed within 30 days but not one completed long ago", async () => {
    existing("Recently done", { completedAt: new Date(Date.now() - 29 * DAY) });
    existing("Done long ago", { completedAt: new Date(Date.now() - 31 * DAY) });
    modelReturns("Recently done", "Done long ago");
    const result = await captureNotebook("alice", input());
    expect(result.skipped).toEqual(["Recently done"]);
    expect(result.items.map(item => item.title)).toEqual(["Done long ago"]);
  });
  it("does not dedupe against another user's todos", async () => {
    existing("Call plumber", { userId: "bob" });
    modelReturns("Call plumber");
    expect((await captureNotebook("alice", input())).items).toHaveLength(1);
  });
  it("dedupes within the page and attaches the photo to the first item that is created", async () => {
    existing("Already here");
    modelReturns("Already here", "Call plumber", "call plumber.", "Email Dana");
    const result = await captureNotebook("alice", input());
    expect(result.items.map(item => item.title)).toEqual(["Call plumber", "Email Dana"]);
    expect(result.skipped).toEqual(["Already here", "call plumber."]);
    expect(attachments.map(row => row.kind)).toEqual(["file", "link"]);
    expect(attachments[0].todoId).toBe(result.items[0].id);
    expect(reviews.map(review => (review.proposal as { title: string }).title)).toEqual(["Call plumber", "Email Dana"]);
    // Ids follow the page index, so skipped lines leave gaps.
    expect(result.items.map(item => item.reviewId)).toEqual([reviewKey("alice", 1), reviewKey("alice", 3)]);
    expect(reviews.map(review => review.id)).toEqual(result.items.map(item => item.reviewId));
  });
  it("still succeeds when every item is a duplicate, and deletes the unreferenced photo", async () => {
    const first = existing("Call plumber"); existing("Email Dana");
    modelReturns("Call plumber", "Email Dana");
    const result = await captureNotebook("alice", input());
    expect(result).toEqual({ ok: true, id: first.id, type: "todo", title: "Already on your list", destination: "Inbox", path: "/", items: [], skipped: ["Call plumber", "Email Dana"] });
    expect(mocks.del).toHaveBeenCalledWith(BLOB);
    expect(attachments).toEqual([]); expect(reviews).toEqual([]); expect(receipts).toHaveLength(1);
    mocks.del.mockClear();
    expect(await captureNotebook("alice", input())).toEqual(result);
    expect(mocks.put).toHaveBeenCalledTimes(1); expect(mocks.del).not.toHaveBeenCalled();
  });
  it("deletes the photo when the transaction fails", async () => {
    modelReturns("One");
    mocks.transaction.mockRejectedValueOnce(new Error("database down"));
    await expect(captureNotebook("alice", input())).rejects.toThrow("database down");
    expect(mocks.del).toHaveBeenCalledWith(BLOB);
  });
  it("deletes its own photo and returns the winner's receipt when a concurrent retry got there first", async () => {
    modelReturns("One");
    const won = await captureNotebook("carol", input());
    const { mobileReceiptId } = await import("./mobile-capture-input");
    const receipt = { id: mobileReceiptId("alice", requestId), userId: "alice", requestHash: receipts[0].requestHash, result: won };
    attachments.length = 0;
    mocks.receiptFind.mockResolvedValueOnce(null).mockResolvedValueOnce(receipt);
    await expect(captureNotebook("alice", input())).resolves.toEqual(won);
    expect(mocks.del).toHaveBeenCalledWith(BLOB);
  });
  it("enforces the storage quota before reading the page", async () => {
    mocks.aggregate.mockResolvedValue({ _sum: { size: 1024 * 1024 * 1024 } });
    await expect(captureNotebook("alice", input())).rejects.toMatchObject({ status: 413 });
    expect(mocks.claude).not.toHaveBeenCalled();
  });
  it("keeps the typed note out of the todo but on the review and in the prompt", async () => {
    modelReturns("One");
    await captureNotebook("alice", input({ text: "kitchen notebook" }));
    expect(todos[0].notes).toBeNull();
    expect((reviews[0].input as { text: string }).text).toBe("kitchen notebook");
    expect(mocks.claude.mock.calls[0][0].messages[0].content[1].text).toContain("kitchen notebook");
  });
});

describe("response contract", () => {
  // The iOS client decodes this body. Changing it needs a matching client change.
  it("returns exactly this JSON for a happy path, through the real route", async () => {
    existing("Email Dana");
    modelReturns({ title: "Call plumber", notes: "House stuff", dueDate: "2026-11-07" }, "Buy milk", "Book dentist", "Email Dana");
    const form = new FormData();
    form.append("requestId", requestId); form.append("text", ""); form.append("file", jpeg());
    const response = await POST(new Request("https://example.com/api/capture/mobile/notebook", { method: "POST", headers: { authorization: "Bearer example" }, body: form }));
    expect(response.status).toBe(200);
    expect(JSON.stringify(await response.json(), null, 2)).toBe(`{
  "ok": true,
  "id": "todo-2",
  "type": "todo",
  "title": "3 items from your notebook",
  "destination": "Inbox",
  "path": "/",
  "items": [
    {
      "id": "todo-2",
      "title": "Call plumber",
      "dueDate": "2026-11-07",
      "reviewId": "${reviewKey("alice", 0)}"
    },
    {
      "id": "todo-4",
      "title": "Buy milk",
      "dueDate": null,
      "reviewId": "${reviewKey("alice", 1)}"
    },
    {
      "id": "todo-6",
      "title": "Book dentist",
      "dueDate": null,
      "reviewId": "${reviewKey("alice", 2)}"
    }
  ],
  "skipped": [
    "Email Dana"
  ]
}`);
  });
});

describe("correcting a notebook-created todo", () => {
  it("carries both file and link page attachments by id", async () => {
    const rows: Record<string, Row> = {
      a: { id: "a", userId: "alice", kind: "file", title: "Notebook page", url: BLOB, mimeType: "image/jpeg", size: 7 },
      b: { id: "b", userId: "alice", kind: "link", title: "Notebook page", url: BLOB, mimeType: "image/jpeg", size: null },
    };
    const tx = { attachment: { findFirst: vi.fn(async ({ where }) => rows[where.id]) } } as unknown as Prisma.TransactionClient;
    const write = (row: Row) => ({ model: "attachment" as const, id: row.id, action: "create" as const, before: null, after: row as never, fields: [] });
    const input = { text: "", url: null, files: [{ name: "page.jpg", mimeType: "image/jpeg", size: 7, url: BLOB }] };
    for (const row of [rows.a, rows.b]) {
      const files = await capturedFiles(tx, "alice", { version: 1, writes: [write(row)] }, input);
      expect(files).toEqual([{ attachmentId: row.id, url: BLOB, file: { name: "Notebook page", type: "image/jpeg", size: row.size ?? 0 } }]);
    }
  });
});
