import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { getCurrentUserId } from "@/lib/auth";
import { listAccessWhere } from "@/lib/list-access";
import { parseCapture } from "@/lib/smart-capture";
import { createAssetFromProposal } from "@/lib/smart-commit";
import { deleteTodo } from "@/lib/todo-delete";
import { assetTrackerByKind, todoCaptureText } from "@/lib/asset-trackers";

// "Send to tracker": turn a todo into an item in one of the Asset-backed
// trackers (Media, Places, Inventory, Investments, Best practices). Claude
// (with web search) fleshes out the item; the todo is then deleted exactly
// like DELETE /api/todos/[id]. The response carries the todo snapshot that
// POST /api/todos/restore takes, so the client can offer Undo.

export const dynamic = "force-dynamic";
export const maxDuration = 60;

export async function POST(
  request: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const userId = await getCurrentUserId(request);
  if (!userId) return NextResponse.json({ error: "unauthorized" }, { status: 401 });

  let kindRaw: unknown;
  try {
    kindRaw = ((await request.json()) as { kind?: unknown })?.kind;
  } catch {
    return NextResponse.json({ error: "bad json" }, { status: 400 });
  }
  const tracker = assetTrackerByKind(kindRaw);
  if (!tracker) {
    return NextResponse.json({ error: "unknown tracker" }, { status: 400 });
  }
  const kind = tracker.kind;

  const { id } = await params;
  // Same access rule as PATCH/DELETE /api/todos/[id]: any list you can see.
  const todo = await prisma.todo.findFirst({
    where: { id, list: listAccessWhere(userId) },
    include: { subtasks: { orderBy: { position: "asc" } } },
  });
  if (!todo) return NextResponse.json({ error: "not found" }, { status: 404 });

  let proposal;
  try {
    proposal = await parseCapture({
      text: todoCaptureText(todo.title, todo.notes),
      forceType: kind,
      today: new Date().toISOString().slice(0, 10),
      // The item is filed by tracker, not project.
      activeProjects: [],
    });
  } catch (err) {
    console.error(
      "to-tracker: Claude parse failed",
      err instanceof Error ? err.message : String(err),
    );
    return NextResponse.json({ error: "Couldn't reach Claude" }, { status: 502 });
  }
  if (proposal.type !== "asset" || proposal.assetKind !== kind || !proposal.title?.trim()) {
    console.error(
      "to-tracker: unexpected proposal",
      proposal.type,
      proposal.type === "asset" ? proposal.assetKind : "",
    );
    return NextResponse.json(
      { error: `Couldn't read that as a ${tracker.label} item` },
      { status: 502 },
    );
  }

  const asset = await createAssetFromProposal(
    userId,
    { ...proposal, title: proposal.title.trim(), projectId: null },
    { source: "todo", sourceTodoId: todo.id, sourceTodoTitle: todo.title },
  );

  // What POST /api/todos/restore needs to put the row (and its subtasks)
  // back with the original ids.
  const snapshot = {
    id: todo.id,
    title: todo.title,
    notes: todo.notes,
    dueDate: todo.dueDate,
    completedAt: todo.completedAt,
    listId: todo.listId,
    projectId: todo.projectId,
    parentId: todo.parentId,
    position: todo.position,
    createdAt: todo.createdAt,
    droppedAt: todo.droppedAt,
    isReference: todo.isReference,
    snoozedUntil: todo.snoozedUntil,
    subtasks: todo.subtasks.map((s) => ({
      id: s.id,
      title: s.title,
      notes: s.notes,
      dueDate: s.dueDate,
      completedAt: s.completedAt,
      position: s.position,
    })),
  };

  await deleteTodo(todo.id);

  return NextResponse.json({
    asset: {
      id: asset.id,
      kind: asset.kind,
      title: asset.title,
      subtitle: asset.subtitle,
      category: asset.category,
      status: asset.status,
    },
    todo: snapshot,
    trackerRoute: tracker.href,
  });
}
