import { redirect } from "next/navigation";
import { prisma } from "@/lib/prisma";
import { getSession } from "@/lib/auth";
import { isFounderUser } from "@/lib/cron";
import { RESEARCH_REPORT_SELECT, toResearchReportView } from "@/lib/research/report";
import { ResearchGrid } from "@/components/research/research-grid";

export const dynamic = "force-dynamic";

export default async function ResearchPage() {
  const session = await getSession();
  if (!session) redirect("/login");

  const [rows, canCreate] = await Promise.all([
    prisma.researchReport.findMany({
      where: { userId: session.userId },
      orderBy: { createdAt: "desc" },
      select: RESEARCH_REPORT_SELECT,
      take: 200,
    }),
    isFounderUser(session.userId),
  ]);

  return (
    <div className="px-4 py-4 sm:px-6 md:px-8 md:py-6">
      <header className="mb-5">
        <h1 className="text-large-title font-bold">Research</h1>
        <p className="text-sm text-[var(--color-muted-foreground)] mt-1">
          Illustrated reports on anything you&apos;re curious about, researched and written by Claude.
        </p>
      </header>
      <ResearchGrid initialReports={rows.map(toResearchReportView)} canCreate={canCreate} />
    </div>
  );
}
