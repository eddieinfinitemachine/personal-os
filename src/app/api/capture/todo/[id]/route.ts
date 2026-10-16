import { NextResponse, after } from "next/server";
import { prisma } from "@/lib/prisma";
import { resolveCaptureUser } from "@/lib/capture-auth";
import { deleteTodoEvent, syncRecentTodos } from "@/lib/gcal";
import { toDateInputValue } from "@/lib/utils";

export const dynamic = "force-dynamic";

// Bearer-token todo update for native clients (Fork Calendar). Same auth as
// POST /api/capture/todo — CAPTURE_TOKEN / CAPTURE_TOKENS via
// lib/capture-auth — and scoped to todos the token's user owns.
//
// Body (all optional):
//   {
//     "completed": true | false,       // complete / reopen
//     "dueDate": "2026-05-15" | null   // set (date-only) or clear
//   }
//
// Completion mirrors the app's checkbox (PATCH /api/todos/[id] with
// toggleComplete): only completedAt changes. Reopening a dropped/reference
// todo clears completedAt and leaves droppedAt / isReference as they are,
// exactly like toggling it in the app.
//
// Responds { id, title, dueDate: "YYYY-MM-DD" | null, completedAt: ISO | null }.
export async function PATCH(
  request: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const userId = await resolveCaptureUser(request);
  if (!userId) {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }

  const body = (await request.json().catch(() => null)) as unknown;
  if (!body || typeof body !== "object" || Array.isArray(body)) {
    return NextResponse.json({ error: "body must be a JSON object" }, { status: 400 });
  }
  const { completed, dueDate } = body as Record<string, unknown>;
  if (completed !== undefined && typeof completed !== "boolean") {
    return NextResponse.json({ error: "completed must be a boolean" }, { status: 400 });
  }
  if (dueDate !== undefined && dueDate !== null && !isDateOnly(dueDate)) {
    return NextResponse.json(
      { error: "dueDate must be YYYY-MM-DD or null" },
      { status: 400 },
    );
  }

  const { id } = await params;
  const select = { id: true, title: true, dueDate: true, completedAt: true } as const;
  const existing = await prisma.todo.findFirst({ where: { id, userId }, select });
  if (!existing) {
    return NextResponse.json({ error: "not found" }, { status: 404 });
  }

  const updates: { completedAt?: Date | null; dueDate?: Date | null } = {};
  // Completing an already-completed todo keeps its original timestamp.
  if (completed === true && !existing.completedAt) updates.completedAt = new Date();
  if (completed === false) updates.completedAt = null;
  // Same date-only parsing as POST /api/capture/todo (UTC midnight).
  if (dueDate !== undefined) updates.dueDate = dueDate ? new Date(dueDate as string) : null;

  let todo = existing;
  if (Object.keys(updates).length > 0) {
    todo = await prisma.todo.update({ where: { id, userId }, data: updates, select });
    // Same Calendar hook as PATCH /api/todos/[id]: syncRecentTodos only
    // upserts dated todos, so clearing a date needs an explicit delete.
    if (dueDate === null) after(() => deleteTodoEvent(id));
    else after(() => syncRecentTodos());
  }

  return NextResponse.json({
    id: todo.id,
    title: todo.title,
    dueDate: todo.dueDate ? toDateInputValue(todo.dueDate) : null,
    completedAt: todo.completedAt ? todo.completedAt.toISOString() : null,
  });
}

// A real calendar date in YYYY-MM-DD form (2026-02-30 doesn't round-trip).
function isDateOnly(value: unknown): value is string {
  return (
    typeof value === "string" &&
    /^\d{4}-\d{2}-\d{2}$/.test(value) &&
    toDateInputValue(new Date(value)) === value
  );
}
