import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { PrismaClient } from "@prisma/client";
import { randomUUID } from "node:crypto";
const state = vi.hoisted(() => ({ db: null as PrismaClient | null, sync: vi.fn(), remove: vi.fn() }));
vi.mock("@/lib/prisma", () => ({ get prisma() { if (!state.db) throw new Error("Test database not initialized"); return state.db; } }));
vi.mock("@/lib/cron", () => ({ isFounderUser: async () => true }));
vi.mock("@/lib/gcal", () => ({ isCalendarSyncConfigured: () => true, syncTodoEventChecked: state.sync, deleteTodoEventChecked: state.remove }));
import { reconcileReviewCalendar } from "./calendar";
const databaseUrl = process.env.CAPTURE_REVIEW_TEST_DATABASE_URL, users: string[] = [];
describe.skipIf(!databaseUrl)("calendar retry access — real Postgres", () => {
  beforeAll(() => {
    const url = new URL(databaseUrl!);
    if (!["127.0.0.1", "localhost"].includes(url.hostname) || !url.pathname.startsWith("/capture_review_test")) throw new Error("Scratch database required");
    state.db = new PrismaClient({ datasourceUrl: databaseUrl }); state.sync.mockResolvedValue(true); state.remove.mockResolvedValue(true);
  });
  afterAll(async () => { if (state.db) { await state.db.user.deleteMany({ where: { id: { in: users } } }); await state.db.$disconnect(); } });
  it("removes the stale event instead of sending private changes after shared-list access is revoked", async () => {
    const userId = "calendar-access-" + randomUUID(), ownerId = "calendar-access-" + randomUUID(); users.push(userId, ownerId);
    await state.db!.user.createMany({ data: users.map(id => ({ id, email: id + "@example.test" })) });
    const list = await state.db!.list.create({ data: { userId: ownerId, name: "Shared list" } });
    await state.db!.listMember.create({ data: { userId, listId: list.id, role: "editor" } });
    const todo = await state.db!.todo.create({ data: { userId, listId: list.id, title: "Original capture", dueDate: new Date("2026-12-01") } });
    const reviewId = randomUUID();
    await state.db!.captureReview.create({ data: { id: reviewId, userId, source: "web", input: { text: "Original capture", url: null, files: [] }, placement: { type: "todo", id: todo.id, title: todo.title, destination: list.name, path: "/" }, effects: { version: 1, writes: [], calendarPending: [todo.id] } } });
    await state.db!.listMember.deleteMany({ where: { userId, listId: list.id } });
    await state.db!.todo.update({ where: { id: todo.id }, data: { title: "Private owner edit", notes: "Private owner notes" } });
    await reconcileReviewCalendar(userId, reviewId);
    expect(state.sync).not.toHaveBeenCalled(); expect(state.remove).toHaveBeenCalledExactlyOnceWith(todo.id);
    expect((await state.db!.captureReview.findUniqueOrThrow({ where: { id: reviewId } })).effects).toMatchObject({ calendarPending: [] });
  });
});
