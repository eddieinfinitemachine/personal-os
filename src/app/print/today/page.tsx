import { redirect } from "next/navigation";
import { prisma } from "@/lib/prisma";
import { getSession } from "@/lib/auth";
import { ensureDefaultLists, palette } from "@/lib/lists";
import { formatCalendarDate } from "@/lib/utils";
import { initials } from "@/lib/initials";
import { PrintButton } from "@/components/print-button";

export const dynamic = "force-dynamic";

export default async function PrintListsPage() {
  const session = await getSession();
  if (!session) redirect("/login");
  const userId = session.userId;

  await ensureDefaultLists(userId);

  const me = await prisma.user.findUnique({
    where: { id: userId },
    select: { name: true, email: true },
  });
  const appName = (me && initials(me.name, me.email)) || "Personal OS";

  const [lists, todos] = await Promise.all([
    prisma.list.findMany({
      where: { userId },
      orderBy: [{ position: "asc" }, { createdAt: "asc" }],
    }),
    prisma.todo.findMany({
      where: { userId, completedAt: null, parentId: null },
      orderBy: [{ position: "asc" }, { createdAt: "asc" }],
      select: {
        id: true,
        title: true,
        dueDate: true,
        listId: true,
        project: { select: { name: true } },
        subtasks: {
          select: { id: true, title: true },
          orderBy: [{ position: "asc" }, { createdAt: "asc" }],
        },
      },
    }),
  ]);

  const byList = new Map<string, typeof todos>();
  for (const t of todos) {
    const arr = byList.get(t.listId) ?? [];
    arr.push(t);
    byList.set(t.listId, arr);
  }

  const listsWithTodos = lists
    .map((l) => ({ list: l, items: byList.get(l.id) ?? [] }))
    .filter((g) => g.items.length > 0);

  const now = new Date();
  const dateLabel = now.toLocaleDateString(undefined, {
    weekday: "long",
    month: "long",
    day: "numeric",
    year: "numeric",
  });

  return (
    <>
      <style>{`
        html, body { background: white !important; color: black !important; }
        @page { size: letter; margin: 0.4in; }
        @media print {
          .print-hide { display: none !important; }
          .avoid-break { break-inside: avoid; }
        }
        .lists-columns { column-count: 2; column-gap: 1.25rem; column-fill: balance; }
        @media (max-width: 640px) { .lists-columns { column-count: 1; } }
      `}</style>
      <div className="min-h-screen bg-white mx-auto max-w-[7.7in] px-6 py-8 text-black sm:px-8 sm:py-10 print:px-0 print:py-0">
        <header className="mb-4 flex items-baseline justify-between border-b border-black/30 pb-2">
          <div>
            <div className="text-[10px] font-semibold uppercase tracking-[0.2em] text-black/60">
              {appName} · Lists
            </div>
            <h1 className="mt-0.5 text-xl font-semibold tracking-tight">{dateLabel}</h1>
          </div>
          <div className="text-[11px] text-black/60">
            {todos.length} open · {listsWithTodos.length} lists
          </div>
        </header>

        <PrintButton />

        <div className="lists-columns mt-4">
          {listsWithTodos.map(({ list, items }) => {
            const p = palette(list.color);
            return (
              <section key={list.id} className="avoid-break mb-4">
                <div className="mb-1 flex items-baseline gap-2">
                  <span
                    className={`inline-block size-2.5 rounded-sm ${p.dot} print:bg-black`}
                    style={{ printColorAdjust: "exact" }}
                    aria-hidden
                  />
                  <h2 className="text-[13px] font-semibold tracking-tight">{list.name}</h2>
                  <span className="text-[10px] text-black/45">{items.length}</span>
                </div>
                <ul className="space-y-[3px]">
                  {items.map((t) => (
                    <PrintRow key={t.id} todo={t} />
                  ))}
                </ul>
              </section>
            );
          })}
          {listsWithTodos.length === 0 ? (
            <p className="text-sm text-black/60">No open todos.</p>
          ) : null}
        </div>
      </div>
    </>
  );
}

function PrintRow({
  todo,
}: {
  todo: {
    id: string;
    title: string;
    dueDate: Date | null;
    project?: { name: string } | null;
    subtasks?: { id: string; title: string }[];
  };
}) {
  const due = todo.dueDate ? formatCalendarDate(todo.dueDate) : null;
  return (
    <li className="flex items-start gap-1.5 text-[11.5px] leading-[1.35]">
      <span
        aria-hidden
        className="mt-[3px] inline-block size-[11px] shrink-0 border border-black/70"
        style={{ printColorAdjust: "exact" }}
      />
      <div className="min-w-0 flex-1">
        <div className="flex flex-wrap items-baseline gap-x-1.5">
          <span className="flex-1 min-w-0">{todo.title}</span>
          {due ? <span className="text-[10px] text-black/55">{due}</span> : null}
          {todo.project?.name ? (
            <span className="text-[10px] text-black/35 truncate max-w-[40%]">
              {todo.project.name}
            </span>
          ) : null}
        </div>
        {todo.subtasks && todo.subtasks.length > 0 ? (
          <ul className="mt-[2px] space-y-[2px]">
            {todo.subtasks.map((s) => (
              <li
                key={s.id}
                className="flex items-start gap-1.5 text-[10.5px] text-black/75"
              >
                <span
                  aria-hidden
                  className="mt-[3px] inline-block size-[8px] shrink-0 border border-black/60"
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
