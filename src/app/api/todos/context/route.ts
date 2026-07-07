import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { getCurrentUserId } from "@/lib/auth";
import { listAccessWhere } from "@/lib/list-access";

// Capture-neighborhood for a todo: what else was captured around the same
// time. Terse fragments ("Uber", "IG") decode instantly next to their
// same-day siblings. Read-only.
export async function GET(request: Request) {
  const userId = await getCurrentUserId(request);
  if (!userId) return NextResponse.json({ error: "unauthorized" }, { status: 401 });

  const id = new URL(request.url).searchParams.get("id");
  if (!id) return NextResponse.json({ error: "id required" }, { status: 400 });

  const todo = await prisma.todo.findFirst({
    where: { id, list: listAccessWhere(userId) },
    select: { createdAt: true },
  });
  if (!todo) return NextResponse.json({ error: "not found" }, { status: 404 });

  const HALF_WINDOW_MS = 12 * 60 * 60 * 1000;
  const neighbors = await prisma.todo.findMany({
    where: {
      list: listAccessWhere(userId),
      id: { not: id },
      createdAt: {
        gte: new Date(todo.createdAt.getTime() - HALF_WINDOW_MS),
        lte: new Date(todo.createdAt.getTime() + HALF_WINDOW_MS),
      },
    },
    orderBy: { createdAt: "asc" },
    take: 8,
    select: { title: true, completedAt: true, createdAt: true },
  });

  return NextResponse.json({
    capturedAt: todo.createdAt,
    neighbors: neighbors.map((n) => ({
      title: n.title,
      done: !!n.completedAt,
    })),
  });
}
