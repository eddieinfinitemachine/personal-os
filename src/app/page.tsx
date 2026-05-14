import { HomeTiles, type HomeTile } from "@/components/home-tiles";
import { NewListButton } from "@/components/new-list-button";
import { ProjectCard, type ProjectCardData } from "@/components/project-card";
import { prisma } from "@/lib/prisma";
import { ensureDefaultLists } from "@/lib/lists";
import type { TodoLike } from "@/components/todo-row";

const PREVIEW_LIMIT = 12;
const PROJECT_LIST_PREVIEW = 8;

export const dynamic = "force-dynamic";

export default async function HomePage() {
  await ensureDefaultLists();

  // Single fetch for all open top-level todos plus their subtasks. Bucket in
  // memory rather than firing N×M queries per (list, project) tile.
  const [lists, projects, allTodos] = await Promise.all([
    prisma.list.findMany({
      orderBy: [{ position: "asc" }, { createdAt: "asc" }],
    }),
    prisma.project.findMany({
      where: { archived: false },
      orderBy: [{ position: "asc" }, { createdAt: "asc" }],
    }),
    prisma.todo.findMany({
      where: { completedAt: null, parentId: null },
      orderBy: [
        { dueDate: "asc" },
        { position: "asc" },
        { createdAt: "desc" },
      ],
      include: {
        project: { select: { name: true } },
        subtasks: {
          orderBy: [{ position: "asc" }, { createdAt: "asc" }],
        },
      },
    }),
  ]);

  const toLike = (t: (typeof allTodos)[number]): TodoLike => ({
    id: t.id,
    title: t.title,
    notes: t.notes,
    dueDate: t.dueDate,
    completedAt: t.completedAt,
    projectId: t.projectId,
    projectName: t.project?.name ?? null,
    subtasks: t.subtasks.map((s) => ({
      id: s.id,
      title: s.title,
      notes: s.notes,
      dueDate: s.dueDate,
      completedAt: s.completedAt,
      projectId: s.projectId,
    })),
  });

  // Bucket: list.id -> all open todos
  const byList = new Map<string, typeof allTodos>();
  // Bucket: `${projectId}:${listId}` -> todos
  const byProjList = new Map<string, typeof allTodos>();
  for (const t of allTodos) {
    (byList.get(t.listId) ?? byList.set(t.listId, []).get(t.listId))!.push(t);
    if (t.projectId) {
      const k = `${t.projectId}:${t.listId}`;
      (byProjList.get(k) ?? byProjList.set(k, []).get(k))!.push(t);
    }
  }

  const tiles: HomeTile[] = lists.map((list) => {
    const all = byList.get(list.id) ?? [];
    return {
      list,
      todos: all.slice(0, PREVIEW_LIMIT).map(toLike),
      totalCount: all.length,
    };
  });

  // Project cards only show the canonical 3 lists (To Do, Monitor, Later).
  const projectLists = lists.filter((l) => l.isDefault);
  const projectCards: ProjectCardData[] = projects
    .map((project): ProjectCardData | null => {
      const byListForProject = projectLists.map((list) => {
        const all = byProjList.get(`${project.id}:${list.id}`) ?? [];
        return {
          list: { id: list.id, name: list.name, color: list.color },
          todos: all.slice(0, PROJECT_LIST_PREVIEW).map(toLike),
          totalCount: all.length,
        };
      });
      const total = byListForProject.reduce((s, g) => s + g.totalCount, 0);
      if (total === 0) return null;
      return {
        project: { id: project.id, name: project.name, kind: project.kind },
        byList: byListForProject,
        totalCount: total,
      };
    })
    .filter((c): c is ProjectCardData => c !== null);

  return (
    <div className="px-4 py-4 sm:px-6 md:px-8 md:py-6">
      <header className="mb-6 hidden md:flex items-start justify-between gap-4">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight">Home</h1>
          <p className="text-sm text-[var(--color-muted-foreground)] mt-1">
            Compiled across everything. Drag tiles to reorder, drag tasks
            between lists.
          </p>
        </div>
        <NewListButton />
      </header>
      <HomeTiles tiles={tiles} />

      {projectCards.length > 0 ? (
        <section className="mt-8 hidden md:block">
          <h2 className="text-xs font-semibold uppercase tracking-wider text-[var(--color-muted-foreground)] mb-3">
            By project
          </h2>
          <div className="space-y-3">
            {projectCards.map((c) => (
              <ProjectCard key={c.project.id} data={c} />
            ))}
          </div>
        </section>
      ) : null}
    </div>
  );
}
