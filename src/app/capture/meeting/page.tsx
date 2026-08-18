import { redirect } from "next/navigation";
import { ClipboardList } from "lucide-react";
import { prisma } from "@/lib/prisma";
import { getSession } from "@/lib/auth";
import { ensureDefaultLists, CAPTURE_LIST_NAME } from "@/lib/lists";
import { listAccessWhere } from "@/lib/list-access";
import { MeetingImport } from "@/components/meeting-import";

export const dynamic = "force-dynamic";

export default async function MeetingImportPage() {
  const session = await getSession();
  if (!session) redirect("/login");
  const userId = session.userId;

  await ensureDefaultLists(userId);
  const lists = await prisma.list.findMany({
    where: listAccessWhere(userId),
    select: { id: true, name: true, isDefault: true, userId: true },
    orderBy: [{ position: "asc" }, { createdAt: "asc" }],
  });
  const toDo = lists.find(
    (l) => l.userId === userId && l.isDefault && l.name === CAPTURE_LIST_NAME
  );

  return (
    <div className="mx-auto max-w-4xl px-4 py-8 sm:px-8 sm:py-12">
      <header className="mb-10 flex items-start gap-3">
        <div className="grid size-10 shrink-0 place-items-center rounded-xl bg-[var(--color-card)] border border-[var(--color-border)]">
          <ClipboardList className="size-5 text-[var(--color-tint)]" />
        </div>
        <div>
          <h1 className="text-3xl font-semibold tracking-tight">Import meeting</h1>
          <p className="mt-1 max-w-lg text-sm text-[var(--color-muted-foreground)]">
            Paste a Granola transcript. Claude pulls out the next steps and
            routes each one to the right person&apos;s list — you review every
            item before anything is added.
          </p>
        </div>
      </header>

      <MeetingImport
        lists={lists.map((l) => ({ id: l.id, name: l.name }))}
        toDoListId={toDo?.id ?? null}
      />
    </div>
  );
}
