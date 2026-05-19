import { notFound } from "next/navigation";
import { prisma } from "@/lib/prisma";
import { getSession } from "@/lib/auth";
import { ensureDefaultLists } from "@/lib/lists";
import { ListTile } from "@/components/list-tile";
import { ProjectTabs, type ProjectTab } from "@/components/project-tabs";
import { NotesPane } from "@/components/notes-pane";
import { FilesPane } from "@/components/files-pane";
import { VehicleDashboard } from "@/components/vehicle/vehicle-dashboard";
import { PetDashboard } from "@/components/pet/pet-dashboard";
import { HumanDashboard } from "@/components/human/human-dashboard";
import { ProjectChat } from "@/components/project-chat";

export const dynamic = "force-dynamic";

const VALID_TABS: ProjectTab[] = ["dashboard", "tasks", "notes", "files"];

export default async function ProjectPage({
  params,
  searchParams,
}: {
  params: Promise<{ id: string }>;
  searchParams: Promise<{ tab?: string }>;
}) {
  const { id } = await params;
  const { tab: rawTab } = await searchParams;

  const session = await getSession();
  if (!session) notFound();
  const userId = session.userId;

  const project = await prisma.project.findUnique({ where: { id } });
  if (!project || project.userId !== userId) notFound();

  const hasDashboard =
    project.kind === "vehicle" ||
    project.kind === "pet" ||
    project.kind === "human";
  const defaultTab: ProjectTab = hasDashboard ? "dashboard" : "tasks";
  const tab: ProjectTab = VALID_TABS.includes(rawTab as ProjectTab)
    ? (rawTab as ProjectTab)
    : defaultTab;

  return (
    <div className="px-4 py-4 sm:px-6 md:px-8 md:py-6">
      <header className="mb-4">
        <h1 className="text-2xl font-semibold tracking-tight">{project.name}</h1>
        <p className="text-sm text-[var(--color-muted-foreground)] mt-1">
          {project.kind === "vehicle"
            ? "Vehicle"
            : project.kind === "pet"
              ? "Pet"
              : project.kind === "human"
                ? "Health"
                : "Project"}{" "}
          • created{" "}
          {new Date(project.createdAt).toLocaleDateString(undefined, {
            month: "short",
            day: "numeric",
            year: "numeric",
          })}
        </p>
      </header>

      <ProjectTabs active={tab} hasDashboard={hasDashboard} />

      {tab === "dashboard" && hasDashboard ? (
        project.kind === "vehicle" ? (
          <VehicleDashboard projectId={id} />
        ) : project.kind === "pet" ? (
          <PetDashboard projectId={id} />
        ) : project.kind === "human" ? (
          <HumanDashboard projectId={id} />
        ) : null
      ) : null}
      {tab === "tasks" ? <TasksTab projectId={id} userId={userId} /> : null}
      {tab === "notes" ? <NotesTab projectId={id} userId={userId} /> : null}
      {tab === "files" ? <FilesTab projectId={id} userId={userId} /> : null}

      <ProjectChat projectId={id} projectName={project.name} />
    </div>
  );
}

async function TasksTab({ projectId, userId }: { projectId: string; userId: string }) {
  await ensureDefaultLists(userId);

  // Project pages always show only the three canonical lists (To Do, Monitor,
  // Later). Custom lists belong to the personal/Home view.
  const lists = await prisma.list.findMany({
    where: { userId, isDefault: true },
    orderBy: [{ position: "asc" }, { createdAt: "asc" }],
  });

  // Single fetch — bucket in memory.
  const allTodos = await prisma.todo.findMany({
    where: { userId, projectId, completedAt: null, parentId: null },
    orderBy: [
      { dueDate: "asc" },
      { position: "asc" },
      { createdAt: "asc" },
    ],
    include: {
      subtasks: { orderBy: [{ position: "asc" }, { createdAt: "asc" }] },
    },
  });
  const byList = new Map<string, typeof allTodos>();
  for (const t of allTodos) {
    (byList.get(t.listId) ?? byList.set(t.listId, []).get(t.listId))!.push(t);
  }
  const grouped = lists.map((list) => {
    const all = byList.get(list.id) ?? [];
    return {
      list,
      todos: all.slice(0, 20).map((t) => ({
        id: t.id,
        title: t.title,
        notes: t.notes,
        dueDate: t.dueDate,
        completedAt: t.completedAt,
        projectId: t.projectId,
        subtasks: t.subtasks.map((s) => ({
          id: s.id,
          title: s.title,
          notes: s.notes,
          dueDate: s.dueDate,
          completedAt: s.completedAt,
          projectId: s.projectId,
        })),
      })),
      totalCount: all.length,
    };
  });

  return (
    <div className="grid gap-4 grid-cols-1 lg:grid-cols-3">
      {grouped.map((g) => (
        <ListTile
          key={g.list.id}
          list={g.list}
          todos={g.todos}
          totalCount={g.totalCount}
          projectId={projectId}
        />
      ))}
    </div>
  );
}

async function NotesTab({ projectId, userId }: { projectId: string; userId: string }) {
  const notes = await prisma.note.findMany({
    where: { userId, projectId },
    orderBy: { updatedAt: "desc" },
  });
  return <NotesPane projectId={projectId} notes={notes} />;
}

async function FilesTab({ projectId, userId }: { projectId: string; userId: string }) {
  const attachments = await prisma.attachment.findMany({
    where: { userId, projectId },
    orderBy: { createdAt: "desc" },
  });
  return <FilesPane projectId={projectId} attachments={attachments} />;
}
