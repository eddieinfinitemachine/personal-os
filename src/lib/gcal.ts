// Founder-only Google Calendar synchronization for todo due dates.
// Events use deterministic IDs derived from todo IDs, so writes are idempotent
// without storing external IDs in Prisma. Request hooks provide fast updates;
// the daily reconciliation cron backfills and removes orphaned events.

import { getFounderUser } from "@/lib/cron";
import {
  getGoogleAccessToken,
  isGoogleConfigured,
} from "@/lib/google";
import { prisma } from "@/lib/prisma";
import { toDateInputValue } from "@/lib/utils";

const CALENDAR_API = "https://www.googleapis.com/calendar/v3";
// Todos live in their own calendar so they can be toggled/coloured apart from
// real appointments. GOOGLE_CALENDAR_ID pins one explicitly; otherwise the
// first sync finds (or creates) a calendar named "Kaizen" and caches its id
// for the life of the process.
const KAIZEN_CALENDAR_NAME = "Kaizen";
let cachedCalendarId: string | null = null;

type CalendarListEntry = { id: string; summary?: string; accessRole?: string };

async function resolveCalendarId(token: string): Promise<string> {
  if (process.env.GOOGLE_CALENDAR_ID) return process.env.GOOGLE_CALENDAR_ID;
  if (cachedCalendarId) return cachedCalendarId;

  const auth = { Authorization: `Bearer ${token}` };
  const listRes = await fetch(
    `${CALENDAR_API}/users/me/calendarList?minAccessRole=owner&maxResults=250`,
    { headers: auth },
  );
  if (!listRes.ok) {
    throw new Error(`calendarList failed (${listRes.status}): ${await listRes.text()}`);
  }
  const list = (await listRes.json()) as { items?: CalendarListEntry[] };
  const existing = (list.items ?? []).find((c) => c.summary === KAIZEN_CALENDAR_NAME);
  if (existing) {
    cachedCalendarId = existing.id;
    return existing.id;
  }

  const createRes = await fetch(`${CALENDAR_API}/calendars`, {
    method: "POST",
    headers: { ...auth, "Content-Type": "application/json" },
    body: JSON.stringify({ summary: KAIZEN_CALENDAR_NAME, timeZone: "America/New_York" }),
  });
  if (!createRes.ok) {
    throw new Error(`calendar create failed (${createRes.status}): ${await createRes.text()}`);
  }
  const created = (await createRes.json()) as { id: string };
  console.log(`[gcal] created calendar "${KAIZEN_CALENDAR_NAME}" (${created.id})`);
  cachedCalendarId = created.id;
  return created.id;
}
const appUrl = () =>
  process.env.APP_URL ??
  process.env.NEXT_PUBLIC_APP_URL ??
  "http://localhost:3000";

export function isCalendarSyncConfigured(): boolean {
  return isGoogleConfigured();
}

// Google event IDs must match [a-v0-9]{5,1024}; a hex-encoded cuid does.
export function eventIdForTodo(todoId: string): string {
  return `ka${Buffer.from(todoId, "utf8").toString("hex")}`;
}

export type TodoForCalendar = {
  id: string;
  title: string;
  notes: string | null;
  dueDate: Date | null;
  completedAt: Date | null;
  droppedAt: Date | null;
  list: { name: string };
  project: { name: string } | null;
};

type CalendarEventBody = {
  id: string;
  summary: string;
  description: string;
  status: "confirmed";
  start: { date: string };
  end: { date: string };
  extendedProperties: { private: { kaizen: "1"; todoId: string } };
  reminders: { useDefault: false };
};

type CalendarListResponse = {
  items?: {
    extendedProperties?: { private?: { todoId?: string } };
  }[];
  nextPageToken?: string;
};

async function calendarEventsUrl(token: string): Promise<string> {
  const id = await resolveCalendarId(token);
  return `${CALENDAR_API}/calendars/${encodeURIComponent(id)}/events`;
}

function eventBody(todo: TodoForCalendar): CalendarEventBody {
  const date = toDateInputValue(todo.dueDate);
  const nextDay = new Date(`${date}T00:00:00.000Z`);
  nextDay.setUTCDate(nextDay.getUTCDate() + 1);

  const prefix = todo.droppedAt ? "✗ " : todo.completedAt ? "✓ " : "";
  const context = todo.project
    ? `${todo.list.name} · ${todo.project.name}`
    : todo.list.name;

  return {
    id: eventIdForTodo(todo.id),
    summary: `${prefix}${todo.title}`,
    description: [
      context,
      "",
      ...(todo.notes ? [todo.notes] : []),
      "",
      appUrl(),
    ].join("\n"),
    status: "confirmed",
    start: { date },
    end: { date: toDateInputValue(nextDay) },
    extendedProperties: {
      private: { kaizen: "1", todoId: todo.id },
    },
    reminders: { useDefault: false },
  };
}

async function logResponseError(action: string, response: Response): Promise<void> {
  let detail = "";
  try {
    detail = await response.text();
  } catch {
    // The status is still useful if the response body cannot be read.
  }
  console.error(
    `[gcal] ${action}`,
    new Error(
      `Google Calendar returned ${response.status}${detail ? `: ${detail}` : ""}`,
    ),
  );
}

