import { redirect } from "next/navigation";
import { prisma } from "@/lib/prisma";
import { getSession } from "@/lib/auth";
import { ensureDefaultLists, palette } from "@/lib/lists";
import { PrintButton } from "@/components/print-button";

export const dynamic = "force-dynamic";

export default async function DailyPrintPage() {
  const session = await getSession();
  if (!session) redirect("/login");
  const userId = session.userId;

  await ensureDefaultLists(userId);

  const [lists, projects, todos] = await Promise.all([
    prisma.list.findMany({
      where: { userId },
      orderBy: [{ position: "asc" }, { createdAt: "asc" }],
    }),
    prisma.project.findMany({
      where: { userId, archived: false },
      orderBy: [{ position: "asc" }, { createdAt: "asc" }],
    }),
    prisma.todo.findMany({
      where: { userId, completedAt: null, parentId: null },
      orderBy: [{ dueDate: "asc" }, { position: "asc" }, { createdAt: "asc" }],
      include: {
        project: { select: { name: true } },
        subtasks: { orderBy: [{ position: "asc" }, { createdAt: "asc" }] },
      },
    }),
  ]);

  type Todo = (typeof todos)[number];

  const now = new Date();
  const startOfToday = new Date(now);
  startOfToday.setHours(0, 0, 0, 0);
  const startOfTomorrow = new Date(startOfToday);
  startOfTomorrow.setDate(startOfTomorrow.getDate() + 1);

  const overdue: Todo[] = [];
  const dueToday: Todo[] = [];
  for (const t of todos) {
    if (!t.dueDate) continue;
    if (t.dueDate < startOfToday) overdue.push(t);
    else if (t.dueDate < startOfTomorrow) dueToday.push(t);
  }

  const byList = new Map<string, Todo[]>();
  for (const t of todos) {
    const arr = byList.get(t.listId) ?? [];
    arr.push(t);
    byList.set(t.listId, arr);
  }

  const projectsWithTodos = projects
    .map((p) => ({
      project: p,
      todos: todos.filter((t) => t.projectId === p.id),
    }))
    .filter((g) => g.todos.length > 0);

  const dateLabel = now.toLocaleDateString(undefined, {
    weekday: "long",
    month: "long",
    day: "numeric",
    year: "numeric",
  });
  const timeLabel = now.toLocaleTimeString(undefined, {
    hour: "numeric",
    minute: "2-digit",
  });

  return (
    <>
      <style>{`
        @page { size: letter; margin: 0.5in; }
        @media print {
          html, body { background: white !important; color: black !important; }
          .print-hide { display: none !important; }
          .avoid-break { break-inside: avoid; }
        }
      `}</style>
      <div className="mx-auto max-w-[7.5in] px-6 py-8 text-black sm:px-10 sm:py-12 print:px-0 print:py-0">
        <header className="mb-6 border-b border-black/30 pb-3">
          <div className="text-[10px] font-semibold uppercase tracking-[0.2em] text-black/60">
            Kaizen · Daily
          </div>
          <h1 className="mt-1 text-2xl font-semibold tracking-tight">{dateLabel}</h1>
          <div className="mt-1.5 text-sm text-black/60">
            {todos.length} open · {dueToday.length} due today · {overdue.length} overdue · {lists.length} lists
          </div>
          <PrintButton />
        </header>

        {overdue.length + dueToday.length > 0 ? (
          <section className="avoid-break mb-6 rounded-md border border-black/40 px-4 py-3">
            <div className="mb-2 text-[10px] font-semibold uppercase tracking-[0.2em] text-black/60">
              Priority
            </div>
            {overdue.length > 0 ? (
              <div className="mb-2">
                <div className="text-xs font-semibold uppercase tracking-wider text-black/70">
                  Overdue
                </div>
                <ul className="mt-1 space-y-1">
                  {overdue.map((t) => (
                    <PrintRow key={t.id} todo={t} accent="overdue" />
                  ))}
                </ul>
              </div>
            ) : null}
            {dueToday.length > 0 ? (
              <div>
                <div className="text-xs font-semibold uppercase tracking-wider text-black/70">
                  Due today
                </div>
                <ul className="mt-1 space-y-1">
                  {dueToday.map((t) => (
                    <PrintRow key={t.id} todo={t} />
                  ))}
                </ul>
              </div>
            ) : null}
          </section>
        ) : null}

        <section className="mb-6">
          <div className="mb-2 text-[10px] font-semibold uppercase tracking-[0.2em] text-black/60">
            Lists
          </div>
          <div className="space-y-5">
            {lists.map((list) => {
              const items = byList.get(list.id) ?? [];
              if (items.length === 0) return null;
              const p = palette(list.color);
              return (
                <div key={list.id} className="avoid-break">
                  <div className="mb-1.5 flex items-baseline gap-2">
                    <span
                      className={`inline-block size-2.5 rounded-sm ${p.dot} print:bg-black`}
                      style={{ printColorAdjust: "exact" }}
                      aria-hidden
                    />
                    <h2 className="text-base font-semibold tracking-tight">
                      {list.name}
                    </h2>
                    <span className="text-xs text-black/50">{items.length}</span>
                  </div>
                  <ul className="space-y-1">
                    {items.map((t) => (
                      <PrintRow key={t.id} todo={t} />
                    ))}
                  </ul>
                </div>
              );
            })}
          </div>
        </section>

        {projectsWithTodos.length > 0 ? (
          <section className="mb-6">
            <div className="mb-2 text-[10px] font-semibold uppercase tracking-[0.2em] text-black/60">
              By project
            </div>
            <div className="space-y-4">
              {projectsWithTodos.map(({ project, todos: pts }) => (
                <div key={project.id} className="avoid-break">
                  <div className="mb-1 text-sm font-semibold">{project.name}</div>
                  <ul className="space-y-1">
                    {pts.map((t) => (
                      <PrintRow key={t.id} todo={t} showList />
                    ))}
                  </ul>
                </div>
              ))}
            </div>
          </section>
        ) : null}

        <footer className="mt-8 border-t border-black/20 pt-3 text-[10px] text-black/50">
          Generated {dateLabel} at {timeLabel}
        </footer>
      </div>
    </>
  );
}

