import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { ensureDefaultLists } from "@/lib/lists";

export const dynamic = "force-dynamic";

// Capture endpoint built for iOS Shortcuts / share-sheet usage. Accepts
// human-friendly list and project NAMES so you don't need to look up IDs.
//
// Auth: if CAPTURE_TOKEN is set in env, the request must include
//   Authorization: Bearer <CAPTURE_TOKEN>
// Otherwise the endpoint is open (use only with a secret URL).
//
// Body:
//   {
//     "title": "buy oil filter",          // required
//     "list":  "To Do" | "Monitor" | "Later" | "<custom>",  // optional, default "To Do"
//     "project": "Ferrari 456 GT",        // optional, exact name
//     "notes": "...",                      // optional
//     "dueDate": "2026-05-15"             // optional, YYYY-MM-DD
//   }
//
// Also accepts the same fields as URL query params on a GET request — handy
// for Shortcuts that prefer a URL hit over a POST body.
export async function POST(request: Request) {
  if (!isAuthorized(request)) {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }
  const body = (await request.json().catch(() => ({}))) as Record<string, unknown>;
  return handle({
    title: str(body.title),
    list: str(body.list),
    project: str(body.project),
    notes: str(body.notes),
    dueDate: str(body.dueDate),
  });
}

export async function GET(request: Request) {
  if (!isAuthorized(request)) {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }
  const url = new URL(request.url);
  return handle({
    title: url.searchParams.get("title"),
    list: url.searchParams.get("list"),
    project: url.searchParams.get("project"),
    notes: url.searchParams.get("notes"),
    dueDate: url.searchParams.get("dueDate"),
  });
}

function isAuthorized(request: Request): boolean {
  const secret = process.env.CAPTURE_TOKEN;
  if (!secret) return true;
  const auth = request.headers.get("authorization");
  if (auth === `Bearer ${secret}`) return true;
  // Also accept ?token=… so Shortcuts can use a plain URL action.
  const url = new URL(request.url);
  if (url.searchParams.get("token") === secret) return true;
  return false;
}

function str(v: unknown): string | null {
  return typeof v === "string" && v.trim() ? v.trim() : null;
}

async function handle(input: {
  title: string | null;
  list: string | null;
  project: string | null;
  notes: string | null;
  dueDate: string | null;
}) {
  if (!input.title) {
    return NextResponse.json({ error: "title required" }, { status: 400 });
  }
  await ensureDefaultLists();

  const listName = input.list ?? "To Do";
  const list = await prisma.list.findFirst({
    where: { name: { equals: listName, mode: "insensitive" } },
  });
  if (!list) {
    return NextResponse.json(
      { error: `list "${listName}" not found` },
      { status: 404 }
    );
  }

  let projectId: string | null = null;
  if (input.project) {
    const proj = await prisma.project.findFirst({
      where: {
        archived: false,
        name: { equals: input.project, mode: "insensitive" },
      },
    });
    if (!proj) {
      return NextResponse.json(
        { error: `project "${input.project}" not found` },
        { status: 404 }
      );
    }
    projectId = proj.id;
  }

  const todo = await prisma.todo.create({
    data: {
      title: input.title,
      listId: list.id,
      projectId,
      notes: input.notes,
      dueDate: input.dueDate ? new Date(input.dueDate) : null,
    },
  });
  return NextResponse.json({ ok: true, todo });
}
