import { notFound } from "next/navigation";
import { getSession } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import ProjectPage from "@/app/projects/[id]/page";

export const dynamic = "force-dynamic";

/** The Health tracker: the signed-in person's own health record, at an address of its own. */
export default async function HealthPage({ searchParams }: { searchParams: Promise<{ tab?: string }> }) {
  const session = await getSession();
  if (!session) notFound();

  const project = await prisma.project.findFirst({
    where: { userId: session.userId, kind: "human", archived: false },
    orderBy: { createdAt: "asc" },
    select: { id: true },
  });
  if (!project) notFound();

  return <ProjectPage params={Promise.resolve({ id: project.id })} searchParams={searchParams} />;
}
