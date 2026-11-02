import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { reconcilePendingReviewCalendars, reconcileReviewCalendar } from "./calendar";
import type { CaptureEffects } from "./journal";
import type { TodoForCalendar } from "@/lib/gcal";

const mocks = vi.hoisted(() => ({ reviews: vi.fn(), review: vi.fn(), todos: vi.fn(), update: vi.fn(), founder: vi.fn(), configured: vi.fn(), sync: vi.fn(), remove: vi.fn() }));
vi.mock("@/lib/prisma", () => ({ prisma: { captureReview: { findMany: mocks.reviews, findFirst: mocks.review, updateMany: mocks.update }, todo: { findMany: mocks.todos } } }));
vi.mock("@/lib/cron", () => ({ isFounderUser: mocks.founder }));
vi.mock("@/lib/gcal", () => ({ isCalendarSyncConfigured: mocks.configured, syncTodoEventChecked: mocks.sync, deleteTodoEventChecked: mocks.remove }));

type Review = { id: string; userId: string; revision: number; updatedAt: Date; effects: CaptureEffects };
let reviews: Review[];
const updatedAt = new Date("2026-11-01T12:00:00Z");
function review(id: string, pending: string[], userId = "owner"): Review {
  return { id, userId, revision: 2, updatedAt, effects: { version: 1, writes: [], calendarPending: pending, correctedAt: "2026-11-01T11:59:00Z", history: [{ at: "2026-11-01T11:59:00Z", placement: { id: "original" } }] } };
}
function todo(id: string, overrides: Partial<TodoForCalendar> = {}): TodoForCalendar {
  return { id, title: "Synthetic task", notes: null, dueDate: new Date("2026-11-02T00:00:00Z"), completedAt: null, droppedAt: null, list: { name: "Synthetic list" }, project: null, ...overrides };
}

beforeEach(() => {
  vi.resetAllMocks();
  vi.spyOn(console, "error").mockImplementation(() => {});
  reviews = [];
  mocks.founder.mockResolvedValue(true);
  mocks.configured.mockReturnValue(true);
  mocks.sync.mockResolvedValue(true);
  mocks.remove.mockResolvedValue(true);
  mocks.todos.mockResolvedValue([]);
  mocks.reviews.mockImplementation(async ({ where }) => reviews.filter(row => row.userId === where.userId && where.id.in.includes(row.id)).map(row => ({ ...row, effects: structuredClone(row.effects) })));
  mocks.review.mockImplementation(async ({ where }) => {
    const row = reviews.find(row => row.userId === where.userId && row.id === where.id);
    return row ? { ...row, effects: structuredClone(row.effects) } : null;
  });
  mocks.update.mockImplementation(async ({ where, data }) => {
    const row = reviews.find(row => row.id === where.id && row.userId === where.userId && row.revision === where.revision && row.updatedAt.getTime() === where.updatedAt.getTime());
    if (!row) return { count: 0 };
    row.effects = structuredClone(data.effects);
    row.updatedAt = new Date(row.updatedAt.getTime() + 1);
    return { count: 1 };
  });
});
afterEach(() => vi.restoreAllMocks());

