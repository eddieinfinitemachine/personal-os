import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { ensureDefaultLists } from "@/lib/lists";
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

function isAuthorized(request: Request): boolean {
  const secret = process.env.CAPTURE_TOKEN;
  if (!secret) return true;
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
    const asset = await prisma.asset.create({
      data: {
        userId,
        kind: proposal.assetKind,
        status: proposal.status ?? DEFAULT_STATUS[proposal.assetKind] ?? null,
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
    return NextResponse.json({ ok: true, type: "asset", assetKind: proposal.assetKind, id: asset.id });
  }

  if (proposal.type === "todo") {
    await ensureDefaultLists(userId);
    const listName = proposal.listName?.trim() || "To Do";
    const list = await prisma.list.findFirst({
      where: { userId, name: { equals: listName, mode: "insensitive" } },
    });
    if (!list) {
      return NextResponse.json({ error: `list "${listName}" not found` }, { status: 404 });
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
    return NextResponse.json({ ok: true, type: "person", id: person.id });
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
    const personIds: string[] = [];
    for (const hint of proposal.personHints) {
      const firstName = hint.firstName?.trim();
      if (!firstName) continue;
      const lastName = hint.lastName?.trim() || null;
      const where: {
        userId: string;
        firstName: { equals: string; mode: "insensitive" };
        lastName?: { equals: string; mode: "insensitive" } | null;
      } = { userId, firstName: { equals: firstName, mode: "insensitive" } };
      if (lastName) where.lastName = { equals: lastName, mode: "insensitive" };
      else where.lastName = null;
      let person = await prisma.person.findFirst({ where });
      if (!person) person = await prisma.person.create({ data: { userId, firstName, lastName } });
      personIds.push(person.id);
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
    return NextResponse.json({ ok: true, type: "interaction", id: interaction.id });
  }

  return NextResponse.json({ error: "unknown proposal type" }, { status: 500 });
}
