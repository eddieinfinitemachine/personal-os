import { notFound } from "next/navigation";
import { getSession } from "@/lib/auth";
import { findHealthProjectId } from "@/lib/health/load";
import ProjectPage from "@/app/projects/[id]/page";

export const dynamic = "force-dynamic";

/** The Health tracker: the signed-in person's own health record, at an address of its own. */
export default async function HealthPage({ searchParams }: { searchParams: Promise<{ tab?: string }> }) {
  const session = await getSession();
  if (!session) notFound();

  const projectId = await findHealthProjectId(session.userId);
  if (!projectId) notFound();

  return <ProjectPage params={Promise.resolve({ id: projectId })} searchParams={searchParams} />;
}
