import type { Prisma } from "@prisma/client";
import { isFounderUser } from "@/lib/cron";
import { deleteTodoEventChecked, isCalendarSyncConfigured, syncTodoEventChecked } from "@/lib/gcal";
import { prisma } from "@/lib/prisma";
import { listAccessWhere } from "@/lib/list-access";
import { readEffects } from "./journal";

async function requeueCalendarIds(userId: string, reviewId: string, ids: string[]): Promise<void> {
  for (let attempt = 0; attempt < 3; attempt += 1) {
    const latest = await prisma.captureReview.findFirst({
      where: { id: reviewId, userId },
      select: { revision: true, updatedAt: true, effects: true },
    });
    if (!latest) return;
    const effects = readEffects(latest.effects);
    if (!effects) return;
    const pending = effects.calendarPending ?? [];
    if (!Array.isArray(pending) || !pending.every(id => typeof id === "string" && id.length > 0)) return;
    if (ids.every(id => pending.includes(id))) return;
    const union = [...new Set([...pending, ...ids])];
    const changed = await prisma.captureReview.updateMany({
      where: { id: reviewId, userId, revision: latest.revision, updatedAt: latest.updatedAt },
      data: { effects: { ...effects, calendarPending: union } as unknown as Prisma.InputJsonValue },
    });
    if (changed.count) return;
  }
  console.error(`[capture-review] calendar retry state for ${reviewId} kept changing`);
}

/** Run after a committed correction, outside its database transaction. */
export async function reconcileReviewCalendar(userId: string, reviewId: string): Promise<void> {
  await reconcilePendingReviewCalendars(userId, [reviewId]);
}

/** A list response can retry pending hooks with one owner-scoped review/todo lookup. */
export async function reconcilePendingReviewCalendars(userId: string, reviewIds: string[]): Promise<void> {
  if (!reviewIds.length) return;

  try {
    const reviews = await prisma.captureReview.findMany({
      where: { userId, id: { in: [...new Set(reviewIds)] } },
      select: { id: true, revision: true, updatedAt: true, effects: true },
    });
    const pendingReviews = reviews.flatMap(review => {
      const effects = readEffects(review.effects);
      const pending = effects?.calendarPending;
      if (!effects || !Array.isArray(pending) || !pending.length || !pending.every(id => typeof id === "string" && id.length > 0)) return [];
      return [{ ...review, effects, pending }];
    });
    if (!pendingReviews.length) return;

    const ids = [...new Set(pendingReviews.flatMap(review => review.pending))];
    const succeeded = new Set<string>();
    const attempted = new Set<string>();
    if (!await isFounderUser(userId)) {
      // The configured account belongs only to the founder. Other tenants have
      // no applicable hook, so finish their no-op work without a Google request.
      ids.forEach(id => succeeded.add(id));
    } else {
      if (!isCalendarSyncConfigured()) return;
      const todos = await prisma.todo.findMany({
        where: { userId, id: { in: ids }, list: listAccessWhere(userId) },
        include: { list: { select: { name: true } }, project: { select: { name: true } } },
      });
      const byId = new Map(todos.map(todo => [todo.id, todo]));
      for (const id of ids) {
        try {
          attempted.add(id);
          const todo = byId.get(id);
          const confirmed = todo && todo.dueDate && !todo.completedAt && !todo.droppedAt
            ? await syncTodoEventChecked(todo)
            : await deleteTodoEventChecked(id);
          if (confirmed) succeeded.add(id);
        } catch (err) {
          // Checked helpers normally catch failures themselves. Keep pending
          // work even if an unexpected hook failure escapes in the future.
          console.error(`[capture-review] calendar todo ${id} failed`, err);
        }
      }
    }

    for (const review of pendingReviews) {
      const remaining = review.pending.filter(id => !succeeded.has(id));
      const retry = review.pending.filter(id => attempted.has(id));
      if (remaining.length === review.pending.length) {
        // A failed transport can still have reached Google. If a newer worker
        // already cleared these IDs, restore their retry state without changing
        // any newer correction metadata.
        if (retry.length) await requeueCalendarIds(userId, review.id, retry);
        continue;
      }
      const changed = await prisma.captureReview.updateMany({
        // A correction, dismissal, or another hook worker may have changed the
        // effects while Google was running. Never replace that newer state.
        where: { id: review.id, userId, revision: review.revision, updatedAt: review.updatedAt },
        data: { effects: { ...review.effects, calendarPending: remaining } as unknown as Prisma.InputJsonValue },
      });
      if (!changed.count) {
        // An older in-flight Google write can finish after a newer hook. Keep
        // enough pending work in the latest effects to repair external ordering.
        if (retry.length) await requeueCalendarIds(userId, review.id, retry);
      }
    }
  } catch (err) {
    console.error("[capture-review] calendar reconciliation failed", err);
  }
}