describe("capture correction calendar reconciliation", () => {
  it("syncs active dated tasks and removes retired, completed, undated and missing events", async () => {
    reviews = [review("review", ["active", "retired", "completed", "undated", "missing"])];
    mocks.todos.mockResolvedValue([todo("active"), todo("retired", { droppedAt: updatedAt }), todo("completed", { completedAt: updatedAt }), todo("undated", { dueDate: null })]);
    await reconcileReviewCalendar("owner", "review");
    expect(mocks.sync).toHaveBeenCalledExactlyOnceWith(todo("active"));
    expect(mocks.remove.mock.calls.map(([id]) => id)).toEqual(["retired", "completed", "undated", "missing"]);
    expect(reviews[0].effects).toEqual({ ...review("review", []).effects, calendarPending: [] });
    expect(mocks.reviews.mock.calls[0][0].where).toEqual({ userId: "owner", id: { in: ["review"] } });
    expect(mocks.todos.mock.calls[0][0].where).toMatchObject({ userId: "owner", id: { in: ["active", "retired", "completed", "undated", "missing"] } });
    expect(mocks.update.mock.calls[0][0].where).toEqual({ id: "review", userId: "owner", revision: 2, updatedAt });
  });

  it("retains only failed work after partial external success", async () => {
    reviews = [review("review", ["failed-sync", "failed-delete", "removed"])];
    mocks.todos.mockResolvedValue([todo("failed-sync")]);
    mocks.sync.mockResolvedValue(false);
    mocks.remove.mockImplementation(async id => id !== "failed-delete");
    await reconcileReviewCalendar("owner", "review");
    expect(reviews[0].effects.calendarPending).toEqual(["failed-sync", "failed-delete"]);
  });

  it("retains an unexpected thrown hook failure while completing other work", async () => {
    reviews = [review("review", ["failed", "removed"])];
    mocks.remove.mockRejectedValueOnce(new Error("Synthetic transport error")).mockResolvedValueOnce(true);
    await reconcileReviewCalendar("owner", "review");
    expect(reviews[0].effects.calendarPending).toEqual(["failed"]);
  });

  it("does not write pending state if every external call failed", async () => {
    reviews = [review("review", ["failed"])];
    mocks.remove.mockResolvedValue(false);
    await reconcileReviewCalendar("owner", "review");
    expect(reviews[0].effects.calendarPending).toEqual(["failed"]);
    expect(mocks.update).not.toHaveBeenCalled();
  });

  it("clears nonfounder hooks without touching the shared Google account", async () => {
    reviews = [review("review", ["task"])];
    mocks.founder.mockResolvedValue(false);
    await reconcileReviewCalendar("owner", "review");
    expect(mocks.founder).toHaveBeenCalledExactlyOnceWith("owner");
    expect(reviews[0].effects.calendarPending).toEqual([]);
    expect(mocks.todos).not.toHaveBeenCalled();
    expect(mocks.sync).not.toHaveBeenCalled();
    expect(mocks.remove).not.toHaveBeenCalled();
    expect(mocks.update.mock.calls[0][0].where).toEqual({ id: "review", userId: "owner", revision: 2, updatedAt });
  });

  it("keeps founder hooks pending while Google is unconfigured", async () => {
    reviews = [review("review", ["task"])];
    mocks.configured.mockReturnValue(false);
    await reconcileReviewCalendar("owner", "review");
    expect(reviews[0].effects.calendarPending).toEqual(["task"]);
    expect(mocks.todos).not.toHaveBeenCalled();
    expect(mocks.sync).not.toHaveBeenCalled();
    expect(mocks.remove).not.toHaveBeenCalled();
    expect(mocks.update).not.toHaveBeenCalled();
  });

  it("cannot read or mutate another owner's review", async () => {
    reviews = [review("review", ["private-task"], "someone-else")];
    await reconcileReviewCalendar("owner", "review");
    expect(reviews[0].effects.calendarPending).toEqual(["private-task"]);
    expect(mocks.todos).not.toHaveBeenCalled();
    expect(mocks.sync).not.toHaveBeenCalled();
    expect(mocks.remove).not.toHaveBeenCalled();
    expect(mocks.update).not.toHaveBeenCalled();
  });

  it.each(["revision", "updatedAt"])("only unions retry IDs into a newer review when %s changes during Google work", async changed => {
    reviews = [review("review", ["task"])];
    mocks.todos.mockResolvedValue([todo("task")]);
    const newerEffects: CaptureEffects = { version: 1, writes: [], calendarPending: ["new-task"], correctedAt: "2026-11-01T12:01:00Z" };
    mocks.sync.mockImplementation(async () => {
      if (changed === "revision") reviews[0].revision += 1;
      else reviews[0].updatedAt = new Date("2026-11-01T12:01:00Z");
      reviews[0].effects = newerEffects;
      return true;
    });
    await reconcileReviewCalendar("owner", "review");
    expect(reviews[0].effects).toEqual({ ...newerEffects, calendarPending: ["new-task", "task"] });
    expect(mocks.update.mock.calls[0][0].where).toEqual({ id: "review", userId: "owner", revision: 2, updatedAt });
    expect(mocks.review.mock.calls[0][0].where).toEqual({ id: "review", userId: "owner" });
    expect(mocks.update.mock.calls[1][0].where).toEqual({ id: "review", userId: "owner", revision: changed === "revision" ? 3 : 2, updatedAt: changed === "updatedAt" ? new Date("2026-11-01T12:01:00Z") : updatedAt });
  });

  it("retries the fresh-state CAS without dropping another worker's pending IDs", async () => {
    reviews = [review("review", ["task"])];
    mocks.remove.mockImplementation(async () => {
      reviews[0].effects.calendarPending = [];
      reviews[0].updatedAt = new Date("2026-11-01T12:01:00Z");
      return true;
    });
    mocks.update.mockResolvedValueOnce({ count: 0 }).mockImplementationOnce(async () => {
      reviews[0].revision += 1;
      reviews[0].effects = { version: 1, writes: [], calendarPending: ["new-task"], correctedAt: "newer-metadata" };
      return { count: 0 };
    });
    await reconcileReviewCalendar("owner", "review");
    expect(reviews[0].effects).toEqual({ version: 1, writes: [], calendarPending: ["new-task", "task"], correctedAt: "newer-metadata" });
    expect(mocks.update).toHaveBeenCalledTimes(3);
  });

  it("does not mistake duplicate current pending IDs for an already queued retry", async () => {
    reviews = [review("review", ["task"])];
    mocks.remove.mockImplementation(async () => {
      reviews[0].effects.calendarPending = ["new-task", "new-task"];
      reviews[0].revision += 1;
      return true;
    });
    await reconcileReviewCalendar("owner", "review");
    expect(reviews[0].effects.calendarPending).toEqual(["new-task", "task"]);
  });

  it("retains a failed in-flight hook even if a newer worker already cleared pending state", async () => {
    reviews = [review("review", ["task"])];
    mocks.remove.mockImplementation(async () => {
      reviews[0].effects = { version: 1, writes: [], calendarPending: [], correctedAt: "newer-metadata" };
      reviews[0].revision += 1;
      return false;
    });
    await reconcileReviewCalendar("owner", "review");
    expect(reviews[0].effects).toEqual({ version: 1, writes: [], calendarPending: ["task"], correctedAt: "newer-metadata" });
  });

  it("bounds recovery attempts when the review keeps changing", async () => {
    reviews = [review("review", ["task"])];
    mocks.remove.mockImplementation(async () => {
      reviews[0].effects.calendarPending = [];
      reviews[0].updatedAt = new Date("2026-11-01T12:01:00Z");
      return true;
    });
    mocks.update.mockResolvedValue({ count: 0 });
    await reconcileReviewCalendar("owner", "review");
    expect(mocks.review).toHaveBeenCalledTimes(3);
    expect(mocks.update).toHaveBeenCalledTimes(4);
    expect(reviews[0].effects.calendarPending).toEqual([]);
  });

  it("does not requeue an old nonfounder no-op after a newer review wins", async () => {
    reviews = [review("review", ["task"])];
    mocks.founder.mockResolvedValue(false);
    mocks.update.mockResolvedValue({ count: 0 });
    await reconcileReviewCalendar("owner", "review");
    expect(mocks.review).not.toHaveBeenCalled();
    expect(mocks.update).toHaveBeenCalledTimes(1);
  });

  it("batches owner lookups and deduplicates shared pending tasks", async () => {
    reviews = [review("a", ["shared", "shared"]), review("b", ["shared", "other"])];
    mocks.todos.mockResolvedValue([todo("shared"), todo("other")]);
    await reconcilePendingReviewCalendars("owner", ["a", "b", "a"]);
    expect(mocks.reviews).toHaveBeenCalledTimes(1);
    expect(mocks.reviews.mock.calls[0][0].where.id.in).toEqual(["a", "b"]);
    expect(mocks.todos).toHaveBeenCalledTimes(1);
    expect(mocks.sync.mock.calls.map(([row]) => row.id)).toEqual(["shared", "other"]);
    expect(reviews.map(row => row.effects.calendarPending)).toEqual([[], []]);
  });

  it("does no work for an empty batch or reviews without valid pending effects", async () => {
    await reconcilePendingReviewCalendars("owner", []);
    expect(mocks.reviews).not.toHaveBeenCalled();
    reviews = [review("empty", []), { ...review("invalid", ["task"]), effects: { version: 99, writes: [], calendarPending: ["task"] } as unknown as CaptureEffects }];
    await reconcilePendingReviewCalendars("owner", ["empty", "invalid"]);
    expect(mocks.founder).not.toHaveBeenCalled();
    expect(mocks.todos).not.toHaveBeenCalled();
    expect(mocks.update).not.toHaveBeenCalled();
  });
});
