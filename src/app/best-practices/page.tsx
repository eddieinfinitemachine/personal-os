import { prisma } from "@/lib/prisma";
import { AssetGrid } from "@/components/asset-grid";
import { getSession } from "@/lib/auth";
import { redirect } from "next/navigation";

export const dynamic = "force-dynamic";

export default async function BestPracticesPage() {
  const session = await getSession();
  if (!session) redirect("/login");
  const userId = session.userId;

  const assets = await prisma.asset.findMany({
    where: { userId, kind: "practice", archived: false },
    orderBy: [{ position: "asc" }, { createdAt: "desc" }],
  });
  return (
    <div className="px-4 py-4 sm:px-6 md:px-8 md:py-6">
      <header className="mb-6">
        <h1 className="text-large-title font-bold">Best practices</h1>
        <p className="text-sm text-[var(--color-muted-foreground)] mt-1">
          Frameworks, principles, mental models, hard-won lessons.
        </p>
      </header>
      <AssetGrid
        kind="practice"
        initialAssets={assets}
        emptyHint="Save a principle or framework you don't want to forget."
        fields={[
          { key: "subtitle", label: "Source", placeholder: "Naval · Charlie Munger · personal" },
          { key: "category", label: "Domain", placeholder: "leadership · health · product · money" },
          { key: "url", label: "Reference link", type: "url", full: true },
          { key: "notes", label: "The actual practice", type: "textarea", full: true },
        ]}
      />
    </div>
  );
}