export async function syncTodoEvent(todo: TodoForCalendar): Promise<void> {
  if (!isCalendarSyncConfigured()) return;

  try {
    if (!todo.dueDate) {
      await deleteTodoEvent(todo.id);
      return;
    }

    const token = await getGoogleAccessToken();
    const eventsUrl = await calendarEventsUrl(token);
    const body = eventBody(todo);
    const response = await fetch(eventsUrl, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${token}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify(body),
    });

    if (response.status === 409) {
      const { id, ...patchBody } = body;
      const patchResponse = await fetch(
        `${eventsUrl}/${encodeURIComponent(id)}`,
        {
          method: "PATCH",
          headers: {
            Authorization: `Bearer ${token}`,
            "Content-Type": "application/json",
          },
          body: JSON.stringify(patchBody),
        },
      );
      if (!patchResponse.ok) {
        await logResponseError(`patch todo ${todo.id} failed`, patchResponse);
      }
      return;
    }

    if (!response.ok) {
      await logResponseError(`create todo ${todo.id} failed`, response);
    }
  } catch (err) {
    console.error(`[gcal] sync todo ${todo.id} failed`, err);
  }
}

export async function deleteTodoEvent(todoId: string): Promise<void> {
  if (!isCalendarSyncConfigured()) return;

  try {
    const token = await getGoogleAccessToken();
    const eventsUrl = await calendarEventsUrl(token);
    const response = await fetch(
      `${eventsUrl}/${encodeURIComponent(eventIdForTodo(todoId))}`,
      {
        method: "DELETE",
        headers: { Authorization: `Bearer ${token}` },
      },
    );
    if (!response.ok && response.status !== 404 && response.status !== 410) {
      await logResponseError(`delete todo ${todoId} failed`, response);
    }
  } catch (err) {
    console.error(`[gcal] delete todo ${todoId} failed`, err);
  }
}

export async function syncRecentTodos(
  opts: { sinceMs?: number } = {},
): Promise<void> {
  if (!isCalendarSyncConfigured()) return;

  try {
    const founder = await getFounderUser();
    if (!founder) return;

    // Dated todos only: a reorder touches every row's updatedAt, and firing a
    // Google DELETE per undated row would be dozens of wasted calls. Clearing
    // a date is handled explicitly by the PATCH route (deleteTodoEvent) and
    // by the daily reconcile sweep.
    const sinceMs = opts.sinceMs ?? 5 * 60 * 1000;
    const todos = await prisma.todo.findMany({
      where: {
        userId: founder.id,
        dueDate: { not: null },
        updatedAt: { gte: new Date(Date.now() - sinceMs) },
      },
      include: {
        list: { select: { name: true } },
        project: { select: { name: true } },
      },
      take: 100,
    });

    for (const todo of todos) {
      await syncTodoEvent(todo);
    }
  } catch (err) {
    console.error("[gcal] sync recent todos failed", err);
  }
}

export async function reconcileCalendar(): Promise<{
  upserted: number;
  orphansRemoved: number;
}> {
  const result = { upserted: 0, orphansRemoved: 0 };
  if (!isCalendarSyncConfigured()) return result;

  try {
    const founder = await getFounderUser();
    if (!founder) return result;

    const datedTodos = await prisma.todo.findMany({
      where: {
        userId: founder.id,
        dueDate: { not: null },
      },
      include: {
        list: { select: { name: true } },
        project: { select: { name: true } },
      },
      orderBy: { updatedAt: "desc" },
      take: 500,
    });

    for (const todo of datedTodos) {
      await syncTodoEvent(todo);
      result.upserted += 1;
    }

    const todoIds: string[] = [];
    let pageToken: string | undefined;
    do {
      const token = await getGoogleAccessToken();
      const url = new URL(await calendarEventsUrl(token));
      url.searchParams.set("privateExtendedProperty", "kaizen=1");
      url.searchParams.set("showDeleted", "false");
      url.searchParams.set("maxResults", "250");
      url.searchParams.set("singleEvents", "true");
      if (pageToken) url.searchParams.set("pageToken", pageToken);

      const response = await fetch(url, {
        headers: { Authorization: `Bearer ${token}` },
      });
      if (!response.ok) {
        await logResponseError("list managed events failed", response);
        return result;
      }

      const data = (await response.json()) as CalendarListResponse;
      for (const event of data.items ?? []) {
        const todoId = event.extendedProperties?.private?.todoId;
        if (todoId) todoIds.push(todoId);
      }
      pageToken = data.nextPageToken;
    } while (pageToken);

    if (todoIds.length === 0) return result;

    // An event is an orphan if its todo is gone (cascade delete) or no longer
    // carries a due date (cleared by a path that didn't call deleteTodoEvent).
    const existing = await prisma.todo.findMany({
      where: { id: { in: todoIds }, dueDate: { not: null } },
      select: { id: true },
    });
    const datedIds = new Set(existing.map((todo) => todo.id));

    for (const todoId of todoIds) {
      if (datedIds.has(todoId)) continue;
      await deleteTodoEvent(todoId);
      result.orphansRemoved += 1;
    }
  } catch (err) {
    console.error("[gcal] reconcile calendar failed", err);
  }

  return result;
}
