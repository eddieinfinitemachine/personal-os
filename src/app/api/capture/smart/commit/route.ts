import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { getCurrentUserId } from "@/lib/auth";
import { ensureDefaultLists } from "@/lib/lists";
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
  if (!proposal || (proposal.type !== "inventory" && proposal.type !== "interaction")) {
    return NextResponse.json({ error: "proposal required" }, { status: 400 });
  }

  // Validate projectId (if set) belongs to this user.
  let projectId: string | null = null;
  if (proposal.projectId) {
    const project = await prisma.project.findUnique({
      where: { id: proposal.projectId },
    });
    if (project && project.userId === userId) projectId = project.id;
  }

  if (proposal.type === "inventory") {
    const asset = await prisma.asset.create({
      data: {
        userId,
        kind: "inventory",
        title: proposal.title,
        subtitle: proposal.subtitle ?? null,
        category: proposal.category ?? null,
        costBasis: proposal.costBasis ?? null,
        currentValue: proposal.currentValue ?? null,
        location: proposal.location ?? null,
        acquiredAt: proposal.acquiredAt ? new Date(proposal.acquiredAt) : null,
        imageUrl: proposal.photoUrl || null,
        notes: proposal.notes ?? null,
        projectId,
        detailsJson: {
          source: "smart-capture",
          sourceVendor: proposal.sourceVendor ?? null,
        },
      },
    });

    let followupTodo: { id: string; title: string } | null = null;
    if (proposal.followupTodo?.title) {
      await ensureDefaultLists(userId);
      const listName = proposal.followupTodo.listName?.trim() || "To Do";
      const list = await prisma.list.findFirst({
        where: { userId, name: { equals: listName, mode: "insensitive" } },
      });
      if (list) {
        const todo = await prisma.todo.create({
          data: {
            userId,
            listId: list.id,
            projectId,
            title: proposal.followupTodo.title,
          },
        });
        followupTodo = { id: todo.id, title: todo.title };
      }
    }

    return NextResponse.json({ asset, followupTodo });
  }

  // Interaction path.
  const occurredAt = new Date(proposal.occurredAt);
  if (isNaN(occurredAt.getTime())) {
    return NextResponse.json({ error: "invalid occurredAt" }, { status: 400 });
  }

  // Upsert each person by (firstName + lastName), scoped to this user.
  const personIds: string[] = [];
  const createdPersons: { id: string; firstName: string; lastName: string | null }[] = [];
  for (const hint of proposal.personHints) {
    const firstName = hint.firstName?.trim();
    const lastName = hint.lastName?.trim() || null;
    if (!firstName) continue;

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
    if (!person) {
      person = await prisma.person.create({
        data: { userId, firstName, lastName },
      });
      createdPersons.push({ id: person.id, firstName: person.firstName, lastName: person.lastName });
    }
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
      photoUrl: proposal.photoUrl ?? null,
      personIds,
      source: "smart-capture",
      projectId,
    },
  });

  // Bump lastInteractionAt for each linked person (only if newer than current).
  if (personIds.length > 0) {
    const persons = await prisma.person.findMany({
      where: { id: { in: personIds }, userId },
      select: { id: true, lastInteractionAt: true },
    });
    await Promise.all(
      persons.map((p) => {
        const next =
          !p.lastInteractionAt || p.lastInteractionAt < occurredAt
            ? occurredAt
            : p.lastInteractionAt;
        if (p.lastInteractionAt && p.lastInteractionAt >= occurredAt) return null;
        return prisma.person.update({
          where: { id: p.id },
          data: { lastInteractionAt: next },
        });
      }),
    );
  }

  return NextResponse.json({ interaction, createdPersons });
}
