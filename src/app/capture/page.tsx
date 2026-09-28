import { redirect } from "next/navigation";
import { Sparkles } from "lucide-react";
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
    <div className="mx-auto max-w-4xl px-4 py-8 sm:px-8 sm:py-12">
      <header className="mb-10 flex items-start gap-3">
        <div className="grid size-10 shrink-0 place-items-center rounded-xl bg-[var(--color-card)] border border-[var(--color-border)]">
          <Sparkles className="size-5 text-[var(--color-tint)]" />
        </div>
        <div>
          <h1 className="text-3xl font-semibold tracking-tight">Capture</h1>
          <p className="mt-1 max-w-lg text-sm text-[var(--color-muted-foreground)]">
            Type a sentence, optionally drop a photo. Claude figures out the
            right place for it — inventory, friends, trips, todos, anywhere.
          </p>
        </div>
      </header>

      <SmartCaptureForm projects={projects} />
    </div>
  );
}
