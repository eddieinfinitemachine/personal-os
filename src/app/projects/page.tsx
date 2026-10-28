import { redirect } from "next/navigation";
import { getSession } from "@/lib/auth";
import { isFounderUser } from "@/lib/cron";
import { getProjectsBoard } from "@/lib/projects/board";
import { PageHeader } from "@/components/mobile-chrome";
import { ProjectsBoardView, ProjectsSyncStatus } from "@/components/projects-board";

export const dynamic = "force-dynamic";

// What Eddie is working on, inferred by Claude from his meetings, email, todos
// and notes and kept current by the projects-infer cron. Other tenants see an
// empty board.
export default async function ProjectsPage() {
  const session = await getSession();
  if (!session) redirect("/login");
  const isFounder = await isFounderUser(session.userId);
  const board = await getProjectsBoard(session.userId, isFounder);

  return (
    <div className="px-4 py-4 sm:px-6 md:px-8 md:py-6">
      <PageHeader title="Projects" />
      <header className="mb-5 flex items-start justify-between gap-3">
        <div>
          <h1 className="text-large-title font-bold">Projects</h1>
          <p className="text-sm text-[var(--color-muted-foreground)] mt-1">
            What you&apos;re working on, inferred from your meetings, email and todos.
          </p>
        </div>
        {isFounder ? <ProjectsSyncStatus syncedAt={board.syncedAt} refreshFailed={board.refreshFailed} /> : null}
      </header>
      <ProjectsBoardView board={board} />
    </div>
  );
}
