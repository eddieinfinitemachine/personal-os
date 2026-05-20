import { redirect } from "next/navigation";
import { prisma } from "@/lib/prisma";
import { getSession } from "@/lib/auth";
import { SmartCaptureForm } from "@/components/smart-capture-form";

export const dynamic = "force-dynamic";

export default async function CapturePage() {
  const session = await getSession();
  if (!session) redirect("/login");
  const userId = session.userId;

  const projects = await prisma.project.findMany({
    where: { userId, archived: false },
    select: { id: true, name: true, kind: true },
    orderBy: [{ position: "asc" }, { createdAt: "asc" }],
  });

  return (
    <div className="px-4 py-6 sm:px-8 sm:py-8">
      <header className="mb-6">
        <h1 className="text-2xl font-semibold tracking-tight">Capture</h1>
        <p className="mt-1 text-sm text-[var(--color-muted-foreground)]">
          Photo + a sentence. Kaizen figures out where it goes.
        </p>
      </header>

      <SmartCaptureForm projects={projects} />
    </div>
  );
}
