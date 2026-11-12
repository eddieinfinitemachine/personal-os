import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { PrismaClient } from "@prisma/client";
import { randomUUID } from "node:crypto";

const state = vi.hoisted(() => ({ db: null as PrismaClient | null, claude: vi.fn(), parse: vi.fn(), put: vi.fn(), del: vi.fn() }));
vi.mock("@/lib/prisma", () => ({ get prisma() { if (!state.db) throw new Error("Test database not initialized"); return state.db; } }));
vi.mock("@/lib/claude", () => ({ callClaudeJSON: state.claude }));
vi.mock("@/lib/smart-capture", () => ({ parseCapture: state.parse }));
vi.mock("@vercel/blob", () => ({ put: state.put, del: state.del }));
import { captureNotebook } from "@/lib/notebook-capture";
import { captureMobile } from "@/lib/mobile-capture";
import { captureKey } from "./capture-review/record";
import { correctCaptureReview } from "./capture-review/correct";
import { listCaptureReviews } from "./capture-review/read";

const databaseUrl = process.env.CAPTURE_REVIEW_TEST_DATABASE_URL;
const users: string[] = [];
const DAY = 24 * 60 * 60 * 1000;
const jpeg = () => new File([new Uint8Array([0xff, 0xd8, 0xff, 0xe0, 1, 2, 3])], "page.jpg", { type: "image/jpeg" });
const homeOrder = [{ dueDate: "asc" as const }, { position: "asc" as const }, { createdAt: "asc" as const }];

