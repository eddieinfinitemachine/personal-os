import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { readEffects } from "./journal";
import { PrismaClient } from "@prisma/client";
import { randomUUID } from "node:crypto";
const state = vi.hoisted(() => ({ db: null as PrismaClient | null, userId: "", parse: vi.fn(), extract: vi.fn(), kindle: vi.fn(), tags: vi.fn(), after: vi.fn() }));
vi.mock("@/lib/prisma", () => ({ get prisma() { if (!state.db) throw new Error("Test db not initialized"); return state.db; } }));
vi.mock("@/lib/auth", () => ({ getCurrentUserId: async () => state.userId, getSession: async () => ({ userId: state.userId }) }));
vi.mock("@/lib/capture-auth", () => ({ resolveCaptureUser: async () => state.userId }));
vi.mock("@/lib/smart-capture", () => ({ parseCapture: state.parse }));
vi.mock("@/lib/gcal", () => ({ syncRecentTodos: vi.fn() }));
vi.mock("@/lib/reader-extract", () => ({ extractArticle: state.extract, extractArticleFromHtml: state.extract }));
vi.mock("@/lib/kindle-send", () => ({ sendReaderItemToKindle: state.kindle }));
vi.mock("@/lib/board-tags", () => ({ tagInBackground: state.tags }));
vi.mock("next/server", async original => ({ ...await original<typeof import("next/server")>(), after: state.after }));
import { POST as web } from "@/app/api/capture/smart/commit/route";
import { POST as auto } from "@/app/api/capture/smart/auto/route";
import { POST as legacy } from "@/app/api/capture/todo/route";
import { POST as board } from "@/app/api/board/route";
import { POST as reader } from "@/app/api/reader/route";
import { correctCaptureReview } from "./correct";
const databaseUrl = process.env.CAPTURE_REVIEW_TEST_DATABASE_URL;
const users: string[] = [];
function request(path: string, body: unknown, source?: string, id = randomUUID()) { return new Request(`http://localhost${path}`, { method: "POST", headers: { "Content-Type": "application/json", "X-Capture-ID": id, ...(source ? { "X-Capture-Source": source } : {}) }, body: JSON.stringify(body) }); }
describe.skipIf(!databaseUrl)("manual capture intake — real Postgres", () => {
  beforeAll(async () => {
    const url = new URL(databaseUrl!);
    if (!["127.0.0.1", "localhost"].includes(url.hostname) || !url.pathname.startsWith("/capture_review_test")) throw new Error("Scratch db required");
    state.db = new PrismaClient({ datasourceUrl: databaseUrl });
  });
  afterAll(async () => { if (state.db) { await state.db.user.deleteMany({ where: { id: { in: users } } }); await state.db.$disconnect(); } });
  async function user() { state.userId = `capture-intake-test-${randomUUID()}`; users.push(state.userId); await state.db!.user.create({ data: { id: state.userId, email: `${state.userId}@example.test` } }); state.after.mockClear(); return state.userId; }
  it.each([{ route: web, source: "web" }, { route: auto, source: "mac" }, { route: legacy, source: "chrome" }] as const)("creates exactly one review on keyed retries for source $source", async ({ route, source }) => {
    const userId = await user(), id = randomUUID();
    state.parse.mockResolvedValue({ type: "person", firstName: "Synthetic", lastName: "Person" });
    const body = route === web ? { proposal: { type: "person", firstName: "Synthetic", lastName: "Person" }, text: "Add Synthetic Person" } : route === auto ? { text: "Add Synthetic Person" } : { title: "Synthetic legacy task" };
    const first = await route(request("/capture", body, source, id));
    expect(first.status).toBe(200);
    const initial = await first.json();
    expect((await route(request("/capture", body, source, id))).status).toBe(200);
    const reviews = await state.db!.captureReview.findMany({ where: { userId } });
    expect(reviews).toHaveLength(1); expect(reviews[0].source).toBe(source);
    expect(initial).toHaveProperty("reviewId", reviews[0].id);
    expect(await state.db!.person.count({ where: { userId } })).toBe(route === legacy ? 0 : 1);
    expect(await state.db!.todo.count({ where: { userId } })).toBe(route === web ? 0 : 1);
  });
  it("commits call-sheet person resolution and reminder provenance in the same review", async () => {
    const userId = await user(), id = randomUUID();
    const date = new Date(Date.now() + 3 * 86400000).toISOString().slice(0, 10);
    state.parse.mockResolvedValue({ type: "call_sheet", firstName: "Synthetic", lastName: "Reminder", date, note: "The lease" });
    const body = { text: "Put Synthetic Reminder on the call sheet" };
    expect((await auto(request("/capture", body, "mac", id))).status).toBe(200);
    expect((await auto(request("/capture", body, "mac", id))).status).toBe(200);
    const review = await state.db!.captureReview.findFirstOrThrow({ where: { userId } });
    expect(review.placement).toMatchObject({ type: "call_sheet" });
    expect(readEffects(review.effects)!.writes.map(item => item.model)).toEqual(["person", "callSheetContact"]);
    expect(await state.db!.callSheetContact.count({ where: { userId } })).toBe(1);
  });
  it("rolls back Reader domain writes if its review cannot be persisted", async () => {
    const userId = await user();
    state.extract.mockResolvedValue({ title: "Atomic Reader", byline: null, siteName: null, excerpt: null, imageUrl: null, contentHtml: "<p>Text</p>", wordCount: 10 });
    const original = state.db!;
    state.db = original.$extends({ query: { captureReview: { create: async () => { throw new Error("Synthetic review failure"); } } } }) as unknown as PrismaClient;
    const error = vi.spyOn(console, "error").mockImplementation(() => {});
    try {
      expect((await reader(request("/reader", { url: "https://example.test/atomic" }))).status).toBe(500);
      expect(await original.readerItem.count({ where: { userId } })).toBe(0);
    } finally { state.db = original; error.mockRestore(); }
  });
  it("retains unkeyed intentional repeated saves as separate reviews", async () => {
    const userId = await user();
    const input = () => new Request("http://localhost/capture", { method: "POST", body: JSON.stringify({ title: "Intentional repeat" }) });
    expect((await legacy(input())).status).toBe(200); expect((await legacy(input())).status).toBe(200);
    expect(await state.db!.captureReview.count({ where: { userId } })).toBe(2);
  });
  it("records Board merge provenance and replays without another bump", async () => {
    const userId = await user(), id = randomUUID();
    const existing = await state.db!.boardItem.create({ data: { userId, kind: "link", url: "https://example.test/board", note: "Original" } });
    const body = { url: existing.url, note: "New note", via: "extension" };
    expect((await board(request("/board", body, "chrome", id))).status).toBe(200);
    expect(await state.db!.captureReview.count({ where: { userId } })).toBe(1);
    const review = await state.db!.captureReview.findFirstOrThrow({ where: { userId } });
    expect(readEffects(review.effects)!.writes).toMatchObject([{ model: "boardItem", action: "update", before: { note: "Original" }, after: { note: "Original\n\nNew note" } }]);
    const saved = await state.db!.boardItem.findUniqueOrThrow({ where: { id: existing.id } });
    expect((await board(request("/board", body, "chrome", id))).status).toBe(200);
    expect((await state.db!.boardItem.findUniqueOrThrow({ where: { id: existing.id } })).savedAt).toEqual(saved.savedAt);
    expect(state.tags).not.toHaveBeenCalled();
  });
  it("replays Reader before extraction and never schedules a second Kindle delivery", async () => {
    const userId = await user(), id = randomUUID();
    await state.db!.user.update({ where: { id: userId }, data: { kindleEmail: "synthetic@kindle.com", kindleAutoSend: true } });
    state.extract.mockResolvedValue({ title: "Synthetic article", byline: null, siteName: "Synthetic", excerpt: "Excerpt", imageUrl: null, contentHtml: "<p>Text</p>", wordCount: 10 });
    state.extract.mockClear();
    const body = { url: "https://example.test/reader" };
    expect((await reader(request("/reader", body, "chrome", id))).status).toBe(200);
    expect((await reader(request("/reader", body, "chrome", id))).status).toBe(200);
    expect(await state.db!.captureReview.count({ where: { userId } })).toBe(1);
    expect(await state.db!.readerItem.count({ where: { userId } })).toBe(1);
    expect(state.extract).toHaveBeenCalledTimes(1); expect(state.after).toHaveBeenCalledTimes(1);
  });
  it("never leaks a companion's private later title through a keyed web retry after shared-list revocation", async () => {
    const userId = await user(), id = randomUUID(), ownerId = `capture-intake-test-${randomUUID()}`;
    users.push(ownerId); await state.db!.user.create({ data: { id: ownerId, email: ownerId + "@example.test" } });
    const body = { proposal: { type: "asset", assetKind: "inventory", title: "Camera", followupTodo: { title: "Get a camera case" } }, text: "My camera" };
    const first = await web(request("/capture", body, "web", id));
    expect(first.status).toBe(200); const saved = await first.json();
    const list = await state.db!.list.create({ data: { userId: ownerId, name: "Shared" } });
    await state.db!.listMember.create({ data: { userId, listId: list.id, role: "editor" } });
    await state.db!.todo.update({ where: { id: saved.followupTodo.id }, data: { listId: list.id } });
    await state.db!.listMember.deleteMany({ where: { userId, listId: list.id } });
    await state.db!.todo.update({ where: { id: saved.followupTodo.id }, data: { title: "PRIVATE TITLE AFTER REVOCATION" } });
    const replay = await web(request("/capture", body, "web", id));
    expect(replay.status).toBe(200); const result = await replay.json();
    expect(result.followupTodo).toBeNull(); expect(JSON.stringify(result)).not.toContain("PRIVATE TITLE");
  });
  it("retains original web photo metadata and reuses its URL when corrected into a task", async () => {
    const userId = await user(), id = randomUUID();
    const photo = "https://blob.example.test/original-photo.jpeg";
    const response = await web(request("/capture", { proposal: { type: "asset", assetKind: "inventory", title: "Camera", photoUrl: photo }, input: { text: "My original camera capture", url: null, files: [{ name: "camera.jpeg", url: photo, mimeType: "image/jpeg", size: 1234 }] } }, "web", id));
    expect(response.status).toBe(200);
    const review = await state.db!.captureReview.findFirstOrThrow({ where: { userId } });
    expect(review.input).toMatchObject({ text: "My original camera capture", files: [{ name: "camera.jpeg", url: photo, mimeType: "image/jpeg", size: 1234 }] });
    const corrected = await correctCaptureReview(userId, review.id, { revision: 1, proposal: { type: "todo", title: "Store the camera photo" } });
    expect(await state.db!.attachment.findFirst({ where: { userId, todoId: corrected.placement.id } })).toMatchObject({ url: photo, size: 1234, mimeType: "image/jpeg" });
  });
});