function PrintRow({
  todo,
  showList,
  accent,
}: {
  todo: {
    id: string;
    title: string;
    notes: string | null;
    dueDate: Date | null;
    subtasks?: { id: string; title: string }[];
    project?: { name: string } | null;
  } & { listId: string };
  showList?: boolean;
  accent?: "overdue";
}) {
  const due = todo.dueDate
    ? todo.dueDate.toLocaleDateString(undefined, {
        month: "short",
        day: "numeric",
      })
    : null;
  return (
    <li className="flex items-start gap-2 text-[13px] leading-[1.45]">
      <span
        aria-hidden
        className="mt-0.5 inline-block size-[14px] shrink-0 border border-black/70"
        style={{ printColorAdjust: "exact" }}
      />
      <div className="min-w-0 flex-1">
        <div className="flex flex-wrap items-baseline gap-x-2">
          <span>{todo.title}</span>
          {due ? (
            <span
              className={
                accent === "overdue"
                  ? "text-[11px] font-medium text-black"
                  : "text-[11px] text-black/55"
              }
            >
              {due}
            </span>
          ) : null}
          {showList && todo.project?.name ? (
            <span className="text-[11px] uppercase tracking-wider text-black/45">
              {todo.project.name}
            </span>
          ) : null}
        </div>
        {todo.subtasks && todo.subtasks.length > 0 ? (
          <ul className="mt-0.5 space-y-0.5">
            {todo.subtasks.map((s) => (
              <li key={s.id} className="flex items-start gap-2 text-[12px] text-black/75">
                <span
                  aria-hidden
                  className="mt-0.5 inline-block size-[10px] shrink-0 border border-black/60"
                  style={{ printColorAdjust: "exact" }}
                />
                <span>{s.title}</span>
              </li>
            ))}
          </ul>
        ) : null}
      </div>
    </li>
  );
}
