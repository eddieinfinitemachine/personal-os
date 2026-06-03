import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { ensureDefaultLists, CAPTURE_LIST_NAME } from "@/lib/lists";
import { parseCapture, type CaptureProposal } from "@/lib/smart-capture";

export const dynamic = "force-dynamic";
export const maxDuration = 60;

// Bearer-token smart capture. Auto-classifies via Claude, auto-commits — no
// preview screen. Designed for the macOS Quick Todo / iOS Shortcut flow that
// used to hit /api/capture/todo and always create a Todo, regardless of the
// intent. This one routes to the right table (asset / interaction / person /
// trip / todo) based on the text.
//
// Auth: bearer token from CAPTURE_TOKEN env (same as /api/capture/todo). Falls
// back to founder lookup via FOUNDER_EMAIL — no user session needed.
//
// Body (JSON):
//   { text: "...", url?: "https://..." }
//   Where `url` is an optional context URL (e.g. the page the user was on
//   when triggering the shortcut). When present, it's appended to the text
//   so Claude can use it for classification + web search.
//
// Also accepts ?text=...&url=... query params on GET so a Shortcut "Get
// Contents of URL" action can hit it without composing a body.

export async function POST(request: Request) {
  if (!isAuthorized(request)) {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }
  const body = (await request.json().catch(() => ({}))) as {
    text?: string;
    url?: string;
  };
  return handle(body.text, body.url);
}

export async function GET(request: Request) {
  if (!isAuthorized(request)) {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }
  const u = new URL(request.url);
  return handle(u.searchParams.get("text"), u.searchParams.get("url"));
}

// Pick the right action verb for a media companion-todo based on the format
// Claude extracted into details. Falls back to a neutral "Read/watch" if
// the format is unknown.
function mediaVerb(
  proposal: Extract<CaptureProposal, { type: "asset" }>,
): string {
  if (proposal.assetKind === "place") return "Try";
  const format = ((proposal.details as Record<string, unknown> | undefined)
    ?.format as string | undefined)?.toLowerCase();
  if (!format) return "Read/watch";
  if (format === "book" || format === "essay" || format === "article") return "Read";
  if (format === "film" || format === "show" || format === "video") return "Watch";
  if (format === "podcast" || format === "album") return "Listen";
  return "Read/watch";
}

function isAuthorized(request: Request): boolean {
  const secret = process.env.CAPTURE_TOKEN;
  // Fail closed in production (see capture/todo).
  if (!secret) return process.env.NODE_ENV !== "production";
  const auth = request.headers.get("authorization");
  if (auth === `Bearer ${secret}`) return true;
  const url = new URL(request.url);
  return url.searchParams.get("token") === secret;
}

