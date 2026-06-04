import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { getCurrentUserId } from "@/lib/auth";
import { ensureDefaultLists, ensureInboxProject, CAPTURE_LIST_NAME } from "@/lib/lists";
import type { CaptureProposal } from "@/lib/smart-capture";

// Commit a (possibly user-edited) capture proposal to the DB.
// Body: { proposal: CaptureProposal }
//
// Inventory → create Asset(kind=inventory) [+ optional follow-up Todo if proposal.followupTodo]
// Interaction → upsert each personHints[] to Person, then create Interaction.
//             Also bumps Person.lastInteractionAt for each linked person.
export async function POST(request: Request) {
  const userId = await getCurrentUserId(request);
  if (!userId) {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }

  let body: { proposal?: CaptureProposal };
  try {
    body = (await request.json()) as { proposal?: CaptureProposal };
  } catch {
    return NextResponse.json({ error: "bad json" }, { status: 400 });
  }
  const proposal = body.proposal;
  if (
    !proposal ||
    !["asset", "interaction", "person", "trip", "todo"].includes(proposal.type)
  ) {
    return NextResponse.json({ error: "proposal required" }, { status: 400 });
  }

  // Validate projectId (if set) belongs to this user.
  // Only asset / interaction / todo carry a projectId.
  let projectId: string | null = null;
  const proposalProjectId =
    proposal.type === "asset" || proposal.type === "interaction" || proposal.type === "todo"
      ? proposal.projectId ?? null
      : null;
  if (proposalProjectId) {
    const project = await prisma.project.findUnique({
      where: { id: proposalProjectId },
    });
    if (project && project.userId === userId) projectId = project.id;
  }

  if (proposal.type === "asset") {
    // Default status per assetKind if Claude didn't set one.
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
        amountUsd: proposal.amountUsd ?? null,
        rating: proposal.rating ?? null,
        title: proposal.title,
        subtitle: proposal.subtitle ?? null,
        category: proposal.category ?? null,
        costBasis: proposal.costBasis ?? null,
        currentValue: proposal.currentValue ?? null,
        location: proposal.location ?? null,
        // Default acquiredAt to today for inventory items marked owned (if
        // Claude didn't extract a date). Other kinds stay null.
        acquiredAt: proposal.acquiredAt
          ? new Date(proposal.acquiredAt)
          : proposal.assetKind === "inventory" &&
              (proposal.status ?? "owned") === "owned"
            ? new Date()
            : null,
        imageUrl: proposal.photoUrl || null,
        url: proposal.url ?? null,
        notes: proposal.notes ?? null,
        projectId,
        detailsJson: {
          source: "smart-capture",
          sourceVendor: proposal.sourceVendor ?? null,
          ...(proposal.details ?? {}),
        },
      },
    });

    let followupTodo: { id: string; title: string } | null = null;
    if (proposal.followupTodo?.title) {
      await ensureDefaultLists(userId);
      // Follow-up todos land in the Inbox project (To Do list) for the user
      // to sort, regardless of the asset's project.
      const inboxProjectId = await ensureInboxProject(userId);
      const list = await prisma.list.findFirst({
        where: { userId, name: { equals: CAPTURE_LIST_NAME, mode: "insensitive" } },
      });
      if (list) {
        const todo = await prisma.todo.create({
          data: {
            userId,
            listId: list.id,
            projectId: inboxProjectId,
            title: proposal.followupTodo.title,
          },
        });
        followupTodo = { id: todo.id, title: todo.title };
      }
    }

    return NextResponse.json({ asset, followupTodo });
  }

  // Person path — add directly to the CRM, no interaction row.
  if (proposal.type === "person") {
    const firstName = proposal.firstName?.trim();
    if (!firstName) {
      return NextResponse.json({ error: "firstName required" }, { status: 400 });
    }
    const lastName = proposal.lastName?.trim() || null;

    // Upsert by (firstName + lastName) case-insensitive — same pattern as
    // the interaction path so we don't create duplicates.
    const where: {
      userId: string;
      firstName: { equals: string; mode: "insensitive" };
      lastName?: { equals: string; mode: "insensitive" } | null;
    } = {
      userId,
      firstName: { equals: firstName, mode: "insensitive" },
    };
    if (lastName) where.lastName = { equals: lastName, mode: "insensitive" };
    else where.lastName = null;

    let person = await prisma.person.findFirst({ where });
    let created = false;
    if (person) {
      // Existing person — patch any fields the user filled that aren't set yet.
      const existing = person;
      const patch: Record<string, unknown> = {};
      function fillStr(field: string, current: string | null, v: string | null | undefined) {
        if (!v || current) return;
        const t = v.trim();
        if (t) patch[field] = t;
      }
      function fillArr(field: string, current: string[], v: string[] | null | undefined) {
        if (!v || v.length === 0) return;
        if (current.length === 0) patch[field] = v;
      }
      fillStr("role", existing.role, proposal.role);
      fillStr("company", existing.company, proposal.company);
      fillStr("city", existing.city, proposal.city);
      fillStr("country", existing.country, proposal.country);
      fillStr("howWeMet", existing.howWeMet, proposal.howWeMet);
      fillStr("email", existing.email, proposal.email);
      fillStr("phone", existing.phone, proposal.phone);
      fillStr("strength", existing.strength, proposal.strength);
      fillStr("notes", existing.notes, proposal.notes);
      fillStr("imageUrl", existing.imageUrl, proposal.photoUrl);
      fillArr("circles", existing.circles, proposal.circles);
      fillArr("interests", existing.interests, proposal.interests);
      if (proposal.socialUrls && !existing.socialUrls) {
        // Only set socialUrls if the existing record has none — don't blindly
        // overwrite a user-curated set with what Claude found.
        patch.socialUrls = proposal.socialUrls;
      }
      if (proposal.birthday && !existing.birthday) {
        patch.birthday = new Date(proposal.birthday);
      }
      if (Object.keys(patch).length > 0) {
        person = await prisma.person.update({ where: { id: existing.id }, data: patch });
      }
    } else {
      person = await prisma.person.create({
        data: {
          userId,
          firstName,
          lastName,
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
          imageUrl: proposal.photoUrl ?? null,
          birthday: proposal.birthday ? new Date(proposal.birthday) : null,
        },
      });
      created = true;
    }
    return NextResponse.json({ person, created });
  }

  // Trip path — create a new Trip row.
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
        bookingUrl: proposal.bookingUrl ?? null,
        notes: proposal.notes ?? null,
        imageUrl: proposal.photoUrl ?? null,
      },
    });
    return NextResponse.json({ trip });
  }

  // Todo path — always file into the Inbox project (To Do list) so the user
  // sorts captures into real projects themselves, regardless of what Claude
  // proposed for project/list.
  if (proposal.type === "todo") {
    await ensureDefaultLists(userId);
    const inboxProjectId = await ensureInboxProject(userId);
    const list = await prisma.list.findFirst({
      where: { userId, name: { equals: CAPTURE_LIST_NAME, mode: "insensitive" } },
    });
    if (!list) {
      return NextResponse.json(
        { error: `list "${CAPTURE_LIST_NAME}" not found` },
        { status: 404 },
      );
    }
    const todo = await prisma.todo.create({
      data: {
        userId,
        listId: list.id,
        projectId: inboxProjectId,
        title: proposal.title,
        notes: proposal.notes ?? null,
        dueDate: proposal.dueDate ? new Date(proposal.dueDate) : null,
      },
    });
    return NextResponse.json({ todo });
  }

  // Interaction path.
  const occurredAt = new Date(proposal.occurredAt);
  if (isNaN(occurredAt.getTime())) {
    return NextResponse.json({ error: "invalid occurredAt" }, { status: 400 });
  }

  // Upsert each person by (firstName + lastName), scoped to this user.
  // Normalize hints once, then batch-lookup all in a single findMany.
  const hints = proposal.personHints
    .map((h) => ({
      firstName: h.firstName?.trim() || "",
      lastName: h.lastName?.trim() || null,
    }))
    .filter((h) => h.firstName);

  const personIds: string[] = [];
  const createdPersons: { id: string; firstName: string; lastName: string | null }[] = [];

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
        createdPersons.push({
          id: created.id,
          firstName: created.firstName,
          lastName: created.lastName,
        });
        personIds.push(created.id);
        // Cache the create so a duplicate hint in the same payload reuses it.
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
      photoUrl: proposal.photoUrl ?? null,
      personIds,
      source: "smart-capture",
      projectId,
    },
  });

  // Bump lastInteractionAt for each linked person (only if newer than current).
  // Single statement — Postgres handles the "newer-than" predicate in WHERE.
  if (personIds.length > 0) {
    await prisma.person.updateMany({
      where: {
        id: { in: personIds },
        userId,
        OR: [
          { lastInteractionAt: null },
          { lastInteractionAt: { lt: occurredAt } },
        ],
      },
      data: { lastInteractionAt: occurredAt },
    });
  }

  return NextResponse.json({ interaction, createdPersons });
}
