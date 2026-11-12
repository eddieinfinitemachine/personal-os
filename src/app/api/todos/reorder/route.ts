import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { getCurrentUserId } from "@/lib/auth";
import { readJsonObject } from "@/lib/request-json";
import { listAccessWhere } from "@/lib/list-access";

const MAX_IDS = 1000;

// Manual order within one list: POST { listId, ids } sets each named top-level
// todo's position to its index. Ids that aren't top-level todos in that list
// are ignored, and todos not named keep their position. Reads order by
// completedAt, then dueDate (undated first), then position, so this orders
// the undated todos and breaks ties within a day.
export async function POST(request: Request) {
  const userId = await getCurrentUserId(request);
  if (!userId) return NextResponse.json({ error: "unauthorized" }, { status: 401 });

  const body = await readJsonObject<{ listId?: unknown; ids?: unknown }>(request);
  if (!body) return NextResponse.json({ error: "invalid json" }, { status: 400 });
  const { listId, ids } = body;
  if (typeof listId !== "string" || !listId) {
    return NextResponse.json({ error: "listId required" }, { status: 400 });
  }
  if (!Array.isArray(ids) || ids.length > MAX_IDS || ids.some((id) => typeof id !== "string")) {
    return NextResponse.json({ error: "ids required" }, { status: 400 });
  }

  // Same check PATCH /api/todos/[id] makes for a target list: the owner or a
  // member, so shared-list collaborators can reorder too.
  const list = await prisma.list.findFirst({
    where: { id: listId, ...listAccessWhere(userId) },
    select: { id: true },
  });
  if (!list) return NextResponse.json({ error: "list not found" }, { status: 404 });

  if (ids.length) {
    await prisma.$transaction(
      (ids as string[]).map((id, position) =>
        prisma.todo.updateMany({ where: { id, listId: list.id, parentId: null }, data: { position } }),
      ),
    );
  }
  return NextResponse.json({ ok: true });
}
