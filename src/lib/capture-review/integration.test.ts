import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { PrismaClient } from "@prisma/client";
import { randomUUID } from "node:crypto";

const state = vi.hoisted(() => ({ db: null as PrismaClient | null, parse: vi.fn(), put: vi.fn(), del: vi.fn(), files: new Map<string, Uint8Array>() }));
vi.mock("@/lib/prisma", () => ({ get prisma() { if (!state.db) throw new Error("Test database not initialized"); return state.db; } }));
vi.mock("@/lib/smart-capture", () => ({ parseCapture: state.parse }));
vi.mock("@vercel/blob", () => ({ put: state.put, del: state.del }));
import { captureMobile } from "@/lib/mobile-capture";
import { listCaptureReviews } from "./read";
import { setReviewDismissal } from "./mutate";
import { correctCaptureReview } from "./correct";
import { withCaptureReview } from "./record";
import { commitCallSheetCapture } from "./intake";

const databaseUrl = process.env.CAPTURE_REVIEW_TEST_DATABASE_URL;
const users: string[] = [];
describe.skipIf(!databaseUrl)("capture review — real Postgres", () => {
  beforeAll(() => {
    const url = new URL(databaseUrl!);
    if (!["127.0.0.1", "localhost"].includes(url.hostname) || !url.pathname.startsWith("/capture_review_test")) throw new Error("Integration tests require the isolated local scratch database");
    state.db = new PrismaClient({ datasourceUrl: databaseUrl });
    state.put.mockImplementation(async (_path: string, file: File) => { const url = `https://blob.example.test/${randomUUID()}`; state.files.set(url, new Uint8Array(await file.arrayBuffer())); return { url }; });
    state.del.mockResolvedValue(undefined);
  });
  afterAll(async () => {
    if (state.db) { await state.db.user.deleteMany({ where: { id: { in: users } } }); await state.db.$disconnect(); }
  });
  async function user() {
    const id = "capture-review-test-" + randomUUID();
    await state.db!.user.create({ data: { id, email: id + "@example.test" } }); users.push(id); return id;
  }
  function signal() { let resolve!: () => void; const promise = new Promise<void>(done => { resolve = done; }); return { promise, resolve }; }
  async function waitForLock(queryPart: string) {
    for (let attempt = 0; attempt < 200; attempt++) {
      const waiting = await state.db!.$queryRaw<Array<{ query: string }>>`SELECT query FROM pg_stat_activity WHERE datname = current_database() AND wait_event_type = 'Lock'`;
      if (waiting.some(row => row.query.includes(queryPart))) return;
      await new Promise(done => setTimeout(done, 5));
    }
    throw new Error(`The correction never reached the expected ${queryPart} lock`);
  }
  it("atomically retains one review and one organized item across mobile retry", async () => {
    const userId = await user();
    state.parse.mockResolvedValue({ type: "todo", title: "Synthetic capture review task" });
    const input = { requestId: randomUUID(), text: "Synthetic capture review task", url: null, files: [] };
    const first = await captureMobile(userId, input);
    expect(await state.db!.captureReview.count({ where: { userId } })).toBe(1);
    expect(await state.db!.todo.count({ where: { userId } })).toBe(1);
    expect(await captureMobile(userId, input)).toEqual(first);
    expect(await state.db!.captureReview.count({ where: { userId } })).toBe(1);
    expect(await state.db!.todo.count({ where: { userId } })).toBe(1);
    const review = await state.db!.captureReview.findFirstOrThrow({ where: { userId } });
    expect(review.source).toBe("ec");
    expect(review.placement).toMatchObject({ type: "todo", id: first.id });
  });
  it("resolves ordinary destination moves and renames without stale placement text", async () => {
    const userId = await user();
    state.parse.mockResolvedValue({ type: "todo", title: "Move me" });
    const saved = await captureMobile(userId, { requestId: randomUUID(), text: "Move me", url: null, files: [] });
    const list = await state.db!.list.create({ data: { userId, name: "Review test list" } });
    const project = await state.db!.project.create({ data: { userId, name: "Review test project" } });
    await state.db!.todo.update({ where: { id: saved.id }, data: { listId: list.id, projectId: project.id, title: "Changed outside Inbox" } });
    await state.db!.list.update({ where: { id: list.id }, data: { name: "Renamed list" } });
    const result = await listCaptureReviews(userId);
    expect(result.items[0].placement).toMatchObject({ title: "Changed outside Inbox", destination: "Review test project → Renamed list", path: `/projects/${project.id}` });
  });
  it("dismisses and restores only review state with ownership and revision guards", async () => {
    const userId = await user(), stranger = await user();
    state.parse.mockResolvedValue({ type: "todo", title: "Keep the actual item" });
    const saved = await captureMobile(userId, { requestId: randomUUID(), text: "Keep the actual item", url: null, files: [] });
    const review = await state.db!.captureReview.findFirstOrThrow({ where: { userId } });
    await expect(setReviewDismissal(stranger, review.id, 1, true)).rejects.toMatchObject({ status: 404 });
    const dismissed = await setReviewDismissal(userId, review.id, 1, true);
    expect(dismissed.revision).toBe(2); expect(dismissed.dismissedAt).not.toBeNull();
    expect(await state.db!.todo.count({ where: { id: saved.id, userId } })).toBe(1);
    expect((await listCaptureReviews(userId)).items).toHaveLength(0);
    await expect(setReviewDismissal(userId, review.id, 1, false)).rejects.toMatchObject({ status: 409 });
    const restored = await setReviewDismissal(userId, review.id, 2, false);
    expect(restored.dismissedAt).toBeNull(); expect(restored.revision).toBe(3);
    expect((await listCaptureReviews(userId)).items).toHaveLength(1);
  });
  it("corrects a task in place, validates list ownership, and keeps keyed replay current", async () => {
    const userId = await user(), stranger = await user();
    state.parse.mockResolvedValue({ type: "todo", title: "Original task" });
    const input = { requestId: randomUUID(), text: "Original task", url: null, files: [] };
    const saved = await captureMobile(userId, input);
    const review = await state.db!.captureReview.findFirstOrThrow({ where: { userId } });
    const list = await state.db!.list.create({ data: { userId, name: "Correct list" } });
    const foreign = await state.db!.list.create({ data: { userId: stranger, name: "Other account" } });
    await expect(correctCaptureReview(userId, review.id, { revision: 1, proposal: { type: "todo", title: "Corrected task" }, fields: { listId: foreign.id, projectId: null } })).rejects.toMatchObject({ status: 404 });
    const corrected = await correctCaptureReview(userId, review.id, { revision: 1, proposal: { type: "todo", title: "Corrected task", notes: "Updated intentionally" }, fields: { listId: list.id, projectId: null } });
    expect(corrected.placement).toMatchObject({ id: saved.id, title: "Corrected task", destination: "Correct list" });
    expect(corrected.revision).toBe(2); expect(corrected.correctedAt).not.toBeNull();
    const repeated = await captureMobile(userId, input);
    expect(repeated).toMatchObject({ id: saved.id, title: "Corrected task" });
    expect(await state.db!.todo.count({ where: { userId, completedAt: null } })).toBe(1);
    await expect(correctCaptureReview(userId, review.id, { revision: 1, proposal: { type: "todo", title: "Stale" } })).rejects.toMatchObject({ status: 409 });
  });
  it("moves a task and its original file into an asset without another upload or active copy", async () => {
    const userId = await user();
    state.parse.mockResolvedValue({ type: "todo", title: "A camera receipt", dueDate: "2026-12-01" });
    const input = { requestId: randomUUID(), text: "A camera receipt", url: null, files: [new File(["original receipt bytes"], "receipt.txt", { type: "text/plain" })] };
    const saved = await captureMobile(userId, input);
    const review = await state.db!.captureReview.findFirstOrThrow({ where: { userId } });
    const file = await state.db!.attachment.findFirstOrThrow({ where: { userId } });
    const uploadCount = state.put.mock.calls.length;
    const corrected = await correctCaptureReview(userId, review.id, { revision: 1, proposal: { type: "asset", assetKind: "inventory", title: "Camera" } });
    expect(corrected.placement).toMatchObject({ type: "asset", assetKind: "inventory", destination: "Inventory" });
    const moved = await state.db!.attachment.findUniqueOrThrow({ where: { id: file.id } });
    expect(moved).toMatchObject({ url: file.url, assetId: corrected.placement.id, todoId: null, size: file.size });
    expect(new TextDecoder().decode(state.files.get(file.url))).toBe("original receipt bytes");
    expect(state.put.mock.calls).toHaveLength(uploadCount);
    expect((await state.db!.todo.findUniqueOrThrow({ where: { id: saved.id } })).completedAt).not.toBeNull();
    expect((await state.db!.todo.findUniqueOrThrow({ where: { id: saved.id } })).dueDate).toBeNull();
    expect(await state.db!.asset.count({ where: { userId, archived: false } })).toBe(1);
    expect(await captureMobile(userId, input)).toMatchObject({ id: corrected.placement.id, type: "asset" });
    expect(await state.db!.captureReview.count({ where: { userId } })).toBe(1);
  });
  it("refuses to overwrite an ordinary edit or cascade a later comment", async () => {
    const userId = await user();
    state.parse.mockResolvedValue({ type: "todo", title: "Original" });
    const saved = await captureMobile(userId, { requestId: randomUUID(), text: "Original", url: null, files: [] });
    const review = await state.db!.captureReview.findFirstOrThrow({ where: { userId } });
    await state.db!.todo.update({ where: { id: saved.id }, data: { title: "Ordinary edit" } });
    await expect(correctCaptureReview(userId, review.id, { revision: 1, proposal: { type: "asset", assetKind: "media", title: "Wrong move" } })).rejects.toMatchObject({ status: 409 });
    expect(await state.db!.asset.count({ where: { userId } })).toBe(0);
    expect((await state.db!.todo.findUniqueOrThrow({ where: { id: saved.id } })).title).toBe("Ordinary edit");
    const second = await captureMobile(userId, { requestId: randomUUID(), text: "Original", url: null, files: [] });
    const secondReview = await state.db!.captureReview.findFirstOrThrow({ where: { userId, id: { not: review.id } } });
    await state.db!.comment.create({ data: { todoId: second.id, authorId: userId, body: "A later comment to preserve" } });
    await expect(correctCaptureReview(userId, secondReview.id, { revision: 1, proposal: { type: "asset", assetKind: "inventory", title: "No cascade" } })).rejects.toMatchObject({ status: 409 });
    expect(await state.db!.comment.count({ where: { todoId: second.id } })).toBe(1);
  });
  it("rechecks an ordinary edit committed while correction was waiting on its row", async () => {
    const userId = await user();
    state.parse.mockResolvedValue({ type: "todo", title: "Original" });
    const saved = await captureMobile(userId, { requestId: randomUUID(), text: "Original", url: null, files: [] });
    const review = await state.db!.captureReview.findFirstOrThrow({ where: { userId } });
    const locked = signal(), release = signal();
    const ordinary = state.db!.$transaction(async tx => { await tx.todo.update({ where: { id: saved.id }, data: { title: "Concurrent ordinary edit" } }); locked.resolve(); await release.promise; });
    await locked.promise;
    const correction = correctCaptureReview(userId, review.id, { revision: 1, proposal: { type: "todo", title: "Stale correction" } }).then(value => ({ value, error: null }), error => ({ value: null, error }));
    try { await waitForLock('"Todo"'); } finally { release.resolve(); }
    await ordinary;
    expect((await correction).error).toMatchObject({ status: 409 });
    expect((await state.db!.todo.findUniqueOrThrow({ where: { id: saved.id } })).title).toBe("Concurrent ordinary edit");
    expect((await state.db!.captureReview.findUniqueOrThrow({ where: { id: review.id } })).revision).toBe(1);
  });
  it("reverses only a capture's merged contact fields and preserves the existing person", async () => {
    const userId = await user();
    const person = await state.db!.person.create({ data: { userId, firstName: "Maya", lastName: "Test", role: "Designer", notes: "Existing contact notes" } });
    state.parse.mockResolvedValue({ type: "person", firstName: "Maya", lastName: "Test", company: "Capture-only company" });
    await captureMobile(userId, { requestId: randomUUID(), text: "New capture context", url: null, files: [] });
    const review = await state.db!.captureReview.findFirstOrThrow({ where: { userId } });
    await correctCaptureReview(userId, review.id, { revision: 1, proposal: { type: "todo", title: "Follow up about the capture", notes: "New capture context" } });
    expect(await state.db!.person.findUniqueOrThrow({ where: { id: person.id } })).toMatchObject({ role: "Designer", notes: "Existing contact notes", company: null, archived: false });
    expect(await state.db!.person.count({ where: { userId } })).toBe(1);
    expect(await state.db!.todo.count({ where: { userId, completedAt: null } })).toBe(1);
  });
  it("recomputes last interaction after a later older-dated interaction left its maximum unchanged", async () => {
    const userId = await user();
    const person = await state.db!.person.create({ data: { userId, firstName: "Alex", lastName: "Test", lastInteractionAt: new Date("2026-01-01T12:00:00Z") } });
    await state.db!.interaction.create({ data: { userId, title: "Baseline", kind: "meeting", occurredAt: new Date("2026-01-01T12:00:00Z"), personIds: [person.id] } });
    state.parse.mockResolvedValue({ type: "interaction", title: "Captured meeting", kind: "meeting", occurredAt: "2026-05-10T12:00:00Z", personHints: [{ firstName: "Alex", lastName: "Test" }] });
    const saved = await captureMobile(userId, { requestId: randomUUID(), text: "Captured meeting", url: null, files: [] });
    const review = await state.db!.captureReview.findFirstOrThrow({ where: { userId } });
    await state.db!.interaction.create({ data: { userId, title: "Added later, older date", kind: "meeting", occurredAt: new Date("2026-05-01T12:00:00Z"), personIds: [person.id] } });
    await correctCaptureReview(userId, review.id, { revision: 1, proposal: { type: "todo", title: "This was a task" } });
    expect(await state.db!.interaction.count({ where: { id: saved.id } })).toBe(0);
    expect((await state.db!.person.findUniqueOrThrow({ where: { id: person.id } })).lastInteractionAt?.toISOString()).toBe("2026-05-01T12:00:00.000Z");
  });
  it("stops exposing or modifying a captured task after shared-list membership is revoked", async () => {
    const userId = await user(), ownerId = await user();
    const list = await state.db!.list.create({ data: { userId: ownerId, name: "Shared test list" } });
    await state.db!.listMember.create({ data: { userId, listId: list.id, role: "editor" } });
    state.parse.mockResolvedValue({ type: "todo", title: "My original input" });
    const saved = await captureMobile(userId, { requestId: randomUUID(), text: "My original input", url: null, files: [] });
    const review = await state.db!.captureReview.findFirstOrThrow({ where: { userId } });
    await correctCaptureReview(userId, review.id, { revision: 1, proposal: { type: "todo", title: "My original input" }, fields: { listId: list.id, projectId: null } });
    await state.db!.listMember.deleteMany({ where: { userId, listId: list.id } });
    await state.db!.todo.update({ where: { id: saved.id }, data: { title: "Private owner edit after revocation", notes: "Private owner notes" } });
    const items = (await listCaptureReviews(userId)).items;
    expect(items[0].placement.missing).toBe(true);
    expect(items[0].correctable).toBe(false);
    expect(JSON.stringify(items)).not.toContain("Private owner");
    await expect(correctCaptureReview(userId, review.id, { revision: 2, proposal: { type: "todo", title: "No access" } })).rejects.toMatchObject({ status: 409 });
  });
  it("applies asset companion additions/removals and vendor corrections instead of silently ignoring them", async () => {
    const userId = await user();
    state.parse.mockResolvedValue({ type: "asset", assetKind: "inventory", title: "Camera", sourceVendor: "Original vendor" });
    await captureMobile(userId, { requestId: randomUUID(), text: "My camera", url: null, files: [] });
    const review = await state.db!.captureReview.findFirstOrThrow({ where: { userId } });
    const first = await correctCaptureReview(userId, review.id, { revision: 1, proposal: { type: "asset", assetKind: "inventory", title: "Camera", sourceVendor: "Correct vendor", followupTodo: { title: "Get a case", listName: "Later" } } });
    expect(await state.db!.todo.count({ where: { userId, completedAt: null, title: "Get a case", list: { name: "Later" } } })).toBe(1);
    expect((await state.db!.asset.findUniqueOrThrow({ where: { id: first.placement.id } })).detailsJson).toMatchObject({ sourceVendor: "Correct vendor" });
    const second = await correctCaptureReview(userId, review.id, { revision: 2, proposal: { type: "asset", assetKind: "inventory", title: "Camera", followupTodo: null } });
    expect(second.placement.related ?? []).toHaveLength(0);
    expect(await state.db!.todo.count({ where: { userId, completedAt: null } })).toBe(0);
    expect(await state.db!.asset.count({ where: { userId, archived: false } })).toBe(1);
  });
  it("keeps capitalization-only person corrections active and in place", async () => {
    const userId = await user();
    state.parse.mockResolvedValue({ type: "person", firstName: "Maya", lastName: "Test" });
    const saved = await captureMobile(userId, { requestId: randomUUID(), text: "Maya Test", url: null, files: [] });
    const review = await state.db!.captureReview.findFirstOrThrow({ where: { userId } });
    const corrected = await correctCaptureReview(userId, review.id, { revision: 1, proposal: { type: "person", firstName: "maya", lastName: "Test" } });
    expect(corrected.placement.id).toBe(saved.id);
    expect(await state.db!.person.findUniqueOrThrow({ where: { id: saved.id } })).toMatchObject({ firstName: "maya", archived: false });
  });
  it("retains an editable snapshot when a deduped Reader save makes no domain write", async () => {
    const userId = await user();
    const item = await state.db!.readerItem.create({ data: { userId, title: "Article", url: "https://example.test/article", contentHtml: "<p>Preserve original content</p>" } });
    const id = randomUUID();
    await withCaptureReview({ id, userId, source: "chrome", requestHash: "synthetic-hash", input: { text: "", url: item.url, files: [] } }, { commit: async () => ({ value: null, placement: { type: "reader", id: item.id, title: item.title, destination: "Read Later", path: `/reader/${item.id}` } }), replay: async () => null });
    const corrected = await correctCaptureReview(userId, id, { revision: 1, fields: { title: "Corrected article" } });
    expect(corrected.placement.title).toBe("Corrected article");
    expect((await state.db!.readerItem.findUniqueOrThrow({ where: { id: item.id } })).contentHtml).toBe("<p>Preserve original content</p>");
  });
  it("restores a capture-cleared snooze and exclusion when retargeting a call-sheet reminder", async () => {
    const userId = await user();
    const person = await state.db!.person.create({ data: { userId, firstName: "Maya", lastName: "Test" } });
    const future = (days: number) => new Date(Date.now() + days * 86_400_000);
    const contact = await state.db!.callSheetContact.create({ data: { userId, personId: person.id, identityKey: `test:${person.id}`, dueOn: future(10).toISOString().slice(0, 10), dueNote: "Prior reminder", snoozedUntil: future(15), excludedAt: new Date(0) } });
    const proposal = { type: "call_sheet" as const, firstName: "Maya", lastName: "Test", date: future(7).toISOString().slice(0, 10), note: "New reminder" };
    const id = randomUUID();
    await withCaptureReview({ id, userId, source: "web", requestHash: "reminder-hash", input: { text: "Call Maya", url: null, files: [] }, proposal }, { commit: async tx => { const saved = await commitCallSheetCapture(tx, userId, proposal); return { value: null, placement: saved.placement }; }, replay: async () => null });
    await expect(correctCaptureReview(userId, id, { revision: 1, proposal: { ...proposal, firstName: null } as never })).rejects.toMatchObject({ status: 400 });
    await correctCaptureReview(userId, id, { revision: 1, proposal: { ...proposal, firstName: "Alex" } });
    expect(await state.db!.callSheetContact.findUniqueOrThrow({ where: { id: contact.id } })).toMatchObject({ dueOn: contact.dueOn, dueNote: contact.dueNote, snoozedUntil: contact.snoozedUntil, excludedAt: contact.excludedAt });
  });
  it("takes the Call Sheet owner lock before domain rows to avoid a service/correction deadlock", async () => {
    const userId = await user(), id = randomUUID();
    const proposal = { type: "call_sheet" as const, firstName: "Alex", lastName: null, note: null, date: new Date(Date.now() + 7 * 86_400_000).toISOString().slice(0, 10) };
    await withCaptureReview({ id, userId, source: "web", requestHash: null, input: { text: "Call Alex", url: null, files: [] }, proposal }, { commit: async tx => ({ value: null, placement: (await commitCallSheetCapture(tx, userId, proposal)).placement }), replay: async () => null });
    const contact = await state.db!.callSheetContact.findFirstOrThrow({ where: { userId } });
    const locked = signal(), release = signal();
    const ordinary = state.db!.$transaction(async tx => {
      await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${`call-sheet:${userId}`}))`;
      locked.resolve(); await release.promise;
      await tx.callSheetContact.update({ where: { id: contact.id }, data: { dueNote: "Concurrent service edit" } });
    });
    await locked.promise;
    const correction = correctCaptureReview(userId, id, { revision: 1, proposal: { ...proposal, note: "Stale correction" } }).then(value => ({ value, error: null }), error => ({ value: null, error }));
    try { await waitForLock("pg_advisory_xact_lock"); } finally { release.resolve(); }
    await ordinary;
    expect((await correction).error).toMatchObject({ status: 409 });
    expect((await state.db!.callSheetContact.findUniqueOrThrow({ where: { id: contact.id } })).dueNote).toBe("Concurrent service edit");
  });
});
