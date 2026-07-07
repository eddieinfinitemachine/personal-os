import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { ensureDefaultLists, ensureInboxProject, CAPTURE_LIST_NAME } from "@/lib/lists";
import { parseAliasToken } from "@/lib/alias";

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
    // `text` is accepted as an alias for `title` so this endpoint is a
    // drop-in replacement for /capture/smart/auto's body — repoint a
    // Shortcut here for "always a todo, never reclassified".
    title: str(body.title) ?? str(body.text),
    list: str(body.list),
    project: str(body.project),
    notes: str(body.notes),
    dueDate: str(body.dueDate),
    url: str(body.url),
  });
}

export async function GET(request: Request) {
  if (!isAuthorized(request)) {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }
  const url = new URL(request.url);
  return handle({
    title: url.searchParams.get("title") ?? url.searchParams.get("text"),
    list: url.searchParams.get("list"),
    project: url.searchParams.get("project"),
    notes: url.searchParams.get("notes"),
    dueDate: url.searchParams.get("dueDate"),
    url: url.searchParams.get("url"),
  });
}

function isAuthorized(request: Request): boolean {
  const secret = process.env.CAPTURE_TOKEN;
  // Fail closed in production: an unset token must NOT leave this public-write
  // endpoint open. In dev, allow unsigned requests for hand-testing.
  if (!secret) return process.env.NODE_ENV !== "production";
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
  url?: string | null;
}) {
  if (!input.title) {
    return NextResponse.json({ error: "title required" }, { status: 400 });
  }
  // Fold an optional context URL into notes so the todo row linkifies it
  // (matches how /capture/smart/auto handles a passed url).
  const notes =
    input.url && input.notes
      ? `${input.notes}\n${input.url}`
      : input.url ?? input.notes;

  const FOUNDER_EMAIL = process.env.FOUNDER_EMAIL ?? "emcohen@me.com";
  const founder = await prisma.user.findUnique({ where: { email: FOUNDER_EMAIL } });
  if (!founder) return NextResponse.json({ error: "founder user missing" }, { status: 500 });
  const userId = founder.id;

  await ensureDefaultLists(userId);

  // Deterministic "@name" routing: "@shane …" files to EC/Shane, verbatim
  // minus the token, no Inbox project. An explicit `list` param still wins.
  let aliasListName: string | null = null;
  let title = input.title;
  if (!input.list) {
    const aliasHit = parseAliasToken(input.title);
    if (aliasHit) {
      const aliasList = await prisma.list.findFirst({
        where: {
          userId,
          OR: [
            { name: { equals: `EC/${aliasHit.token}`, mode: "insensitive" } },
            { name: { equals: aliasHit.token, mode: "insensitive" } },
          ],
        },
      });
      if (aliasList) {
        aliasListName = aliasList.name;
        title = aliasHit.rest;
      }
    }
  }

  // Default unsorted captures to the To Do list; an explicit `list` still wins.
  const listName = input.list ?? aliasListName ?? CAPTURE_LIST_NAME;
  const list = await prisma.list.findFirst({
    where: { userId, name: { equals: listName, mode: "insensitive" } },
  });
  if (!list) {
    return NextResponse.json(
      { error: `list "${listName}" not found` },
      { status: 404 }
    );
  }

  // Default to the Inbox project so unsorted captures land there; an explicit
  // `project` still wins. Alias-routed todos skip the Inbox project like
  // hand-placed person-list items.
  let projectId: string | null = aliasListName ? null : await ensureInboxProject(userId);
  if (input.project) {
    const proj = await prisma.project.findFirst({
      where: {
        userId,
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
      userId,
      title,
      listId: list.id,
      projectId,
      notes,
      dueDate: input.dueDate ? new Date(input.dueDate) : null,
    },
  });
  return NextResponse.json({ ok: true, todo });
}
