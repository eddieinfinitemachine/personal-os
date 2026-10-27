// The /projects page model: personal-os Projects for everyone, plus (founder
// only) GitHub repos and suggested meeting topics. Cards with activity in 14
// days are Active and grouped by company; 14–90 days is Dormant; older drops
// off. Pinned cards always show; hidden ones collapse into Hidden.

import { listAccessWhere } from "@/lib/list-access";
import { INBOX_PROJECT_NAME } from "@/lib/lists";
import { prisma } from "@/lib/prisma";
import {
  DORMANT_DAYS,
  VISIBILITIES,
  bucketCards,
  readPlan,
  type ActivityLine,
  type BoardCard,
  type ProjectsBoard,
  type SuggestedTopic,
  type Visibility,
} from "./board-model";
import { companyFor, isCompany } from "./company";
import type { RepoCommit } from "./github";

export * from "./board-model";

const DAY = 24 * 60 * 60 * 1000;
const PLAN_SHOWN = 5;
const ACTIVITY_SHOWN = 3;

const maxDate = (...ds: (Date | null | undefined)[]): Date | null =>
  ds.reduce<Date | null>((m, d) => (d && (!m || d > m) ? d : m), null);

function firstLine(s: string | null | undefined): string {
  return (s ?? "").split("\n").map((l) => l.replace(/^#+\s*/, "").trim()).find(Boolean) ?? "";
}

/**
 * /projects and meeting filing skip the Inbox and Journal system projects.
 * (Here rather than in board-model.ts: INBOX_PROJECT_NAME's module imports
 * Prisma, which must stay out of the client bundle.)
 */
export const isLifeProject = (name: string) =>
  name.trim().toLowerCase() !== INBOX_PROJECT_NAME.toLowerCase() && name.trim() !== "Journal";

export async function getProjectsBoard(userId: string, isFounder: boolean, now = new Date()): Promise<ProjectsBoard> {
  const recent = new Date(now.getTime() - DORMANT_DAYS * DAY);
  const projects = (
    await prisma.project.findMany({
      where: { userId, archived: false },
      select: {
        id: true,
        name: true,
        visibility: true,
        updatedAt: true,
        // An accepted meeting topic keeps the company it was suggested under.
        projectSources: { where: { kind: "topic", state: "accepted" }, select: { company: true }, take: 1 },
      },
    })
  ).filter((p) => isLifeProject(p.name));
  const ids = projects.map((p) => p.id);

  const [todoMax, noteMax, meetingMax, openTodos, doneTodos, notes, meetings] = ids.length
    ? await Promise.all([
        prisma.todo.groupBy({
          by: ["projectId"],
          where: { projectId: { in: ids } },
          _max: { updatedAt: true, completedAt: true },
        }),
        prisma.note.groupBy({ by: ["projectId"], where: { projectId: { in: ids } }, _max: { updatedAt: true } }),
        prisma.projectMeeting.groupBy({
          by: ["projectId"],
          where: { userId, projectId: { in: ids } },
          _max: { occurredAt: true },
        }),
        // Same filters as the project page's Tasks tab.
        prisma.todo.findMany({
          where: {
            projectId: { in: ids },
            completedAt: null,
            parentId: null,
            OR: [{ snoozedUntil: null }, { snoozedUntil: { lte: now } }],
            list: listAccessWhere(userId),
          },
          orderBy: [{ dueDate: "asc" }, { position: "asc" }, { createdAt: "asc" }],
          select: { projectId: true, title: true },
        }),
        prisma.todo.findMany({
          where: {
            projectId: { in: ids },
            completedAt: { gte: recent },
            droppedAt: null,
            isReference: false,
            list: listAccessWhere(userId),
          },
          orderBy: { completedAt: "desc" },
          take: 300,
          select: { projectId: true, title: true, completedAt: true },
        }),
        prisma.note.findMany({
          where: { projectId: { in: ids }, userId, updatedAt: { gte: recent } },
          orderBy: { updatedAt: "desc" },
          take: 300,
          select: { projectId: true, title: true, body: true, updatedAt: true },
        }),
        prisma.projectMeeting.findMany({
          where: { userId, projectId: { in: ids }, title: { not: null }, occurredAt: { gte: recent } },
          orderBy: { occurredAt: "desc" },
          take: 300,
          select: { projectId: true, title: true, occurredAt: true, url: true },
        }),
      ])
    : [[], [], [], [], [], [], []];

  const byProject = <T extends { projectId: string | null }>(rows: T[]) => {
    const m = new Map<string, T[]>();
    for (const r of rows) if (r.projectId) (m.get(r.projectId) ?? m.set(r.projectId, []).get(r.projectId)!).push(r);
    return m;
  };
  const todoMaxBy = new Map(todoMax.map((r) => [r.projectId, r._max]));
  const noteMaxBy = new Map(noteMax.map((r) => [r.projectId, r._max.updatedAt]));
  const meetingMaxBy = new Map(meetingMax.map((r) => [r.projectId, r._max.occurredAt]));
  const openBy = byProject(openTodos);
  const doneBy = byProject(doneTodos);
  const notesBy = byProject(notes);
  const meetingsBy = byProject(meetings);

  const cards: BoardCard[] = projects.map((p) => {
    const t = todoMaxBy.get(p.id);
    const last = maxDate(p.updatedAt, t?.updatedAt, t?.completedAt, noteMaxBy.get(p.id), meetingMaxBy.get(p.id));
    const activity: ActivityLine[] = [
      ...(doneBy.get(p.id) ?? []).map((d) => ({ kind: "todo" as const, text: d.title, at: d.completedAt!.toISOString() })),
      ...(notesBy.get(p.id) ?? []).map((n) => ({
        kind: "note" as const,
        text: n.title?.trim() || firstLine(n.body) || "Untitled note",
        at: n.updatedAt.toISOString(),
      })),
      ...(meetingsBy.get(p.id) ?? []).map((m) => ({
        kind: "meeting" as const,
        text: m.title!,
        at: m.occurredAt.toISOString(),
        url: m.url,
      })),
    ]
      .sort((a, b) => Date.parse(b.at) - Date.parse(a.at))
      .slice(0, ACTIVITY_SHOWN);
    const open = openBy.get(p.id) ?? [];
    return {
      id: `project:${p.id}`,
      kind: "project",
      name: p.name,
      company: isCompany(p.projectSources[0]?.company) ? p.projectSources[0].company : companyFor({ name: p.name }),
      visibility: (VISIBILITIES as readonly string[]).includes(p.visibility) ? (p.visibility as Visibility) : "auto",
      lastActivityAt: last?.toISOString() ?? null,
      activity,
      plan: open.slice(0, PLAN_SHOWN).map((o) => ({ text: o.title, section: null })),
      planTotal: open.length,
      href: `/projects/${p.id}`,
      githubUrl: null,
      homepageUrl: null,
      projectId: p.id,
      sourceId: null,
    };
  });

  let suggested: SuggestedTopic[] = [];
  let syncedAt: string | null = null;
  if (isFounder) {
    const [repos, topics] = await Promise.all([
      prisma.projectSource.findMany({ where: { userId, kind: "repo" } }),
      prisma.projectSource.findMany({
        where: { userId, kind: "topic", state: "suggested" },
        include: { meetings: { select: { occurredAt: true }, orderBy: { occurredAt: "desc" } } },
      }),
    ]);
    const repoIds = repos.map((r) => r.id);
    const repoMeetings = repoIds.length
      ? await prisma.projectMeeting.findMany({
          where: { userId, sourceId: { in: repoIds }, title: { not: null }, occurredAt: { gte: recent } },
          orderBy: { occurredAt: "desc" },
          take: 300,
          select: { sourceId: true, title: true, occurredAt: true, url: true },
        })
      : [];
    for (const r of repos) {
      const met = repoMeetings.filter((m) => m.sourceId === r.id);
      const commits = (Array.isArray(r.commits) ? r.commits : []) as unknown as RepoCommit[];
      const plan = readPlan(r.plan);
      const activity: ActivityLine[] = [
        ...commits.map((c) => ({ kind: "commit" as const, text: c.message, at: c.at, branch: c.branch, url: c.url })),
        ...met.map((m) => ({ kind: "meeting" as const, text: m.title!, at: m.occurredAt.toISOString(), url: m.url })),
      ]
        .sort((a, b) => Date.parse(b.at) - Date.parse(a.at))
        .slice(0, ACTIVITY_SHOWN);
      const last = maxDate(r.lastActivityAt, met[0]?.occurredAt);
      cards.push({
        id: `repo:${r.id}`,
        kind: "repo",
        name: r.name,
        company: isCompany(r.company) ? r.company : "Personal",
        visibility: (VISIBILITIES as readonly string[]).includes(r.state) ? (r.state as Visibility) : "auto",
        lastActivityAt: last?.toISOString() ?? null,
        activity,
        plan: plan.items.slice(0, PLAN_SHOWN),
        planTotal: plan.total,
        href: null,
        githubUrl: r.url,
        homepageUrl: r.homepageUrl,
        projectId: null,
        sourceId: r.id,
      });
    }
    syncedAt = repos.reduce<Date | null>((m, r) => maxDate(m, r.syncedAt), null)?.toISOString() ?? null;
    suggested = topics
      .map((t) => ({
        id: t.id,
        name: t.name,
        company: t.company,
        meetings: t.meetings.length,
        lastMeetingAt: maxDate(t.meetings[0]?.occurredAt, t.lastActivityAt)?.toISOString() ?? null,
      }))
      .sort((a, b) => (b.lastMeetingAt ?? "").localeCompare(a.lastMeetingAt ?? ""));
  }

  return { suggested, ...bucketCards(cards, now), syncedAt };
}