async function handle(rawText: string | null | undefined, rawUrl: string | null | undefined) {
  const text = rawText?.trim();
  if (!text) {
    return NextResponse.json({ error: "text required" }, { status: 400 });
  }

  const FOUNDER_EMAIL = process.env.FOUNDER_EMAIL ?? "emcohen@me.com";
  const founder = await prisma.user.findUnique({ where: { email: FOUNDER_EMAIL } });
  if (!founder) {
    return NextResponse.json({ error: "founder user missing" }, { status: 500 });
  }
  const userId = founder.id;

  const projects = await prisma.project.findMany({
    where: { userId, archived: false },
    select: { id: true, name: true, kind: true },
    orderBy: [{ position: "asc" }, { createdAt: "asc" }],
  });

  // Stitch the URL into the text so Claude can read it as part of the capture.
  const combined = rawUrl ? `${text}\n\n${rawUrl}` : text;
  const today = new Date().toISOString().slice(0, 10);

  let proposal: CaptureProposal;
  try {
    proposal = await parseCapture({
      text: combined,
      today,
      activeProjects: projects,
    });
  } catch (err) {
    console.error("smart auto parse failed", err);
    return NextResponse.json(
      { error: err instanceof Error ? err.message : "parse failed" },
      { status: 502 },
    );
  }

  // Validate any returned projectId belongs to this user.
  if (
    proposal.type === "asset" ||
    proposal.type === "interaction" ||
    proposal.type === "todo"
  ) {
    const pid = proposal.projectId;
    if (pid && !projects.some((p) => p.id === pid)) {
      proposal = { ...proposal, projectId: null };
    }
  }

  // Commit. Inlined per-type rather than calling /commit because we have a
  // bearer-token context, not a session cookie.
  if (proposal.type === "asset") {
    const DEFAULT_STATUS: Record<string, string> = {
      inventory: "owned",
      investment: "active",
      media: "wishlist",
      place: "wishlist",
      practice: "active",
    };
    const status = proposal.status ?? DEFAULT_STATUS[proposal.assetKind] ?? null;
    const asset = await prisma.asset.create({
      data: {
        userId,
        kind: proposal.assetKind,
        status,
        title: proposal.title,
        subtitle: proposal.subtitle ?? null,
        category: proposal.category ?? null,
        costBasis: proposal.costBasis ?? null,
        currentValue: proposal.currentValue ?? null,
        amountUsd: proposal.amountUsd ?? null,
        rating: proposal.rating ?? null,
        location: proposal.location ?? null,
        acquiredAt: proposal.acquiredAt ? new Date(proposal.acquiredAt) : null,
        url: proposal.url ?? rawUrl ?? null,
        notes: proposal.notes ?? null,
        projectId: proposal.projectId ?? null,
        detailsJson: {
          source: "smart-capture-auto",
          sourceVendor: proposal.sourceVendor ?? null,
          ...(proposal.details ?? {}),
        },
      },
    });

    // When you save a media bookmark or a place/wishlist asset, also drop
    // a matching todo on the "Later" list so it shows up in your reading
    // queue alongside other reminders.
    const PENDING_STATUSES = new Set([
      "to-read",
      "to-watch",
      "to-listen",
      "wishlist",
      "in-progress",
    ]);
    let companionTodoId: string | null = null;
    if (
      (proposal.assetKind === "media" || proposal.assetKind === "place") &&
      status &&
      PENDING_STATUSES.has(status)
    ) {
      await ensureDefaultLists(userId);
      const list = await prisma.list.findFirst({
        where: { userId, name: { equals: "Later", mode: "insensitive" } },
      });
      if (list) {
        const verb = mediaVerb(proposal);
        const todo = await prisma.todo.create({
          data: {
            userId,
            listId: list.id,
            projectId: proposal.projectId ?? null,
            title: `${verb}: ${proposal.title}`,
            notes: [proposal.url ?? rawUrl ?? null, proposal.notes ?? null]
              .filter(Boolean)
              .join("\n") || null,
          },
        });
        companionTodoId = todo.id;
      }
    }

    return NextResponse.json({
      ok: true,
      type: "asset",
      assetKind: proposal.assetKind,
      id: asset.id,
      companionTodoId,
    });
  }

  if (proposal.type === "todo") {
    await ensureDefaultLists(userId);
    // Always file captures into Inbox; the user sorts them into lists later.
    const list = await prisma.list.findFirst({
      where: { userId, name: { equals: CAPTURE_LIST_NAME, mode: "insensitive" } },
    });
    if (!list) {
      return NextResponse.json({ error: `list "${CAPTURE_LIST_NAME}" not found` }, { status: 404 });
    }
    // If the original input had a URL, append it to notes so the todo row
    // linkifies it.
    const notes = rawUrl
      ? [proposal.notes ?? "", rawUrl].filter(Boolean).join("\n")
      : proposal.notes ?? null;
    const todo = await prisma.todo.create({
      data: {
        userId,
        listId: list.id,
        projectId: proposal.projectId ?? null,
        title: proposal.title,
        notes: notes || null,
        dueDate: proposal.dueDate ? new Date(proposal.dueDate) : null,
      },
    });
    return NextResponse.json({ ok: true, type: "todo", id: todo.id });
  }

  if (proposal.type === "person") {
    const person = await prisma.person.create({
      data: {
        userId,
        firstName: proposal.firstName,
        lastName: proposal.lastName ?? null,
        role: proposal.role ?? null,
        company: proposal.company ?? null,
        city: proposal.city ?? null,
        country: proposal.country ?? null,
        howWeMet: proposal.howWeMet ?? null,
        socialUrls: proposal.socialUrls ?? undefined,
        interests: proposal.interests ?? [],
        email: proposal.email ?? null,
        phone: proposal.phone ?? null,
        strength: proposal.strength ?? null,
        circles: proposal.circles ?? [],
        notes: proposal.notes ?? null,
        birthday: proposal.birthday ? new Date(proposal.birthday) : null,
      },
    });
    const fullName = [proposal.firstName, proposal.lastName]
      .filter(Boolean)
      .join(" ");
    // Companion todo: filed on the person's card AND surfaced as an
    // actionable reminder on the To Do list.
    const companionTodoId = await createCompanionTodo(
      userId,
      `Follow up with ${fullName}`,
      proposal.notes ?? null,
    );
    return NextResponse.json({
      ok: true,
      type: "person",
      id: person.id,
      companionTodoId,
    });
  }

  if (proposal.type === "trip") {
    const trip = await prisma.trip.create({
      data: {
        userId,
        name: proposal.name,
        destination: proposal.destination ?? null,
        startDate: proposal.startDate ? new Date(proposal.startDate) : null,
        endDate: proposal.endDate ? new Date(proposal.endDate) : null,
        status: proposal.status ?? "planned",
        travelers: proposal.travelers ?? [],
        transport: proposal.transport ?? null,
        accommodation: proposal.accommodation ?? null,
        costUsd: proposal.costUsd ?? null,
        bookingUrl: proposal.bookingUrl ?? rawUrl ?? null,
        notes: proposal.notes ?? null,
      },
    });
    return NextResponse.json({ ok: true, type: "trip", id: trip.id });
  }

  // Interaction — needs at least one person hint to be useful; otherwise skip.
  if (proposal.type === "interaction") {
    const occurredAt = new Date(proposal.occurredAt);
    if (isNaN(occurredAt.getTime())) {
      return NextResponse.json({ error: "invalid occurredAt" }, { status: 400 });
    }
    // Resolve all person hints in ONE query instead of a findFirst per hint
    // (the commit route already uses this batched shape). Misses are created,
    // and the map is updated so duplicate hints in the same payload reuse them.
    const hints = proposal.personHints
      .map((h) => ({
        firstName: h.firstName?.trim() ?? "",
        lastName: h.lastName?.trim() || null,
      }))
      .filter((h) => h.firstName);

    const personIds: string[] = [];
    if (hints.length > 0) {
      const existing = await prisma.person.findMany({
        where: {
          userId,
          OR: hints.map((h) => ({
            firstName: { equals: h.firstName, mode: "insensitive" as const },
            lastName: h.lastName
              ? { equals: h.lastName, mode: "insensitive" as const }
              : null,
          })),
        },
        select: { id: true, firstName: true, lastName: true },
      });
      const key = (f: string, l: string | null) =>
        `${f.toLowerCase()}::${l?.toLowerCase() ?? ""}`;
      const existingMap = new Map(
        existing.map((p) => [key(p.firstName, p.lastName), p]),
      );
      for (const h of hints) {
        const found = existingMap.get(key(h.firstName, h.lastName));
        if (found) {
          personIds.push(found.id);
        } else {
          const created = await prisma.person.create({
            data: { userId, firstName: h.firstName, lastName: h.lastName },
          });
          personIds.push(created.id);
          existingMap.set(key(h.firstName, h.lastName), {
            id: created.id,
            firstName: created.firstName,
            lastName: created.lastName,
          });
        }
      }
    }
    const interaction = await prisma.interaction.create({
      data: {
        userId,
        occurredAt,
        kind: proposal.kind,
        title: proposal.title,
        location: proposal.location ?? null,
        notes: proposal.notes ?? null,
        personIds,
        source: "smart-capture-auto",
        projectId: proposal.projectId ?? null,
      },
    });
    if (personIds.length > 0) {
      await prisma.person.updateMany({
        where: { id: { in: personIds }, userId },
        data: { lastInteractionAt: occurredAt },
      });
    }
    // Companion todo: the note lives on the person's card, and a matching
    // reminder lands on the To Do list so it's actionable.
    const companionTodoId = await createCompanionTodo(
      userId,
      proposal.title,
      proposal.notes ?? null,
      proposal.projectId ?? null,
    );
    return NextResponse.json({
      ok: true,
      type: "interaction",
      id: interaction.id,
      companionTodoId,
    });
  }

  return NextResponse.json({ error: "unknown proposal type" }, { status: 500 });
}

// Create a reminder on the "To Do" list to accompany a captured person /
// interaction. Returns the new todo id, or null if the To Do list is missing.
async function createCompanionTodo(
  userId: string,
  title: string,
  notes: string | null,
  projectId: string | null = null,
): Promise<string | null> {
  await ensureDefaultLists(userId);
  const list = await prisma.list.findFirst({
    where: { userId, name: { equals: "To Do", mode: "insensitive" } },
  });
  if (!list) return null;
  const todo = await prisma.todo.create({
    data: { userId, listId: list.id, projectId, title, notes },
  });
  return todo.id;
}