describe.skipIf(!databaseUrl)("notebook capture — real Postgres", () => {
  beforeAll(() => {
    const url = new URL(databaseUrl!);
    if (!["127.0.0.1", "localhost"].includes(url.hostname) || !url.pathname.startsWith("/capture_review_test")) throw new Error("Integration tests require the isolated local scratch database");
    state.db = new PrismaClient({ datasourceUrl: databaseUrl });
  });
  afterAll(async () => {
    if (state.db) { await state.db.user.deleteMany({ where: { id: { in: users } } }); await state.db.$disconnect(); }
  });
  beforeEach(() => {
    vi.resetAllMocks();
    state.put.mockImplementation(async () => ({ url: `https://blob.example.test/${randomUUID()}` }));
    state.del.mockResolvedValue(undefined);
  });
  async function user() {
    const id = "notebook-test-" + randomUUID();
    await state.db!.user.create({ data: { id, email: id + "@example.test" } }); users.push(id); return id;
  }
  function modelReturns(...titles: string[]) { state.claude.mockResolvedValue({ items: titles.map(title => ({ title, notes: null, dueDate: null })) }); }
  const page = (requestId = randomUUID()) => ({ requestId, text: "", url: null, files: [jpeg()] });
  const reviewId = (userId: string, requestId: string, index: number) => captureKey(userId, `notebook:${index}`, requestId);

  it("commits a full 40-item page within the transaction budget, in page order everywhere", async () => {
    const userId = await user();
    const titles = Array.from({ length: 40 }, (_, i) => `Page item ${i + 1}`);
    modelReturns(...titles);
    const input = page();
    const started = Date.now();
    const result = await captureNotebook(userId, input);
    const elapsed = Date.now() - started;
    console.info(`notebook capture: 40 items committed in ${elapsed} ms on local Postgres`);
    expect(elapsed).toBeLessThan(20_000);
    expect(result.items.map(item => item.title)).toEqual(titles);
    expect(result.items.map(item => item.reviewId)).toEqual(titles.map((_, i) => reviewId(userId, input.requestId, i)));
    expect(await state.db!.captureReview.count({ where: { userId, id: { in: result.items.map(item => item.reviewId) } } })).toBe(40);

    const onHome = await state.db!.todo.findMany({ where: { userId, completedAt: null, parentId: null }, orderBy: homeOrder, include: { list: true } });
    expect(onHome.map(todo => todo.title)).toEqual(titles);
    expect(new Set(onHome.map(todo => todo.createdAt.getTime())).size).toBe(40);
    expect(onHome.every(todo => todo.list.name === "Inbox")).toBe(true);

    const inbox: string[] = [];
    for (let offset = 0; offset < 40; offset += 10) inbox.push(...(await listCaptureReviews(userId, { offset, limit: 10 })).items.map(item => item.placement.title));
    expect(inbox).toEqual(titles);

    const rows = await state.db!.attachment.findMany({ where: { userId } });
    expect(rows.filter(row => row.kind === "file")).toHaveLength(1);
    expect(rows.filter(row => row.kind === "link")).toHaveLength(39);
    expect(new Set(rows.map(row => row.url)).size).toBe(1);
    expect(rows.find(row => row.kind === "file")!.todoId).toBe(result.id);
    expect((await state.db!.attachment.aggregate({ where: { userId, kind: "file" }, _sum: { size: true } }))._sum.size).toBe(7);

    expect(await captureNotebook(userId, input)).toEqual(result);
    expect(await state.db!.todo.count({ where: { userId } })).toBe(40);
    expect(await state.db!.captureReview.count({ where: { userId } })).toBe(40);
    expect(await state.db!.mobileCaptureReceipt.count({ where: { userId } })).toBe(1);
    expect(state.claude).toHaveBeenCalledTimes(1);
  }, 60_000);

  it.each([["link", 1], ["file", 0]] as const)("moves the %s attachment when its item is corrected into an asset", async (kind, index) => {
    const userId = await user();
    modelReturns("Wrong: first line", "Wrong: second line");
    const input = page();
    const result = await captureNotebook(userId, input);
    const before = await state.db!.attachment.findFirstOrThrow({ where: { userId, todoId: result.items[index].id } });
    expect(before.kind).toBe(kind);

    const id = reviewId(userId, input.requestId, index);
    const corrected = await correctCaptureReview(userId, id, { revision: 1, proposal: { type: "asset", assetKind: "inventory", title: "Actually a drill" } });
    expect(corrected.placement).toMatchObject({ type: "asset", title: "Actually a drill" });

    const moved = await state.db!.attachment.findUniqueOrThrow({ where: { id: before.id } });
    expect(moved).toMatchObject({ kind, todoId: null, assetId: corrected.placement.id, url: before.url });
    expect(await state.db!.attachment.count({ where: { userId, url: before.url } })).toBe(2);
    expect(await state.db!.attachment.count({ where: { userId, url: before.url, kind: "file" } })).toBe(1);
    expect((await state.db!.asset.findUniqueOrThrow({ where: { id: corrected.placement.id } })).imageUrl).toBe(before.url);
    expect((await state.db!.todo.findUniqueOrThrow({ where: { id: result.items[index].id } })).droppedAt).not.toBeNull();
    const other = await state.db!.todo.findUniqueOrThrow({ where: { id: result.items[1 - index].id } });
    expect(other.completedAt).toBeNull();

    const back = await correctCaptureReview(userId, id, { revision: 2, proposal: { type: "todo", title: "A todo after all" } });
    expect(back.placement).toMatchObject({ type: "todo", title: "A todo after all" });
    expect(await state.db!.attachment.findUniqueOrThrow({ where: { id: before.id } })).toMatchObject({ kind, todoId: back.placement.id, assetId: null });
  });

  it("corrects a misread title in place, keeping the attachment and the page order", async () => {
    const userId = await user();
    modelReturns("Call plumber", "Emial Dana", "Book dentist");
    const input = page();
    const result = await captureNotebook(userId, input);
    const corrected = await correctCaptureReview(userId, reviewId(userId, input.requestId, 1), { revision: 1, proposal: { type: "todo", title: "Email Dana" } });
    expect(corrected.placement.id).toBe(result.items[1].id);
    const onHome = await state.db!.todo.findMany({ where: { userId, completedAt: null }, orderBy: homeOrder, include: { attachments: true } });
    expect(onHome.map(todo => todo.title)).toEqual(["Call plumber", "Email Dana", "Book dentist"]);
    expect(onHome.map(todo => todo.attachments.map(row => row.kind))).toEqual([["file"], ["link"], ["link"]]);
  });

  it("dedupes against real rows: any list, open or recently completed, not long-completed", async () => {
    const userId = await user();
    const other = await state.db!.list.create({ data: { userId, name: "Elsewhere" } });
    const open = await state.db!.todo.create({ data: { userId, listId: other.id, title: "Call  the plumber!" } });
    await state.db!.todo.create({ data: { userId, listId: other.id, title: "Done recently", completedAt: new Date(Date.now() - 10 * DAY) } });
    await state.db!.todo.create({ data: { userId, listId: other.id, title: "Done long ago", completedAt: new Date(Date.now() - 45 * DAY) } });
    const stranger = await user();
    const strangerList = await state.db!.list.create({ data: { userId: stranger, name: "Theirs" } });
    await state.db!.todo.create({ data: { userId: stranger, listId: strangerList.id, title: "Someone else's task" } });

    modelReturns("call the plumber", "Done recently", "Done long ago", "Someone else's task", "done long ago.");
    const result = await captureNotebook(userId, page());
    expect(result.items.map(item => item.title)).toEqual(["Done long ago", "Someone else's task"]);
    expect(result.skipped).toEqual(["call the plumber", "Done recently", "done long ago."]);

    modelReturns("call the plumber", "Done recently");
    const url = "https://blob.example.test/unreferenced";
    state.put.mockResolvedValue({ url });
    const all = await captureNotebook(userId, page());
    expect(all).toMatchObject({ id: open.id, title: "Already on your list", items: [], skipped: ["call the plumber", "Done recently"] });
    expect(state.del).toHaveBeenCalledWith(url);
    expect(await state.db!.attachment.count({ where: { userId, url } })).toBe(0);
  });

  it("serializes two different requests for one page, so the second finds only duplicates", async () => {
    const userId = await user();
    modelReturns("Call plumber", "Email Dana");
    const [a, b] = await Promise.all([captureNotebook(userId, page()), captureNotebook(userId, page())]);
    expect([a.items.length, b.items.length].sort()).toEqual([0, 2]);
    expect(await state.db!.todo.count({ where: { userId } })).toBe(2);
    expect(state.del).toHaveBeenCalledTimes(1);
  });

  it("refuses a requestId used on the other capture route, in both directions", async () => {
    const userId = await user();
    state.parse.mockResolvedValue({ type: "todo", title: "Normal capture" });
    modelReturns("Notebook item");
    const shared = page();
    await captureNotebook(userId, shared);
    await expect(captureMobile(userId, shared)).rejects.toMatchObject({ status: 409 });
    const normal = { ...page(), text: "hello", files: [] as File[] };
    await captureMobile(userId, normal);
    await expect(captureNotebook(userId, { ...normal, files: [jpeg()] })).rejects.toMatchObject({ status: 409 });
    expect(state.parse).toHaveBeenCalledTimes(1);
  });
});
