import { Suspense } from "react";
import { notFound } from "next/navigation";
import { prisma } from "@/lib/prisma";
import { getSession } from "@/lib/auth";
import { findOwnProject, getProjectTasks, hasDashboard as projectHasDashboard, projectContentWhere } from "@/lib/project-detail";
import { KeyboardListNav } from "@/components/keyboard-nav";
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

const HEALTH_CHAT = {
  title: "Ask Fable about your health",
  assistantName: "Fable",
  intro:
    "Fable reads your lab history, biometrics, medications, notes, your workout log from the Workout tab, your diet from Apple Health and the picture above. It doesn't get your name or date of birth, and this chat isn't saved.",
};

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

  const project = await findOwnProject(userId, id);
  if (!project) notFound();

  const hasDashboard = projectHasDashboard(project.kind);
  const defaultTab: ProjectTab = hasDashboard ? "dashboard" : "tasks";
  const tab: ProjectTab = VALID_TABS.includes(rawTab as ProjectTab)
    ? (rawTab as ProjectTab)
    : defaultTab;

  return (
    <div className="px-4 py-4 sm:px-6 md:px-8 md:py-6">
      {/* data-focus-hide: hidden in Notes focus mode (notes-pane.tsx). */}
      <header data-focus-hide className="mb-4 flex items-start justify-between gap-3">
        <div>
          <h1 className="text-large-title font-bold">{project.name}</h1>
          {project.kind === "human" ? null : (
            <p className="text-sm text-[var(--color-muted-foreground)] mt-1">
              {project.kind === "vehicle" ? "Vehicle" : project.kind === "pet" ? "Pet" : "Project"} • created{" "}
              {new Date(project.createdAt).toLocaleDateString(undefined, {
                month: "short",
                day: "numeric",
                year: "numeric",
              })}
            </p>
          )}
        </div>
      </header>

      <ProjectTabs active={tab} hasDashboard={hasDashboard} />

      <Suspense fallback={<TabSkeleton />}>
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
      </Suspense>

      <div data-focus-hide>
        <ProjectChat
          projectId={id}
          projectName={project.name}
          canEdit={project.kind === "pet"}
          {...(project.kind === "human" ? HEALTH_CHAT : {})}
        />
      </div>
    </div>
  );
}

function TabSkeleton() {
  return (
    <div className="mt-4 animate-pulse rounded-2xl border border-[var(--color-border)] bg-[var(--color-card)] p-4">
      <div className="space-y-3">
        {Array.from({ length: 5 }).map((_, i) => (
          <div
            key={i}
            className="h-10 w-full rounded-lg bg-[var(--color-muted)]"
          />
        ))}
      </div>
    </div>
  );
}

async function TasksTab({ projectId, userId }: { projectId: string; userId: string }) {
  // Project pages always show only the three canonical lists (To Do, Monitor,
  // Later). Custom lists belong to the personal/Home view. Shared with
  // GET /api/projects/[id].
  const grouped = await getProjectTasks(userId, projectId);

  return (
    <div className="grid gap-4 grid-cols-1 md:grid-cols-2 lg:grid-cols-3">
      <KeyboardListNav />
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
    where: projectContentWhere(userId, projectId),
    orderBy: { updatedAt: "desc" },
  });
  return <NotesPane projectId={projectId} notes={notes} />;
}

async function FilesTab({ projectId, userId }: { projectId: string; userId: string }) {
  const attachments = await prisma.attachment.findMany({
    where: projectContentWhere(userId, projectId),
    orderBy: { createdAt: "desc" },
  });
  return <FilesPane projectId={projectId} attachments={attachments} />;
}
