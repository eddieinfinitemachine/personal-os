import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { getCurrentUserId } from "@/lib/auth";
import { listAccessWhere } from "@/lib/list-access";

export const dynamic = "force-dynamic";

export type SearchResultType =
  | "todo"
  | "project"
  | "list"
  | "note"
  | "person"
  | "trip"
  | "vehicle"
  | "asset"
  | "recommendation"
  | "pet"
  | "lab";

export type SearchResult = {
  id: string;
  type: SearchResultType;
  label: string;
  sublabel?: string;
  href: string;
};

// Per-kind landing pages for the polymorphic Asset table.
function assetHref(kind: string): string {
  switch (kind) {
    case "investment":
      return "/investments";
    case "media":
      return "/media";
    case "place":
      return "/places";
    case "practice":
      return "/best-practices";
    default:
      return "/inventory";
  }
}

const PER_TYPE = 5;

export async function GET(request: Request) {
  const userId = await getCurrentUserId(request);
  if (!userId) return NextResponse.json({ error: "unauthorized" }, { status: 401 });

  const q = (new URL(request.url).searchParams.get("q") ?? "").trim();
  if (q.length < 2) return NextResponse.json({ results: [] });

  const contains = { contains: q, mode: "insensitive" as const };

  const [todos, projects, lists, notes, people, trips, vehicles, assets, recs, pets, labs] =
    await Promise.all([
      prisma.todo.findMany({
        where: { list: listAccessWhere(userId), completedAt: null, parentId: null, title: contains },
        select: { id: true, title: true, projectId: true, project: { select: { name: true } }, list: { select: { name: true } } },
        orderBy: { updatedAt: "desc" },
        take: PER_TYPE,
      }),
      prisma.project.findMany({
        where: { userId, archived: false, name: contains },
        select: { id: true, name: true },
        orderBy: { updatedAt: "desc" },
        take: PER_TYPE,
      }),
      prisma.list.findMany({
        where: { ...listAccessWhere(userId), name: contains },
        select: { id: true, name: true },
        orderBy: { position: "asc" },
        take: PER_TYPE,
      }),
      prisma.note.findMany({
        where: { userId, OR: [{ title: contains }, { body: contains }] },
        select: { id: true, title: true, body: true, projectId: true, project: { select: { name: true } } },
        orderBy: { updatedAt: "desc" },
        take: PER_TYPE,
      }),
      prisma.person.findMany({
        where: {
          userId,
          archived: false,
          OR: [{ firstName: contains }, { lastName: contains }, { company: contains }],
        },
        select: { id: true, firstName: true, lastName: true, company: true },
        orderBy: { lastInteractionAt: "desc" },
        take: PER_TYPE,
      }),
      prisma.trip.findMany({
        where: { userId, name: contains },
        select: { id: true, name: true },
        orderBy: { updatedAt: "desc" },
        take: PER_TYPE,
      }),
      prisma.vehicle.findMany({
        where: { userId, OR: [{ make: contains }, { model: contains }] },
        select: { id: true, make: true, model: true },
        orderBy: { updatedAt: "desc" },
        take: PER_TYPE,
      }),
      prisma.asset.findMany({
        where: { userId, OR: [{ title: contains }, { subtitle: contains }] },
        select: { id: true, title: true, subtitle: true, kind: true },
        orderBy: { updatedAt: "desc" },
        take: PER_TYPE,
      }),
      prisma.recommendation.findMany({
        where: { userId, title: contains },
        select: { id: true, title: true },
        orderBy: { generatedAt: "desc" },
        take: PER_TYPE,
      }),
      prisma.pet.findMany({
        where: { userId, name: contains },
        select: { id: true, name: true },
        orderBy: { updatedAt: "desc" },
        take: PER_TYPE,
      }),
      // Labs are an imported archive with no browse habit — retrieval on
      // demand ("cholesterol" → the rows) is their access pattern.
      prisma.labResult.findMany({
        where: {
          human: { userId },
          OR: [{ marker: contains }, { panel: contains }],
        },
        select: {
          id: true,
          marker: true,
          panel: true,
          value: true,
          unit: true,
          drawnAt: true,
        },
        orderBy: { drawnAt: "desc" },
        take: PER_TYPE,
      }),
    ]);

  const results: SearchResult[] = [
    ...todos.map((t) => ({
      id: t.id,
      type: "todo" as const,
      label: t.title,
      sublabel: t.project?.name ?? t.list?.name ?? "Reminder",
      href: t.projectId ? `/projects/${t.projectId}` : "/",
    })),
    ...projects.map((p) => ({ id: p.id, type: "project" as const, label: p.name, sublabel: "Project", href: `/projects/${p.id}` })),
    ...lists.map((l) => ({ id: l.id, type: "list" as const, label: l.name, sublabel: "List", href: "/" })),
    ...notes.map((n) => ({
      id: n.id,
      type: "note" as const,
      label: n.title || n.body.slice(0, 60) || "Untitled note",
      sublabel: n.project?.name ?? "Note",
      href: `/projects/${n.projectId}`,
    })),
    ...people.map((p) => ({
      id: p.id,
      type: "person" as const,
      label: [p.firstName, p.lastName].filter(Boolean).join(" "),
      sublabel: p.company ?? "Person",
      href: "/friends",
    })),
    ...trips.map((t) => ({ id: t.id, type: "trip" as const, label: t.name, sublabel: "Trip", href: `/trips/${t.id}` })),
    ...vehicles.map((v) => ({ id: v.id, type: "vehicle" as const, label: [v.make, v.model].filter(Boolean).join(" "), sublabel: "Vehicle", href: "/vehicles" })),
    ...assets.map((a) => ({ id: a.id, type: "asset" as const, label: a.title, sublabel: a.subtitle ?? a.kind, href: assetHref(a.kind) })),
    ...recs.map((r) => ({ id: r.id, type: "recommendation" as const, label: r.title, sublabel: "Recommendation", href: "/media" })),
    ...pets.map((p) => ({ id: p.id, type: "pet" as const, label: p.name, sublabel: "Pet", href: "/personal" })),
    ...labs.map((l) => ({
      id: l.id,
      type: "lab" as const,
      label: `${l.marker} ${l.value} ${l.unit}`,
      sublabel: `${l.panel} · ${l.drawnAt.toISOString().slice(0, 10)}`,
      href: "/personal",
    })),
  ];

  return NextResponse.json({ results: results.slice(0, 24) });
}
